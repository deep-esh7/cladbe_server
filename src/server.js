const cluster = require("cluster");
const numCPUs = require("os").cpus().length;
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const path = require("path");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const WebSocketHandler = require("./websocket/webSocketHandler.js");
const { fetchAgentData } = require("./test/testCallFetch");
const db = require("./db/connection.js");
const { DatabaseHelper } = require("./Helpers/databaseHelper");
const { TableHelper } = require("./Helpers/leadsTableHelper");
const leadsRoutes = require("./routes/leadsSearch.routes");
const pg = require("pg");
const sticky = require("sticky-session");

// Create express app instance at top level
const app = express();

// Global variables
let notificationListener;
let sqlExecutor;
let clientSqlHelper;
let wsHandler;

// Initialize SQL components - Modified to skip actual initialization
async function initializeSqlComponents() {
  console.log("Skipping SQL initialization...");
  return true;
}

// Helper function for SQL initialization errors - Kept for compatibility
async function handleSqlInitializationError(error) {
  console.log("SQL initialization skipped");
}

// Initialize database - Modified to skip actual initialization
async function initializeDatabase() {
  console.log("Skipping database initialization...");
  return true;
}

// Helper function for database initialization errors - Kept for compatibility
async function handleDatabaseInitializationError(error) {
  console.log("Database initialization skipped");
}

if (cluster.isMaster) {
  console.log(`Master ${process.pid} is running`);

  const workers = new Map();

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
    // Setup notification listener - Modified to skip actual setup
    async function setupNotificationListener(pool) {
      console.log("Skipping notification listener setup...");
      return null;
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

    // Request logging
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
      res.status(200).json("wuhuuuuu chall gya morni");
    });

    // Routes
    app.use("/api/leads", leadsRoutes);
    app.post("/api/fetchAgentData", fetchAgentData);
    app.post("/fetchAgentData", fetchAgentData);

    // SQL Query Routes - Modified to return empty results
    app.post("/api/sql/query", async (req, res) => {
      res.json({ success: true, data: [] });
    });

    app.post("/api/sql/execute", async (req, res) => {
      res.json({ success: true, data: [] });
    });

    // Table Operations - Modified to return mock responses
    app.get("/api/sql/table/:tableName/exists", async (req, res) => {
      res.json({ success: true, exists: false });
    });

    app.get("/api/sql/table/:tableName/columns", async (req, res) => {
      res.json({ success: true, columns: [] });
    });

    app.post("/api/sql/table/create", async (req, res) => {
      res.json({
        success: true,
        message: `Table creation skipped`,
      });
    });

    app.delete("/api/sql/table/:tableName", async (req, res) => {
      res.json({ success: true });
    });

    // Transaction Routes - Modified to return success without actual transactions
    app.post("/api/sql/transaction-begin", async (req, res) => {
      const transactionId = Math.random().toString(36).substring(7);
      res.json({ success: true, transactionId });
    });

    app.post("/api/sql/transaction-commit", async (req, res) => {
      res.json({ success: true });
    });

    app.post("/api/sql/transaction-rollback", async (req, res) => {
      res.json({ success: true });
    });

    // Batch Operations - Modified to return empty results
    app.post("/api/sql/batch", async (req, res) => {
      res.json({ success: true, data: [] });
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

    // Initialize WebSocket
    async function initializeWebSocket(server) {
      try {
        console.log(`Worker ${process.pid} initializing WebSocket...`);
        wsHandler = new WebSocketHandler(server);

        wsHandler.wss.on("error", (error) => {
          console.error("WebSocket server error:", error);
        });

        return true;
      } catch (error) {
        console.error("Failed to initialize WebSocket:", error);
        if (error.code === "EADDRINUSE") {
          console.error("WebSocket port is already in use");
        }
        return false;
      }
    }

    // Graceful shutdown for worker
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

        clearTimeout(shutdownTimeout);
        console.log("Shutdown status:", shutdown);

        if (shutdown.websocket) {
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

    // Handle worker messages from master
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

      server.timeout = 120000;
      server.keepAliveTimeout = 65000;

      const wsInitialized = await initializeWebSocket(server);
      if (!wsInitialized) throw new Error("Failed to initialize WebSocket");

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
