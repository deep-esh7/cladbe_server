const cluster = require("cluster");
const numCPUs = require("os").cpus().length;
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const WebSocket = require("ws");
const sticky = require("sticky-session");
const { fetchAgentData } = require("./test/testCallFetch");

// Create express app instance
const app = express();

if (cluster.isMaster) {
  console.log(`Master ${process.pid} is running`);

  // Store active workers
  const workers = new Map();

  // Create worker processes
  for (let i = 0; i < numCPUs; i++) {
    const worker = cluster.fork();
    workers.set(worker.id, worker);

    // Handle messages from workers
    worker.on("message", (message) => {
      if (message.type === "websocket_broadcast") {
        // Broadcast to all other workers
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

  // Handle worker exits
  cluster.on("exit", (worker, code, signal) => {
    console.log(`Worker ${worker.id} died. Restarting...`);
    workers.delete(worker.id);
    const newWorker = cluster.fork();
    workers.set(newWorker.id, newWorker);
  });
} else {
  // Worker process
  let wss;

  // Basic server setup
  app.set("trust proxy", true);
  app.disable("x-powered-by");

  // Optimize rate limiter
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000, // Increased limit
    standardHeaders: true,
    legacyHeaders: false,
    trustProxy: true,
    skip: (req) => req.path === "/health",
  });

  const corsOptions = {
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
    maxAge: 86400,
  };

  // Middleware
  app.use(helmet());
  app.use(cors(corsOptions));
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: true, limit: "50mb" }));
  app.use(
    morgan("dev", {
      skip: (req) => req.path === "/health",
    })
  );
  app.use(limiter);

  // Health check
  app.get("/health", (_, res) => res.status(200).send("healthy"));

  // Routes
  app.post("/api/fetchAgentData", fetchAgentData);

  // Initialize WebSocket server
  function setupWebSocketServer(server) {
    wss = new WebSocket.Server({
      server,
      perMessageDeflate: false, // Disable compression for better performance
      maxPayload: 50 * 1024 * 1024, // 50MB max message size
      clientTracking: true,
      backlog: 1024, // Connection queue size
    });

    // Set up heartbeat to detect stale connections
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

      // Send initial connection success message
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

    // Handle errors
    wss.on("error", function (error) {
      console.error("WebSocket server error:", error);
    });

    return wss;
  }

  // Process event handlers
  process.on("message", async (message) => {
    if (message.type === "websocket_message" && wss) {
      wss.clients.forEach(function (client) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(message.data);
        }
      });
    }
  });

  // Error handling
  process.on("uncaughtException", (error) => {
    console.error(`Worker ${process.pid} uncaught exception:`, error);
  });

  process.on("unhandledRejection", (reason) => {
    console.error(`Worker ${process.pid} unhandled rejection:`, reason);
  });

  // Start server
  const PORT = process.env.PORT || 3000;

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Worker ${process.pid} listening on port ${PORT}`);
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
}

module.exports = { app };
