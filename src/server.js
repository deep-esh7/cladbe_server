const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const path = require("path");

// Import database and helper dependencies
const db = require("./db/connection.js");
const { DatabaseHelper } = require("./Helpers/databaseHelper");
const { TableHelper } = require("./Helpers/leadsTableHelper");
const leadsRoutes = require("./routes/leadsSearch.routes");

const app = express();

// Initialize variables for SQL components
let sqlExecutor;
let clientSqlHelper;

// CORS configuration
const corsOptions = {
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Accept", "Authorization"],
  credentials: true,
  maxAge: 86400,
};

// Middleware
app.use(cors(corsOptions));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(morgan("dev"));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  console.log("Query Parameters:", req.query);
  console.log("Body:", req.body);
  next();
});

// Health check route
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    timestamp: new Date().toISOString(),
    service: "leads-api",
  });
});

// Mount routes with /api prefix
app.use("/api/leads", leadsRoutes);

// Function to initialize SQL components
async function initializeSqlComponents() {
  try {
    console.log("Initializing SQL components...");

    if (!db.pool) {
      throw new Error("Database pool not initialized");
    }

    const SqlQueryExecutor = require("./Helpers/sqlQueryExecutor");
    sqlExecutor = new SqlQueryExecutor(db.pool);
    console.log("SQL executor initialized");

    const ClientSqlHelper = require("./Helpers/clientSqlHelper");
    clientSqlHelper = new ClientSqlHelper(sqlExecutor);
    console.log("Client SQL helper initialized");

    return true;
  } catch (error) {
    console.error("Failed to initialize SQL components:", error);
    return false;
  }
}

// SQL Query Routes
app.post("/api/sql/query", async (req, res) => {
  try {
    if (!clientSqlHelper) throw new Error("SQL components not initialized");

    console.log("Executing SQL query:", req.body);
    const { query, parameters } = req.body;
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

    console.log("Executing SQL command:", req.body);
    const { query, parameters } = req.body;
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

    console.log("Creating table:", req.body);
    const { tableName, query } = req.body;
    await clientSqlHelper.executeWrite(query);
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

    console.log("Beginning transaction");
    await clientSqlHelper.executeWrite("BEGIN");
    res.json({ success: true });
  } catch (error) {
    console.error("Transaction begin failed:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/api/sql/transaction-commit", async (req, res) => {
  try {
    if (!clientSqlHelper) throw new Error("SQL components not initialized");

    console.log("Committing transaction");
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

    console.log("Rolling back transaction");
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
    console.log("Executing batch queries:", queries);
    const results = await clientSqlHelper.executeTransaction(
      queries.map((query) => ({ query, params: [] }))
    );
    res.json({ success: true, data: results });
  } catch (error) {
    console.error("Batch operation failed:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 404 handler
app.use((req, res) => {
  console.log(`404 - Route not found: ${req.method} ${req.url}`);
  res.status(404).json({
    success: false,
    error: "Not Found",
    message: `Cannot ${req.method} ${req.url}`,
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Error occurred:", err);
  console.error("Stack trace:", err.stack);

  const isOperationalError = err.isOperational || false;

  if (err.name === "ValidationError") {
    return res.status(400).json({
      success: false,
      error: "Validation Error",
      message: err.message,
      details: err.details,
    });
  }

  if (err.name === "UnauthorizedError") {
    return res.status(401).json({
      success: false,
      error: "Unauthorized",
      message: "Invalid or missing authentication token",
    });
  }

  res.status(err.status || 500).json({
    success: false,
    error: isOperationalError ? err.message : "Internal Server Error",
    message: isOperationalError ? err.message : "An unexpected error occurred",
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  });
});

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

// Graceful shutdown handler
function gracefulShutdown(signal) {
  console.log(
    `${signal || "Shutdown"} signal received. Starting graceful shutdown...`
  );

  if (db.pool) {
    console.log("Closing database connections...");
    db.pool.end(() => {
      console.log("Database connections closed");
      process.exit(0);
    });
  } else {
    process.exit(0);
  }

  setTimeout(() => {
    console.error(
      "Could not close connections in time, forcefully shutting down"
    );
    process.exit(1);
  }, 10000);
}

// Process error handlers
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
      console.log(`Server running on port ${PORT}`);
      console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
      console.log(
        `API base URL: https://cladbeserver-production.up.railway.app`
      );
    });

    server.on("error", (error) => {
      console.error("Server error:", error);
      if (error.code === "EADDRINUSE") {
        console.error(`Port ${PORT} is already in use`);
        process.exit(1);
      }
    });

    return server;
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

// Start the server and export for testing
const server = startServer();
module.exports = { app, server };
