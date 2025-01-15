const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const path = require("path");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const WebSocketHandler = require("./websocket/webSocketHandler.js");

// Import database and helper dependencies
const db = require("./db/connection.js");
const { DatabaseHelper } = require("./Helpers/databaseHelper");
const { TableHelper } = require("./Helpers/leadsTableHelper");
const leadsRoutes = require("./routes/leadsSearch.routes");

const app = express();

// Initialize variables for SQL components
let sqlExecutor;
let clientSqlHelper;
let wsHandler;

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many requests, please try again later.",
});

// CORS configuration with WebSocket support
const corsOptions = {
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Accept", "Authorization"],
  credentials: true,
  maxAge: 86400,
  websocket: true,
};

// Enhanced security middleware with WebSocket allowances
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'", "ws:", "wss:"], // Allow WebSocket connections
      },
    },
  })
);

// Middleware
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
  const healthInfo = {
    status: "ok",
    timestamp: new Date().toISOString(),
    service: "leads-api",
    environment: process.env.NODE_ENV || "development",
    dbConnection: !!db.pool,
    webSocketStatus: wsHandler ? "connected" : "disconnected",
    uptime: process.uptime(),
    memory: process.memoryUsage(),
  };

  res.status(200).json(healthInfo);
});

// Routes
app.use("/api/leads", leadsRoutes);

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
    console.log("Executing SQL command:", {
      query,
      parameters,
      timestamp: new Date().toISOString(),
    });

    const result = await clientSqlHelper.executeWrite(query, parameters);
    res.json({ success: true, data: result });
  } catch (error) {
    console.error("Command execution failed:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/api/sql/table/:tableName/exists", async (req, res) => {
  try {
    if (!clientSqlHelper) throw new Error("SQL components not initialized");

    const { tableName } = req.params;
    console.log(`Checking if table exists: ${tableName}`);
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
    console.log(`Getting columns for table: ${tableName}`);
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
    console.log("Creating table:", { tableName, columns });
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

// Then in your initializeSqlComponents function, replace it with:
async function initializeSqlComponents() {
  try {
    console.log("Initializing SQL components...");

    if (!db.pool) {
      throw new Error("Database pool not initialized");
    }

    // Initialize SQL executor with connection test
    sqlExecutor = new SqlQueryExecutor(db.pool);
    const client = await db.pool.connect();
    try {
      await client.query("SELECT NOW()");
      console.log("Database connection test successful");
    } finally {
      client.release();
    }
    console.log("SQL executor initialized and tested");

    // Initialize client SQL helper
    clientSqlHelper = new ClientSqlHelper(sqlExecutor);
    console.log("Client SQL helper initialized");

    return true;
  } catch (error) {
    console.error("Failed to initialize SQL components:", error);
    return false;
  }
}

// Initialize WebSocket
function initializeWebSocket(server) {
  try {
    console.log("Initializing WebSocket handler...");
    wsHandler = new WebSocketHandler(server, clientSqlHelper);
    console.log("WebSocket handler initialized successfully");
    return true;
  } catch (error) {
    console.error("Failed to initialize WebSocket handler:", error);
    return false;
  }
}

// Initialize database
async function initializeDatabase() {
  try {
    console.log("Starting database initialization...");

    const dbHelper = new DatabaseHelper(db.pool);
    const tableHelper = new TableHelper(db.pool);

    const dbExists = await dbHelper.checkDatabaseExists("cladbe");
    if (!dbExists) {
      console.log("Creating database 'cladbe'...");
      await dbHelper.createDatabase("cladbe");
      console.log("Database created successfully");
    } else {
      console.log("Database 'cladbe' already exists");
    }

    console.log("Setting up tables and indexes...");
    await tableHelper.createLeadsSearchTable();
    console.log("Database initialization completed successfully");
    return true;
  } catch (error) {
    console.error("Database initialization failed:", error);
    console.error("Stack trace:", error.stack);
    return false;
  }
}

// Error handling middleware
app.use((err, req, res, next) => {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] Error occurred:`, err);

  const response = {
    success: false,
    error: err.message || "Internal Server Error",
    requestId: req.headers["x-request-id"],
    timestamp,
  };

  if (process.env.NODE_ENV === "development") {
    response.stack = err.stack;
  }

  res.status(err.status || 500).json(response);
});

// Start server
async function startServer() {
  try {
    console.log("Starting server initialization...");

    // Initialize SQL components first
    const sqlInitialized = await initializeSqlComponents();
    if (!sqlInitialized) {
      throw new Error("Failed to initialize SQL components");
    }

    // Initialize database
    const dbInitialized = await initializeDatabase();
    if (!dbInitialized) {
      throw new Error("Failed to initialize database");
    }

    // Start server
    const server = app.listen(PORT, () => {
      console.log("=".repeat(50));
      console.log(`Server running on port ${PORT}`);
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

    // Initialize WebSocket after server starts
    const wsInitialized = initializeWebSocket(server);
    if (!wsInitialized) {
      throw new Error("Failed to initialize WebSocket");
    }

    server.on("error", (error) => {
      console.error("Server error:", error);
      if (error.code === "EADDRINUSE") {
        console.error(`Port ${PORT} is already in use`);
        process.exit(1);
      }
    });

    // Setup server timeout handling
    server.timeout = 30000;
    server.keepAliveTimeout = 65000;

    return server;
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

// Graceful shutdown handler
async function gracefulShutdown(signal) {
  console.log(
    `${signal || "Shutdown"} signal received. Starting graceful shutdown...`
  );

  let shutdownTimeout = setTimeout(() => {
    console.error(
      "Could not close connections in time, forcefully shutting down"
    );
    process.exit(1);
  }, 10000);

  try {
    // Close WebSocket connections
    if (wsHandler) {
      console.log("Closing WebSocket connections...");
      wsHandler.wss.close(() => {
        console.log("WebSocket server closed successfully");
      });
    }

    if (db.pool) {
      console.log("Closing database connections...");
      await db.pool.end();
      console.log("Database connections closed successfully");
    }

    clearTimeout(shutdownTimeout);
    console.log("Graceful shutdown completed");
    process.exit(0);
  } catch (error) {
    console.error("Error during shutdown:", error);
    process.exit(1);
  }
}

// Process event handlers
process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
  console.error("Stack:", error.stack);
  gracefulShutdown("UNCAUGHT_EXCEPTION");
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
  gracefulShutdown("UNHANDLED_REJECTION");
});

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

const PORT = process.env.PORT || 3000;

// Start the server and export for testing
const server = startServer();
module.exports = { app, server };
