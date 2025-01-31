const cluster = require("cluster");
const numCPUs = require("os").cpus().length;
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const path = require("path");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const WebSocket = require("ws");
const sticky = require("sticky-session");
const { fetchAgentData } = require("./test/testCallFetch");
const leadsRoutes = require("./routes/leadsSearch.routes");

// Create express app instance
const app = express();
let wsHandler;

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
            w.send({
              type: "websocket_message",
              data: message.data,
            });
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
  let wss;

  // Basic server setup
  app.set("trust proxy", true);
  app.disable("x-powered-by");

  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    standardHeaders: true,
    legacyHeaders: false,
    trustProxy: true,
    skip: (req) => req.path === "/health",
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
  app.use(
    morgan("dev", {
      skip: (req) => req.path === "/health",
    })
  );
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

  // SQL Query Routes - Modified to return mock responses
  app.post("/api/sql/query", async (req, res) => {
    res.json({ success: true, data: [] });
  });

  app.post("/api/sql/execute", async (req, res) => {
    res.json({ success: true, data: [] });
  });

  // Table Operations
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

  // Transaction Routes
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

  // Batch Operations
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

  // Initialize optimized WebSocket server
  function setupWebSocketServer(server) {
    wss = new WebSocket.Server({
      server,
      perMessageDeflate: false,
      maxPayload: 50 * 1024 * 1024,
      clientTracking: true,
      backlog: 1024,
    });

    function heartbeat() {
      this.isAlive = true;
    }

    wss.on("connection", function (ws) {
      ws.isAlive = true;
      ws.on("pong", heartbeat);

      // Handle messages
      ws.on("message", function (data) {
        try {
          // Broadcast to other workers
          process.send({
            type: "websocket_broadcast",
            data: data.toString(),
          });

          // Broadcast to clients in this worker
          wss.clients.forEach(function (client) {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              client.send(data.toString());
            }
          });
        } catch (err) {
          console.error("Error handling message:", err);
        }
      });

      ws.send(JSON.stringify({ type: "connected", workerId: process.pid }));
    });

    // Clean up dead connections
    const interval = setInterval(function ping() {
      wss.clients.forEach(function (ws) {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping(() => {});
      });
    }, 30000);

    wss.on("close", function close() {
      clearInterval(interval);
    });

    wss.on("error", function (error) {
      console.error("WebSocket server error:", error);
    });

    return wss;
  }

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
      };

      if (wss) {
        console.log("Closing WebSocket connections...");
        try {
          wss.clients.forEach((client) => {
            client.close();
          });
          wss.close();
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

  // Handle worker messages
  process.on("message", async (message) => {
    if (message.type === "shutdown") {
      await gracefulShutdown("SIGTERM");
    } else if (message.type === "websocket_message" && wss) {
      wss.clients.forEach(function (client) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(message.data);
        }
      });
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

    // Optimize server settings
    server.keepAliveTimeout = 65000;
    server.headersTimeout = 66000;
    server.timeout = 120000;
    server.maxConnections = 10000;

    // Enable sticky sessions
    sticky.listen(server, PORT);

    // Setup WebSocket server
    setupWebSocketServer(server);
  } catch (error) {
    console.error(`Worker ${process.pid} failed to start:`, error);
    process.exit(1);
  }
}

module.exports = { app };
