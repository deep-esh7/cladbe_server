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

if (cluster.isMaster) {
  console.log(`Master ${process.pid} is running`);

  // Store worker references
  const workers = new Map();

  // Fork workers
  for (let i = 0; i < numCPUs; i++) {
    const worker = cluster.fork();
    workers.set(worker.id, worker);

    // Listen for messages from worker
    worker.on("message", (message) => {
      if (message.type === "websocket_broadcast") {
        // Broadcast to all workers except sender
        for (const [id, w] of workers) {
          if (id !== worker.id) {
            w.send({ type: "websocket_message", data: message.data });
          }
        }
      }
    });
  }

  // Handle worker events
  cluster.on("exit", (worker, code, signal) => {
    console.log(`Worker ${worker.id} died. Restarting...`);
    workers.delete(worker.id);
    const newWorker = cluster.fork();
    workers.set(newWorker.id, newWorker);
  });

  // Handle master process shutdown
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
  const app = express();
  let notificationListener;
  let sqlExecutor;
  let clientSqlHelper;
  let wsHandler;

  // Initialize notification listener for each worker
  async function setupNotificationListener(pool) {
    notificationListener = new pg.Client(pool.options);
    await notificationListener.connect();

    notificationListener.on("notification", async (msg) => {
      try {
        const payload = JSON.parse(msg.payload);
        if (wsHandler) {
          await wsHandler.handleDatabaseChange(payload.table);
          process.send({
            type: "websocket_broadcast",
            data: {
              event: "database_change",
              payload: payload,
            },
          });
        }
      } catch (e) {
        console.error("Error handling database notification:", e);
      }
    });

    await notificationListener.query("LISTEN table_changes");
    return notificationListener;
  }

  // Handle messages from master
  process.on("message", async (message) => {
    if (message.type === "shutdown") {
      await gracefulShutdown("SIGTERM");
    } else if (message.type === "websocket_message" && wsHandler) {
      wsHandler.broadcast(message.data);
    }
  });

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

  // Request logging middleware
  app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    const requestId = Math.random().toString(36).substring(7);
    console.log(
      `[${timestamp}] Worker ${process.pid} - RequestID: ${requestId}`
    );
    console.log(`Method: ${req.method} URL: ${req.url}`);
    console.log("Headers:", req.headers);
    console.log("Query Parameters:", req.query);
    console.log("Body:", req.body);
    res.setHeader("X-Request-ID", requestId);
    next();
  });

  // Health check route
  app.get("/health", (req, res) => {
    const healthInfo = {
      status: "ok",
      timestamp: new Date().toISOString(),
      service: "leads-api",
      environment: process.env.NODE_ENV || "development",
      dbConnection: !!db.pool,
      webSocketStatus: wsHandler ? "connected" : "disconnected",
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      workerId: process.pid,
    };
    res.status(200).json(healthInfo);
  });

  // Main routes
  app.use("/api/leads", leadsRoutes);
  app.post("/api/fetchAgentData", fetchAgentData);
  app.post("/fetchAgentData", fetchAgentData);

  // SQL Query Routes
  app.post("/api/sql/query", async (req, res) => {
    try {
      if (!clientSqlHelper) throw new Error("SQL components not initialized");
      const { query, parameters } = req.body;
      console.log("Executing SQL query:", {
        query,
        parameters,
        timestamp: new Date().toISOString(),
      });
      const result = await clientSqlHelper.executeRead(query, parameters);
      res.json({ success: true, data: result });
    } catch (error) {
      console.error("Query execution failed:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post("/api/sql/execute", async (req, res) => {
    try {
      if (!clientSqlHelper) throw new Error("SQL components not initialized");
      const { query, parameters } = req.body;

      if (query.trim().toUpperCase().startsWith("INSERT")) {
        await clientSqlHelper.ensureTableExists(query, parameters);
      }

      const result = await clientSqlHelper.executeWrite(query, parameters);
      res.json({ success: true, data: result });
    } catch (error) {
      console.error("Command execution failed:", error);
      if (error.code === "42P01") {
        res.status(500).json({
          success: false,
          error: "Table does not exist",
          details: error.message,
        });
      } else {
        res.status(500).json({
          success: false,
          error: error.message,
          details: error.stack,
        });
      }
    }
  });

  // Table Operations Routes
  app.get("/api/sql/table/:tableName/exists", async (req, res) => {
    try {
      if (!clientSqlHelper) throw new Error("SQL components not initialized");
      const { tableName } = req.params;
      const exists = await clientSqlHelper.tableExists(tableName);
      res.json({ success: true, exists });
    } catch (error) {
      console.error("Table exists check failed:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get("/api/sql/table/:tableName/columns", async (req, res) => {
    try {
      if (!clientSqlHelper) throw new Error("SQL components not initialized");
      const { tableName } = req.params;
      const columns = await clientSqlHelper.getTableColumns(tableName);
      res.json({
        success: true,
        columns: columns.map((col) => ({
          name: col.column_name,
          dataType: col.data_type,
          isNullable: col.is_nullable === "YES",
          defaultValue: col.column_default,
          length: col.length,
          precision: col.precision,
          scale: col.scale,
        })),
      });
    } catch (error) {
      console.error("Get columns failed:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post("/api/sql/table/create", async (req, res) => {
    try {
      if (!clientSqlHelper) throw new Error("SQL components not initialized");
      const { tableName, columns } = req.body;
      validateTableDefinition({ columns });
      await clientSqlHelper.createTable(tableName, columns);
      res.json({
        success: true,
        message: `Table ${tableName} created successfully`,
      });
    } catch (error) {
      console.error("Table creation failed:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.delete("/api/sql/table/:tableName", async (req, res) => {
    try {
      if (!clientSqlHelper) throw new Error("SQL components not initialized");
      const { tableName } = req.params;
      const { cascade } = req.body;
      await clientSqlHelper.dropTable(tableName, cascade);
      res.json({ success: true });
    } catch (error) {
      console.error("Table drop failed:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Transaction Routes
  app.post("/api/sql/transaction-begin", async (req, res) => {
    try {
      if (!clientSqlHelper) throw new Error("SQL components not initialized");
      const transactionId = Math.random().toString(36).substring(7);
      console.log(`Beginning transaction: ${transactionId}`);
      await clientSqlHelper.executeWrite("BEGIN");
      res.json({ success: true, transactionId });
    } catch (error) {
      console.error("Transaction begin failed:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post("/api/sql/transaction-commit", async (req, res) => {
    try {
      if (!clientSqlHelper) throw new Error("SQL components not initialized");
      const { transactionId } = req.body;
      console.log(`Committing transaction: ${transactionId}`);
      await clientSqlHelper.executeWrite("COMMIT");
      res.json({ success: true });
    } catch (error) {
      console.error("Transaction commit failed:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post("/api/sql/transaction-rollback", async (req, res) => {
    try {
      if (!clientSqlHelper) throw new Error("SQL components not initialized");
      const { transactionId } = req.body;
      console.log(`Rolling back transaction: ${transactionId}`);
      await clientSqlHelper.executeWrite("ROLLBACK");
      res.json({ success: true });
    } catch (error) {
      console.error("Transaction rollback failed:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Batch Operations
  app.post("/api/sql/batch", async (req, res) => {
    try {
      if (!clientSqlHelper) throw new Error("SQL components not initialized");
      const { queries } = req.body;
      console.log("Executing batch queries:", queries.length);
      const results = await clientSqlHelper.executeTransaction(queries);
      res.json({ success: true, data: results });
    } catch (error) {
      console.error("Batch operation failed:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Table definition validation
  function validateTableDefinition(tableDefinition) {
    if (!tableDefinition || !Array.isArray(tableDefinition.columns)) {
      throw new Error("Invalid table definition structure");
    }

    for (const column of tableDefinition.columns) {
      if (!column.name || !column.type) {
        throw new Error("Invalid column definition");
      }
    }
  }

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
        database: false,
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

      if (db.pool) {
        console.log("Closing database connections...");
        try {
          await db.pool.end();
          shutdown.database = true;
          console.log("Database connections closed successfully");
        } catch (error) {
          console.error("Error closing database pool:", error);
        }
      }

      if (notificationListener) {
        await notificationListener.end();
      }

      clearTimeout(shutdownTimeout);
      console.log("Shutdown status:", shutdown);

      if (shutdown.websocket && shutdown.database) {
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

  async function startServer() {
    try {
      console.log(`Worker ${process.pid} starting...`);

      const sqlInitialized = await initializeSqlComponents();
      if (!sqlInitialized)
        throw new Error("Failed to initialize SQL components");

      const dbInitialized = await initializeDatabase();
      if (!dbInitialized) throw new Error("Failed to initialize database");

      const server = app.listen(PORT, "0.0.0.0", () => {
        console.log("=".repeat(50));
        console.log(`Worker ${process.pid} listening on port ${PORT}`);
        console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
        console.log(
          `API base URL: https://cladbeserver-production.up.railway.app`
        );
        console.log(
          `WebSocket URL: wss://cladbeserver-production.up.railway.app/ws`
        );
        console.log(`Process ID: ${process.pid}`);
        console.log(`Memory usage: ${JSON.stringify(process.memoryUsage())}`);
        console.log("=".repeat(50));
      });

      server.timeout = 120000;
      server.keepAliveTimeout = 65000;

      server.on("listening", () => {
        console.log(
          `Server bound to ${server.address().address}:${server.address().port}`
        );
      });

      const wsInitialized = await initializeWebSocket(server);
      if (!wsInitialized) throw new Error("Failed to initialize WebSocket");

      return server;
    } catch (error) {
      console.error(`Worker ${process.pid} failed to start:`, error);
      process.exit(1);
    }
  }

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

  // Start the worker
  startServer().catch((err) => {
    console.error(`Worker ${process.pid} failed to start:`, err);
    process.exit(1);
  });
}

module.exports = { app };
