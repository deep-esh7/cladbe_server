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
const sticky = require("sticky-session");

// Create express app instance at top level
const app = express();
let wsHandler;

// Basic server setup with optimized settings
app.set("trust proxy", true);
app.set("x-powered-by", false);

// Optimize rate limiter for clustering
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500, // Increased for higher concurrency
  standardHeaders: true,
  legacyHeaders: false,
  trustProxy: true,
  message: "Too many requests, please try again later.",
  keyGenerator: (req) => req.ip,
  skip: (req) => req.path === "/health", // Skip health checks
});

const corsOptions = {
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Accept", "Authorization"],
  credentials: true,
  maxAge: 86400,
  websocket: true,
};

// Optimized middleware setup
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
app.use(
  morgan("dev", {
    skip: (req) => req.path === "/health", // Skip logging health checks
  })
);
app.use(limiter);

// Efficient request logging
app.use((req, res, next) => {
  if (req.path !== "/health") {
    // Skip logging health checks
    const requestId = Math.random().toString(36).substring(7);
    res.setHeader("X-Request-ID", requestId);
  }
  next();
});

if (cluster.isMaster) {
  console.log(`Master ${process.pid} is running`);
  const workers = new Map();

  // Create workers
  for (let i = 0; i < numCPUs; i++) {
    const worker = cluster.fork();
    workers.set(worker.id, worker);

    // Improved worker message handling
    worker.on("message", (message) => {
      if (message.type === "websocket_broadcast") {
        // Broadcast to other workers
        for (const [id, w] of workers) {
          if (id !== worker.id) {
            w.send({ type: "websocket_message", data: message.data });
          }
        }
      }
    });
  }

  // Efficient worker management
  cluster.on("exit", (worker, code, signal) => {
    console.log(`Worker ${worker.id} died. Restarting...`);
    workers.delete(worker.id);
    const newWorker = cluster.fork();
    workers.set(newWorker.id, newWorker);
  });

  // Graceful master shutdown
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
    // Routes
    app.get("/health", (req, res) => {
      res.status(200).json("healthy");
    });

    app.use("/api/leads", leadsRoutes);
    app.post("/api/fetchAgentData", fetchAgentData);
    app.post("/fetchAgentData", fetchAgentData);

    // Mock SQL routes with efficient responses
    app.post("/api/sql/query", (req, res) => {
      res.json({ success: true, data: [] });
    });

    app.post("/api/sql/execute", (req, res) => {
      res.json({ success: true, data: [] });
    });

    // Error handling middleware
    app.use((err, req, res, next) => {
      const timestamp = new Date().toISOString();
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

    // Initialize WebSocket with sticky sessions
    async function initializeWebSocket(server) {
      try {
        console.log(`Worker ${process.pid} initializing WebSocket...`);
        wsHandler = new WebSocketHandler(server);

        // Setup sticky sessions
        sticky.listen(server, process.env.PORT || 3000);

        wsHandler.wss.on("error", (error) => {
          console.error("WebSocket server error:", error);
        });

        return true;
      } catch (error) {
        console.error("Failed to initialize WebSocket:", error);
        return false;
      }
    }

    // Efficient graceful shutdown
    async function gracefulShutdown(signal) {
      console.log(
        `Worker ${process.pid} received ${signal}. Starting graceful shutdown...`
      );

      const shutdownTimeout = setTimeout(() => {
        process.exit(1);
      }, 30000);

      try {
        if (wsHandler) {
          await wsHandler.gracefulShutdown();
        }

        clearTimeout(shutdownTimeout);
        process.exit(0);
      } catch (error) {
        console.error(`Worker ${process.pid} shutdown error:`, error);
        process.exit(1);
      }
    }

    // Worker message handling
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
      gracefulShutdown("UNCAUGHT_EXCEPTION");
    });

    process.on("unhandledRejection", (reason) => {
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
      });

      // Optimized server settings
      server.keepAliveTimeout = 65000;
      server.headersTimeout = 66000;
      server.timeout = 120000;

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

module.exports = { app };
