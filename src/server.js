// server.js
const cluster = require("cluster");
const numCPUs = require("os").cpus().length;
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");
const { fetchAgentData } = require("./test/testCallFetch");
const { DatabaseHelper } = require("./Helpers/databaseHelper");
const { TableHelper } = require("./Helpers/leadsTableHelper");
const leadsRoutes = require("./routes/leadsSearch.routes");
const LocalStore = require("./LocalStore");
const WebSocketHandler = require("./websocket/webSocketHandler.js");

// Initialize environment - do this only once
require("dotenv").config({
  path: path.resolve(__dirname, ".env"),
  debug: false,
  override: false,
});

// Create express app instance
const app = express();
let wsHandler = null;

if (cluster.isMaster) {
  console.log(`Master ${process.pid} is running`);

  // Master process optimizations
  process.title = "node-master";
  process.setMaxListeners(0);

  // Calculate memory allocation
  const os = require("os");
  const totalMem = os.totalmem();
  const masterMemory = Math.floor(totalMem * 0.1); // 10% for master
  const workerMemory = Math.floor((totalMem * 0.9) / numCPUs); // Rest divided among workers

  const workers = new Map();
  let restartingWorker = false;

  // Enhanced worker restart function
  async function reloadWorkers() {
    if (restartingWorker) return;
    restartingWorker = true;

    for (const [id, worker] of workers) {
      // Fork new worker
      const newWorker = cluster.fork({
        NODE_OPTIONS: `--max-old-space-size=${workerMemory}`,
      });
      workers.set(newWorker.id, newWorker);

      // Wait for new worker to be ready
      await new Promise((resolve) => {
        newWorker.once("listening", resolve);
      });

      // Gracefully shutdown old worker
      worker.disconnect();
      await new Promise((resolve) => {
        worker.on("exit", () => {
          workers.delete(id);
          resolve();
        });
      });
    }

    restartingWorker = false;
  }

  // Handle messages from workers
  cluster.on("message", (worker, message) => {
    switch (message.type) {
      case "store_update":
        // Broadcast to all other workers
        for (const [id, w] of workers) {
          if (id !== worker.id) {
            w.send(message);
          }
        }
        break;
      case "websocket_broadcast":
        for (const [id, w] of workers) {
          if (id !== worker.id) {
            w.send({ type: "websocket_message", data: message.data });
          }
        }
        break;
      case "health_check":
        worker.lastHeartbeat = Date.now();
        break;
    }
  });

  // Fork workers
  for (let i = 0; i < numCPUs; i++) {
    const worker = cluster.fork({
      NODE_OPTIONS: `--max-old-space-size=${workerMemory}`,
    });
    workers.set(worker.id, worker);

    worker.on("error", (error) => {
      console.error(`Worker ${worker.id} error:`, error);
    });
  }

  // Monitor worker health
  setInterval(() => {
    const now = Date.now();
    workers.forEach((worker, id) => {
      if (now - worker.lastHeartbeat > 30000) {
        // 30 seconds timeout
        console.error(`Worker ${id} is unresponsive, restarting...`);
        worker.kill("SIGTERM");
      }
    });
  }, 10000);

  // Handle worker exits
  cluster.on("exit", (worker, code, signal) => {
    console.log(`Worker ${worker.id} died (${signal || code}). Restarting...`);
    workers.delete(worker.id);

    if (!worker.exitedAfterDisconnect) {
      const newWorker = cluster.fork({
        NODE_OPTIONS: `--max-old-space-size=${workerMemory}`,
      });
      workers.set(newWorker.id, newWorker);
    }
  });

  // Handle master process signals
  process.on("SIGTERM", async () => {
    console.log("Master received SIGTERM. Shutting down workers...");
    for (const worker of workers.values()) {
      worker.send({ type: "shutdown" });
    }
    setTimeout(() => {
      console.log("Master shutting down");
      process.exit(0);
    }, 5000);
  });
} else {
  // Worker process
  async function setupWorker() {
    try {
      process.title = `node-worker-${process.pid}`;

      // Initialize local store
      const store = new LocalStore();

      // Send regular heartbeats
      setInterval(() => {
        process.send({ type: "health_check" });
      }, 5000);

      // Optimize garbage collection
      if (typeof global.gc === "function") {
        setInterval(() => {
          try {
            global.gc();
          } catch (e) {
            console.error("GC error:", e);
          }
        }, 30000);
      }

      // Basic server setup
      app.set("trust proxy", true);

      const limiter = rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 100,
        standardHeaders: true,
        legacyHeaders: false,
        trustProxy: true,
        message: "Too many requests, please try again later.",
        keyGenerator: (req) => req.ip,
      });

      const corsOptions = {
        origin: "*",
        methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Accept", "Authorization"],
        credentials: true,
        maxAge: 86400,
        websocket: true,
      };

      // Security middleware
      app.use(
        helmet({
          contentSecurityPolicy: {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'", "'unsafe-inline'"],
              styleSrc: ["'self'", "'unsafe-inline'"],
              imgSrc: ["'self'", "data:", "https:"],
              connectSrc: ["'self'", "ws:", "wss:"],
            },
          },
        })
      );

      app.use(cors(corsOptions));
      app.use(express.json({ limit: "50mb" }));
      app.use(express.urlencoded({ extended: true, limit: "50mb" }));
      app.use(morgan("dev"));
      app.use(limiter);

      // Optimized request logging
      app.use((req, res, next) => {
        const requestId = Math.random().toString(36).substring(7);
        console.log(
          `[${Date.now()}] ${requestId} ${process.pid} ${req.method} ${req.url}`
        );
        res.setHeader("X-Request-ID", requestId);
        next();
      });

      // Health check route
      app.get("/health", (req, res) => {
        res.status(200).json({
          status: "healthy",
          workerId: process.pid,
          timestamp: Date.now(),
          memoryUsage: process.memoryUsage(),
        });
      });

      // API Routes
      app.use("/api/leads", leadsRoutes);
      app.post("/api/fetchAgentData", fetchAgentData);
      app.post("/fetchAgentData", fetchAgentData);

      // Query caching with LocalStore
      app.post("/api/sql/query", async (req, res) => {
        try {
          const cacheKey = `query:${req.body.query}`;
          const cachedResult = store.get(cacheKey);

          if (cachedResult) {
            return res.json({
              success: true,
              data: cachedResult,
              cached: true,
            });
          }

          // If not in cache, get from database
          const queryResult = await db.query(req.body.query, req.body.params);
          store.set(cacheKey, queryResult.rows, { ttl: 300 });
          res.json({ success: true, data: queryResult.rows });
        } catch (error) {
          res.status(500).json({ success: false, error: error.message });
        }
      });

      // Error handling middleware
      app.use((err, req, res, next) => {
        console.error(`[${Date.now()}] Worker ${process.pid} Error:`, err);

        const response = {
          success: false,
          error: err.message || "Internal Server Error",
          requestId: req.headers["x-request-id"],
          timestamp: Date.now(),
          workerId: process.pid,
        };

        if (process.env.NODE_ENV === "development") {
          response.stack = err.stack;
        }

        res.status(err.status || 500).json(response);
      });

      // Start server
      const PORT = process.env.PORT || 3000;
      const server = app.listen(PORT, "0.0.0.0", () => {
        console.log("=".repeat(50));
        console.log(`Worker ${process.pid} listening on port ${PORT}`);
        console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
        console.log(`Memory usage: ${JSON.stringify(process.memoryUsage())}`);
        console.log("=".repeat(50));
      });

      // Optimize server settings
      server.keepAliveTimeout = 65000;
      server.headersTimeout = 66000;
      server.maxHeadersCount = 100;
      server.timeout = 30000;

      // Enable TCP Keep-Alive
      server.on("connection", (socket) => {
        socket.setKeepAlive(true, 30000);
      });

      // Initialize WebSocket handler
      wsHandler = new WebSocketHandler(server, store);

      // Set up periodic cleanups
      setInterval(() => {
        store.cleanup();
      }, 1800000); // Every 30 minutes

      return server;
    } catch (error) {
      console.error(`Worker ${process.pid} setup error:`, error);
      process.exit(1);
    }
  }

  // Enhanced shutdown handling
  async function gracefulShutdown(signal) {
    console.log(
      `Worker ${process.pid} received ${signal}. Starting graceful shutdown...`
    );

    const shutdownTimeout = setTimeout(() => {
      console.error(
        "Could not close connections in time, forcefully shutting down"
      );
      process.exit(1);
    }, 30000);

    try {
      if (wsHandler) {
        await wsHandler.gracefulShutdown();
      }

      clearTimeout(shutdownTimeout);
      console.log(`Worker ${process.pid} shutdown complete`);
      process.exit(0);
    } catch (error) {
      console.error(`Worker ${process.pid} shutdown error:`, error);
      process.exit(1);
    }
  }

  // Process event handlers
  process.on("uncaughtException", (error) => {
    console.error(`Worker ${process.pid} uncaught exception:`, error);
    gracefulShutdown("UNCAUGHT_EXCEPTION");
  });

  process.on("unhandledRejection", (reason) => {
    console.error(`Worker ${process.pid} unhandled rejection:`, reason);
    gracefulShutdown("UNHANDLED_REJECTION");
  });

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));

  // Handle worker messages
  process.on("message", async (message) => {
    if (message.type === "shutdown") {
      await gracefulShutdown("SIGTERM");
    } else if (message.type === "websocket_message" && wsHandler) {
      wsHandler.broadcast(message.data);
    }
  });

  // Start the worker
  setupWorker().catch((err) => {
    console.error(`Worker ${process.pid} setup failed:`, err);
    process.exit(1);
  });
}

module.exports = { app };
