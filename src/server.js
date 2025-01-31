// server.js
const cluster = require("cluster");
const os = require("os");
const v8 = require("v8");
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

// V8 optimizations
v8.setFlagsFromString("--max-old-space-size=4096");
v8.setFlagsFromString("--optimize-for-size");
v8.setFlagsFromString("--max-semi-space-size=128");

// Load environment variables once
require("dotenv").config({
  path: path.resolve(__dirname, ".env"),
  debug: false,
  override: false,
});

// Increase the maximum number of event listeners
require("events").EventEmitter.defaultMaxListeners = 0;
process.setMaxListeners(0);

// Calculate optimal worker count - use 75% of available CPUs
const WORKERS_COUNT = os.cpus().length;

// Create express app instance
const app = express();
let wsHandler = null;

if (cluster.isMaster) {
  console.log(`Master ${process.pid} is running`);
  process.title = "node-master";

  // Calculate memory allocation
  const totalMem = os.totalmem();
  const masterMemory = Math.floor(totalMem * 0.05); // 5% for master instead of 10%
  const workerMemory = Math.floor((totalMem * 0.95) / WORKERS_COUNT); // More memory per worker

  // Worker management
  const workers = new Map();
  const workerLoad = new Map();
  let restartingWorker = false;

  // Monitor system resources
  function monitorResources() {
    const loadAvg = os.loadavg();
    const freeMem = os.freemem();
    const memUsage = ((totalMem - freeMem) / totalMem) * 100;

    console.log(`System Load (1m, 5m, 15m): ${loadAvg.join(", ")}`);
    console.log(`Memory Usage: ${memUsage.toFixed(2)}%`);

    // Auto-scaling logic
    if (loadAvg[0] > WORKERS_COUNT * 0.8) {
      console.log("High load detected");
    }
  }

  setInterval(monitorResources, 30000);

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
        workerLoad.set(worker.id, message.load);
        worker.lastHeartbeat = Date.now();
        break;
    }
  });

  // Spawn workers
  for (let i = 0; i < WORKERS_COUNT; i++) {
    const worker = cluster.fork({
      NODE_OPTIONS: `--max-old-space-size=${Math.floor(
        workerMemory / (1024 * 1024)
      )}`,
      UV_THREADPOOL_SIZE: 4, // Optimal thread pool size per worker
    });
    workers.set(worker.id, worker);
    workerLoad.set(worker.id, 0);

    worker.on("error", (error) => {
      console.error(`Worker ${worker.id} error:`, error);
    });
  }

  // Monitor worker health
  setInterval(() => {
    const now = Date.now();
    workers.forEach((worker, id) => {
      if (now - worker.lastHeartbeat > 30000) {
        console.error(`Worker ${id} is unresponsive, restarting...`);
        worker.kill("SIGTERM");
      }
    });
  }, 10000);

  // Handle worker exits
  cluster.on("exit", (worker, code, signal) => {
    console.log(`Worker ${worker.id} died (${signal || code}). Restarting...`);
    workers.delete(worker.id);
    workerLoad.delete(worker.id);

    if (!worker.exitedAfterDisconnect) {
      const newWorker = cluster.fork({
        NODE_OPTIONS: `--max-old-space-size=${Math.floor(
          workerMemory / (1024 * 1024)
        )}`,
        UV_THREADPOOL_SIZE: 8,
      });
      workers.set(newWorker.id, newWorker);
      workerLoad.set(newWorker.id, 0);
    }
  });

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

      // Send regular heartbeats and load info
      setInterval(() => {
        const load = process.cpuUsage();
        process.send({
          type: "health_check",
          load: (load.user + load.system) / 1000000,
        });
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
          uptime: process.uptime(),
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

          // Handle the query (implement your query logic here)
          // const queryResult = await yourQueryFunction(req.body.query, req.body.params);
          const queryResult = { rows: [] }; // Replace with actual query

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
      const server = app.listen(PORT, "0.0.0.0", {
        backlog: 10000, // Increase connection queue
      });

      // Optimize server settings
      server.keepAliveTimeout = 30000;
      server.headersTimeout = 31000;
      server.maxHeadersCount = 100;
      server.setTimeout(30000);

      // Enable TCP Keep-Alive
      server.on("connection", (socket) => {
        socket.setKeepAlive(true, 30000);
      });

      // Initialize WebSocket handler
      // Update WebSocket server settings
      // In WebSocketHandler.js
      const wsOptions = {
        maxPayload: 1024 * 1024, // Increase to 1MB
        perMessageDeflate: {
          zlibDeflateOptions: {
            level: 1,
            memLevel: 8,
            chunkSize: 32 * 1024, // Increase chunk size
          },
          zlibInflateOptions: {
            chunkSize: 32 * 1024,
          },
          threshold: 1024 * 8, // Compress messages > 8KB
        },
        clientTracking: true,
        noServer: true, // Important for cluster
      };
      wsHandler = new WebSocketHandler(server, store, wsOptions);

      // Set up periodic cleanups
      setInterval(() => {
        store.cleanup();
      }, 1800000); // Every 30 minutes

      // Log startup success
      console.log("=".repeat(50));
      console.log(`Worker ${process.pid} listening on port ${PORT}`);
      console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
      console.log(`Memory usage: ${JSON.stringify(process.memoryUsage())}`);
      console.log("=".repeat(50));

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
  //

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

// Export app for testing
module.exports = { app };
