const cluster = require("cluster");
const numCPUs = require("os").cpus().length;
const express = require("express");
const http = require("http");
const cors = require("cors");
const morgan = require("morgan");
const path = require("path");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const WebSocket = require("ws"); // Add WebSocket import
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

  sqlExecutor = {
    execute: async () => ({ rows: [] }),
  };

  clientSqlHelper = {
    executeRead: async () => [],
    executeWrite: async () => ({ rowCount: 0 }),
    tableExists: async () => false,
    getTableColumns: async () => [],
    createTable: async () => true,
    dropTable: async () => true,
    executeTransaction: async () => [],
    _buildQueryWithModifiers: () => "",
    extractParameters: () => [],
  };

  return true;
}

// Initialize database - Modified to skip actual initialization
async function initializeDatabase() {
  console.log("Skipping database initialization...");
  return true;
}

if (cluster.isMaster) {
  console.log(`Master ${process.pid} is running`);

  const workers = new Map();

  // Create worker processes
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
    await initializeSqlComponents(); // Ensure SQL components are initialized first

    // Basic server setup
    app.set("trust proxy", true);
    app.disable("x-powered-by");

    const limiter = rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 2000,
      standardHeaders: true,
      legacyHeaders: false,
      trustProxy: true,
      skipFailedRequests: true,
      skip: (req) => req.path === "/health",
      keyGenerator: (req) => req.ip,
    });

    const corsOptions = {
      origin: "*",
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: [
        "Content-Type",
        "Accept",
        "Authorization",
        "Origin",
        "Sec-WebSocket-Protocol",
        "Connection",
        "Upgrade",
      ],
      credentials: true,
      maxAge: 86400,
    };

    app.use(
      helmet({
        contentSecurityPolicy: false,
        crossOriginEmbedderPolicy: false,
        crossOriginResourcePolicy: false,
        crossOriginOpenerPolicy: false,
      })
    );

    app.use(cors(corsOptions));
    app.use(express.json({ limit: "50mb" }));
    app.use(express.urlencoded({ extended: true, limit: "50mb" }));
    app.use(
      morgan("dev", {
        skip: (req) => req.path === "/health",
      })
    );
    app.use(limiter);

    // Request logging
    app.use((req, res, next) => {
      if (req.path !== "/health") {
        const timestamp = new Date().toISOString();
        const requestId = Math.random().toString(36).substring(7);
        console.log(`[${timestamp}] RequestID: ${requestId}`);
        console.log(`Method: ${req.method} URL: ${req.url}`);
        res.setHeader("X-Request-ID", requestId);
      }
      next();
    });

    app.get("/test", (req, res) => {
      res.json({
        status: "ok",
        time: new Date().toISOString(),
        headers: req.headers,
      });
    });

    // WebSocket availability test
    app.get("/ws-test", (req, res) => {
      res.json({
        status: "ok",
        wsServerRunning: !!wsHandler,
        wsClients: wsHandler ? wsHandler.wss.clients.size : 0,
        serverInfo: {
          port: process.env.PORT || 3000,
          workers: numCPUs,
          pid: process.pid,
        },
      });
    });

    // Routes
    app.get("/health", (req, res) => {
      res.status(200).json("Health check OK");
    });

    app.use("/api/leads", leadsRoutes);
    app.post("/api/fetchAgentData", fetchAgentData);
    app.post("/fetchAgentData", fetchAgentData);

    // Mock API routes
    app.post("/api/sql/query", async (req, res) => {
      res.json({ success: true, data: [] });
    });

    app.post("/api/sql/execute", async (req, res) => {
      res.json({ success: true, data: [] });
    });

    app.get("/api/sql/table/:tableName/exists", async (req, res) => {
      res.json({ success: true, exists: false });
    });

    app.get("/api/sql/table/:tableName/columns", async (req, res) => {
      res.json({ success: true, columns: [] });
    });

    app.post("/api/sql/table/create", async (req, res) => {
      res.json({ success: true, message: "Table creation skipped" });
    });

    app.delete("/api/sql/table/:tableName", async (req, res) => {
      res.json({ success: true });
    });

    app.post("/api/sql/transaction-begin", async (req, res) => {
      res.json({
        success: true,
        transactionId: Math.random().toString(36).substring(7),
      });
    });

    app.post("/api/sql/transaction-commit", async (req, res) => {
      res.json({ success: true });
    });

    app.post("/api/sql/transaction-rollback", async (req, res) => {
      res.json({ success: true });
    });

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

    // Start server
    const PORT = process.env.PORT || 3000;

    try {
      console.log(`Worker ${process.pid} starting...`);

      // Create HTTP server
      const server = http.createServer(app);

      // Optimize server settings
      server.keepAliveTimeout = 65000;
      server.headersTimeout = 66000;
      server.timeout = 120000;
      server.maxConnections = 10000;

      // Initialize WebSocket handler with proper error handling
      console.log(`Worker ${process.pid} initializing WebSocket...`);
      try {
        wsHandler = new WebSocketHandler(server, clientSqlHelper, null);
      } catch (error) {
        console.error("Error initializing WebSocket handler:", error);
        throw error;
      }

      // Apply sticky sessions
      const stickyServer = sticky.listen(server, PORT);

      if (stickyServer) {
        server.once("listening", () => {
          console.log("=".repeat(50));
          console.log(`Worker ${process.pid} listening on port ${PORT}`);
          console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
          console.log(`Process ID: ${process.pid}`);
          console.log(`Memory usage: ${JSON.stringify(process.memoryUsage())}`);
          console.log("=".repeat(50));
        });
      }

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
          if (wsHandler) {
            console.log("Closing WebSocket connections...");
            await wsHandler.gracefulShutdown();
            console.log("WebSocket server closed successfully");
          }

          clearTimeout(shutdownTimeout);
          console.log("Graceful shutdown completed");
          process.exit(0);
        } catch (error) {
          console.error(`Worker ${process.pid} shutdown error:`, error);
          process.exit(1);
        }
      }

      return server;
    } catch (error) {
      console.error(`Worker ${process.pid} failed to start:`, error);
      throw error;
    }
  }

  // Start the worker
  setupWorker().catch((err) => {
    console.error(`Worker ${process.pid} setup failed:`, err);
    process.exit(1);
  });
}

module.exports = { app };
