const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const { DatabaseHelper } = require("../src/Helpers/databaseHelper.js");
const { TableHelper } = require("./Helpers/leadsTableHelper.js");
const leadsRoutes = require("./routes/leadsSearch.routes.js");
const db = require("../src/db/connection.js");
const SqlQueryExecutor = require("./Helpers/sqlQueryExecutor");
const ClientSqlHelper = require("./Helpers/clientSqlHelper");

const app = express();

// Initialize SQL components
const sqlExecutor = new SqlQueryExecutor(db.pool);
const clientSqlHelper = new ClientSqlHelper(sqlExecutor);

// CORS configuration
const corsOptions = {
  origin: "*", // In production, replace with your specific origins
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Accept", "Authorization"],
  credentials: true,
  maxAge: 86400, // 24 hours
};

// Middleware
app.use(cors(corsOptions));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(morgan("dev")); // Logging

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

// SQL Routes
app.post("/api/sql/query", async (req, res) => {
  try {
    const { query, params } = req.body;
    const result = await clientSqlHelper.query(query, params);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/api/sql/execute", async (req, res) => {
  try {
    const { query, params } = req.body;
    const result = await clientSqlHelper.execute(query, params);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/api/sql/transaction", async (req, res) => {
  try {
    const { queries } = req.body;
    const result = await clientSqlHelper.executeTransaction(queries);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Table Operations
app.post("/api/sql/table/create", async (req, res) => {
  try {
    const { tableName, columns } = req.body;
    const result = await clientSqlHelper.createTable(tableName, columns);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete("/api/sql/table/:tableName", async (req, res) => {
  try {
    const { tableName } = req.params;
    await clientSqlHelper.dropTable(tableName);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/api/sql/table/:tableName/columns", async (req, res) => {
  try {
    const { tableName } = req.params;
    const columns = await clientSqlHelper.getTableColumns(tableName);
    res.json({ success: true, data: columns });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Column Operations
app.post("/api/sql/table/:tableName/column", async (req, res) => {
  try {
    const { tableName } = req.params;
    const { columnName, columnType, constraints } = req.body;
    await clientSqlHelper.addColumn(
      tableName,
      columnName,
      columnType,
      constraints
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete("/api/sql/table/:tableName/column/:columnName", async (req, res) => {
  try {
    const { tableName, columnName } = req.params;
    await clientSqlHelper.dropColumn(tableName, columnName);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 404 handler
app.use((req, res, next) => {
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

  // Determine if error is operational or programming
  const isOperationalError = err.isOperational || false;

  // Handle different types of errors
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

  // Default error response
  res.status(err.status || 500).json({
    success: false,
    error: isOperationalError ? err.message : "Internal Server Error",
    message: isOperationalError ? err.message : "An unexpected error occurred",
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  });
});

// Process error handlers
process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
  console.error("Stack:", error.stack);
  gracefulShutdown();
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
  gracefulShutdown();
});

const PORT = process.env.PORT || 3000;

async function initializeDatabase() {
  try {
    console.log("Starting database initialization...");

    // Initialize database helpers
    const dbHelper = new DatabaseHelper(db.pool);
    const tableHelper = new TableHelper(db.pool);

    // Check if database exists, if not create it
    const dbExists = await dbHelper.checkDatabaseExists("cladbe");
    if (!dbExists) {
      console.log("Creating database 'cladbe'...");
      await dbHelper.createDatabase("cladbe");
      console.log("Database created successfully");
    } else {
      console.log("Database 'cladbe' already exists");
    }

    // Create leads table and required indexes
    console.log("Setting up tables and indexes...");
    await tableHelper.createLeadsSearchTable();

    console.log("Tables and indexes created successfully");
    console.log("Database initialization completed successfully");
    return true;
  } catch (error) {
    console.error("Database initialization failed:", error);
    console.error("Stack trace:", error.stack);
    return false;
  }
}

function gracefulShutdown(signal) {
  console.log(
    `${signal || "Shutdown"} signal received. Starting graceful shutdown...`
  );

  // Close database connection
  if (db.pool) {
    console.log("Closing database connections...");
    db.pool.end(() => {
      console.log("Database connections closed");
      process.exit(0);
    });
  } else {
    process.exit(0);
  }

  // If shutdown hasn't completed in 10 seconds, force exit
  setTimeout(() => {
    console.error(
      "Could not close connections in time, forcefully shutting down"
    );
    process.exit(1);
  }, 10000);
}

// Graceful shutdown handlers
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// Start server
let server;
async function startServer() {
  try {
    const dbInitialized = await initializeDatabase();
    if (!dbInitialized) {
      console.error("Failed to initialize database. Exiting...");
      process.exit(1);
    }

    server = app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
      console.log(
        `API base URL: https://cladbeserver-production.up.railway.app:${PORT}`
      );
    });

    // Add error handler for server
    server.on("error", (error) => {
      console.error("Server error:", error);
      if (error.code === "EADDRINUSE") {
        console.error(`Port ${PORT} is already in use`);
        process.exit(1);
      }
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

startServer();

module.exports = { app, server }; // Export for testing purposes
