// server.js
const cluster = require("cluster");
const numCPUs = require("os").cpus().length;
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { fetchAgentData } = require("./test/testCallFetch");
const db = require("./db/connection.js");
const { DatabaseHelper } = require("./Helpers/databaseHelper");
const { TableHelper } = require("./Helpers/leadsTableHelper");
const leadsRoutes = require("./routes/leadsSearch.routes");
const LocalStore = require("./LocalStore");
const WebSocketHandler = require("./websocket/webSocketHandler.js");

// Create express app instance
const app = express();

if (cluster.isMaster) {
  console.log(`Master ${process.pid} is running`);

  const workers = new Map();

  // Handle messages from workers
  cluster.on("message", (worker, message) => {
    if (message.type === "store_update") {
      // Broadcast to all other workers
      for (const [id, w] of workers) {
        if (id !== worker.id) {
          w.send(message);
        }
      }
    }
  });

  // Fork workers
  for (let i = 0; i < numCPUs; i++) {
    const worker = cluster.fork();
    workers.set(worker.id, worker);

    worker.on("message", (message) => {
      if (message.type === "websocket_broadcast") {
        for (const [id, w] of workers) {
          if (id !== worker.id) {
            w.send({ type: "websocket_message", data: message.data });
          }
        }
      }
    });
  }

  cluster.on("exit", (worker, code, signal) => {
    console.log(`Worker ${worker.id} died. Restarting...`);
    workers.delete(worker.id);
    const newWorker = cluster.fork();
    workers.set(newWorker.id, newWorker);
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
    // Initialize local store
    const store = new LocalStore(db);

    // Basic server setup
    app.set("trust proxy", true);

    const limiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
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

    // Request logging middleware
    app.use((req, res, next) => {
      const timestamp = new Date().toISOString();
      const requestId = Math.random().toString(36).substring(7);
      console.log(`[${timestamp}] RequestID: ${requestId}`);
      console.log(`Method: ${req.method} URL: ${req.url}`);
      console.log("Headers:", req.headers);
      console.log("Query Parameters:", req.query);
      console.log("Body:", req.body);
      res.setHeader("X-Request-ID", requestId);
      next();
    });

    // Health check route
    app.get("/health", (req, res) => {
      res.status(200).json({
        status: "healthy",
        workerId: process.pid,
        timestamp: new Date().toISOString(),
      });
    });

    // API Routes
    app.use("/api/leads", leadsRoutes);
    app.post("/api/fetchAgentData", fetchAgentData);
    app.post("/fetchAgentData", fetchAgentData);

    // SQL Query Routes
    app.post("/api/sql/query", async (req, res) => {
      try {
        const result = await store.get(`query:${req.body.query}`);
        if (result) {
          return res.json({ success: true, data: result, cached: true });
        }

        const queryResult = await db.query(req.body.query, req.body.params);
        await store.set(`query:${req.body.query}`, queryResult.rows, {
          ttl: 300,
        });
        res.json({ success: true, data: queryResult.rows });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Error handling middleware
    app.use((err, req, res, next) => {
      const timestamp = new Date().toISOString();
      console.error(`[${timestamp}] Worker ${process.pid} Error:`, err);

      const response = {
        success: false,
        error: err.message || "Internal Server Error",
        requestId: req.headers["x-request-id"],
        timestamp,
        workerId: process.pid,
      };

      if (process.env.NODE_ENV === "development") {
        response.stack = err.stack;
      }

      res.status(err.status || 500).json(response);
    });

    // Handle worker messages
    process.on("message", async (message) => {
      if (message.type === "shutdown") {
        await gracefulShutdown("SIGTERM");
      } else if (message.type === "websocket_message" && wsHandler) {
        wsHandler.broadcast(message.data);
      }
    });

    // Process event handlers
    process.on("uncaughtException", (error) => {
      console.error(`Worker ${process.pid} uncaught exception:`, error);
      console.error("Stack:", error.stack);
      gracefulShutdown("UNCAUGHT_EXCEPTION");
    });

    process.on("unhandledRejection", (reason, promise) => {
      console.error(`Worker ${process.pid} unhandled rejection:`, reason);
      gracefulShutdown("UNHANDLED_REJECTION");
    });

    process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
    process.on("SIGINT", () => gracefulShutdown("SIGINT"));

    // Graceful shutdown handler
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
        const shutdown = {
          websocket: false,
          store: false,
        };

        if (wsHandler) {
          console.log("Closing WebSocket connections...");
          try {
            await wsHandler.gracefulShutdown();
            shutdown.websocket = true;
            console.log("WebSocket server closed successfully");
          } catch (error) {
            console.error("Error closing WebSocket server:", error);
          }
        }

        // Cleanup store
        try {
          await store.cleanup();
          shutdown.store = true;
          console.log("Store cleaned up successfully");
        } catch (error) {
          console.error("Error cleaning up store:", error);
        }

        clearTimeout(shutdownTimeout);
        console.log("Shutdown status:", shutdown);

        if (shutdown.websocket && shutdown.store) {
          console.log("Graceful shutdown completed successfully");
          process.exit(0);
        } else {
          console.log("Partial shutdown completed with errors");
          process.exit(1);
        }
      } catch (error) {
        console.error(`Worker ${process.pid} shutdown error:`, error);
        process.exit(1);
      }
    }

    // Start server
    const PORT = process.env.PORT || 3000;

    try {
      console.log(`Worker ${process.pid} starting...`);

      const server = app.listen(PORT, "0.0.0.0", () => {
        console.log("=".repeat(50));
        console.log(`Worker ${process.pid} listening on port ${PORT}`);
        console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
        console.log(`Process ID: ${process.pid}`);
        console.log(`Memory usage: ${JSON.stringify(process.memoryUsage())}`);
        console.log("=".repeat(50));
      });

      // Set server timeouts
      server.timeout = 120000; // 2 minutes
      server.keepAliveTimeout = 65000; // 65 seconds

      // Initialize WebSocket handler
      const wsHandler = new WebSocketHandler(server, store);

      // Set up periodic store cleanup
      setInterval(() => {
        store.cleanup(3600); // Clean up data older than 1 hour
      }, 1800000); // Run every 30 minutes

      return server;
    } catch (error) {
      console.error(`Worker ${process.pid} failed to start:`, error);
      process.exit(1);
    }
  }

  // Start the worker
  setupWorker().catch((err) => {
    console.error(`Worker ${process.pid} setup failed:`, err);
    process.exit(1);
  });
}

// Export app for testing
module.exports = { app };
