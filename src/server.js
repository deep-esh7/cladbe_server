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

// Debug mode
const DEBUG = process.env.DEBUG === "true";

function debug(...args) {
  if (DEBUG) {
    console.log("[Server Debug]", ...args);
  }
}

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

// Enhanced request logging middleware
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  const requestId = Math.random().toString(36).substring(7);
  debug(`[${timestamp}][${requestId}] ${req.method} ${req.url}`);
  debug(`[${requestId}] Query Parameters:`, req.query);
  debug(`[${requestId}] Body:`, req.body);

  // Track response time
  const start = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - start;
    debug(
      `[${requestId}] Request completed in ${duration}ms with status ${res.statusCode}`
    );
  });

  next();
});

// Health check route with enhanced diagnostics
app.get("/health", async (req, res) => {
  try {
    const dbStatus = await db.pool.query("SELECT 1");
    const memoryUsage = process.memoryUsage();

    res.status(200).json({
      status: "ok",
      timestamp: new Date().toISOString(),
      service: "leads-api",
      uptime: process.uptime(),
      database: {
        status: dbStatus.rows ? "connected" : "error",
        poolSize: db.pool.totalCount,
        idleConnections: db.pool.idleCount,
        waitingRequests: db.pool.waitingCount,
      },
      memory: {
        heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024) + "MB",
        heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024) + "MB",
        external: Math.round(memoryUsage.external / 1024 / 1024) + "MB",
      },
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      timestamp: new Date().toISOString(),
      error: error.message,
      details: DEBUG ? error.stack : undefined,
    });
  }
});

// Mount routes
app.use("/api/leads", leadsRoutes);

// Debug and monitoring routes
app.get("/api/sql/debug/:tableName", async (req, res) => {
  try {
    if (!clientSqlHelper) throw new Error("SQL components not initialized");
    const { tableName } = req.params;

    // Get table structure
    const structure = await clientSqlHelper.executeRead(
      `
      SELECT 
        column_name, 
        data_type, 
        is_nullable,
        column_default,
        character_maximum_length,
        numeric_precision,
        numeric_scale
      FROM information_schema.columns 
      WHERE table_name = $1
      ORDER BY ordinal_position
    `,
      [tableName]
    );

    // Get constraints
    const constraints = await clientSqlHelper.executeRead(
      `
      SELECT 
        tc.constraint_name,
        tc.constraint_type,
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name
      FROM information_schema.table_constraints tc
      LEFT JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
      LEFT JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
      WHERE tc.table_name = $1
    `,
      [tableName]
    );

    // Get indexes
    const indexes = await clientSqlHelper.executeRead(
      `
      SELECT
        indexname,
        indexdef
      FROM pg_indexes
      WHERE tablename = $1
    `,
      [tableName]
    );

    // Get table statistics
    const stats = await clientSqlHelper.executeRead(
      `
      SELECT 
        n_live_tup as active_rows,
        n_dead_tup as dead_rows,
        seq_scan,
        seq_tup_read,
        idx_scan,
        n_tup_ins as inserts,
        n_tup_upd as updates,
        n_tup_del as deletes,
        last_vacuum,
        last_analyze
      FROM pg_stat_user_tables
      WHERE relname = $1
    `,
      [tableName]
    );

    // Get sample data
    const sampleData = await clientSqlHelper.executeRead(`
      SELECT * FROM ${tableName} LIMIT 10
    `);

    res.json({
      success: true,
      debug: {
        structure: structure,
        constraints: constraints,
        indexes: indexes,
        statistics: stats[0],
        sampleData: sampleData,
      },
    });
  } catch (error) {
    console.error("Debug failed:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// SQL Query Routes
app.post("/api/sql/query", async (req, res) => {
  try {
    if (!clientSqlHelper) throw new Error("SQL components not initialized");

    debug("Executing SQL query:", req.body);
    const { query, parameters } = req.body;
    const startTime = Date.now();

    const result = await clientSqlHelper.executeRead(query, parameters);

    const duration = Date.now() - startTime;
    debug(`Query executed in ${duration}ms`);

    res.json({
      success: true,
      data: result,
      execution_time: duration,
    });
  } catch (error) {
    console.error("Query execution failed:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Enhanced execute route with transaction handling
app.post("/api/sql/execute", async (req, res) => {
  try {
    if (!clientSqlHelper) throw new Error("SQL components not initialized");

    debug("Executing SQL command:", req.body);
    const { query, parameters } = req.body;
    const startTime = Date.now();

    // Begin transaction
    await clientSqlHelper.executeWrite("BEGIN");

    try {
      // Execute the main query
      const result = await clientSqlHelper.executeWrite(query, parameters);

      // Get affected rows
      const impactCheck = await clientSqlHelper.executeRead(
        "SELECT xact_rows_modified() as affected_rows"
      );

      // Commit transaction
      await clientSqlHelper.executeWrite("COMMIT");

      const duration = Date.now() - startTime;
      debug(`Command executed in ${duration}ms`);

      res.json({
        success: true,
        data: result,
        affected_rows: impactCheck[0]?.affected_rows || 0,
        execution_time: duration,
      });
    } catch (error) {
      await clientSqlHelper.executeWrite("ROLLBACK");
      throw error;
    }
  } catch (error) {
    console.error("Command execution failed:", error);
    res.status(500).json({
      success: false,
      error: error.message,
      details: DEBUG
        ? {
            code: error.code,
            query: error.query,
            params: error.params,
          }
        : undefined,
    });
  }
});

// Table operations routes
app.get("/api/sql/table/:tableName/exists", async (req, res) => {
  try {
    if (!clientSqlHelper) throw new Error("SQL components not initialized");

    const { tableName } = req.params;
    debug(`Checking if table exists: ${tableName}`);
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
    debug(`Getting columns for table: ${tableName}`);
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

    debug("Creating table:", req.body);
    const { tableName, query } = req.body;

    await clientSqlHelper.executeWrite("BEGIN");
    try {
      await clientSqlHelper.executeWrite(query);
      await clientSqlHelper.executeWrite("COMMIT");

      res.json({
        success: true,
        message: `Table ${tableName} created successfully`,
      });
    } catch (error) {
      await clientSqlHelper.executeWrite("ROLLBACK");
      throw error;
    }
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
    await clientSqlHelper.executeWrite("BEGIN");
    try {
      await clientSqlHelper.dropTable(tableName, cascade);
      await clientSqlHelper.executeWrite("COMMIT");
      res.json({ success: true });
    } catch (error) {
      await clientSqlHelper.executeWrite("ROLLBACK");
      throw error;
    }
  } catch (error) {
    console.error("Table drop failed:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Transaction Routes
app.post("/api/sql/transaction-begin", async (req, res) => {
  try {
    if (!clientSqlHelper) throw new Error("SQL components not initialized");

    debug("Beginning transaction");
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

    debug("Committing transaction");
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

    debug("Rolling back transaction");
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

    debug("Executing batch queries:", req.body);
    const { queries } = req.body;
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

// Enhanced error handling middleware
app.use((err, req, res, next) => {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] Error occurred:`, err);
  console.error("Stack trace:", err.stack);

  const response = {
    success: false,
    timestamp,
    error: err.name || "Error",
    message: err.message || "An unexpected error occurred",
  };

  if (DEBUG) {
    response.debug = {
      stack: err.stack,
      code: err.code,
      query: err.query,
      params: err.params,
    };
  }

  // Handle specific error types
  if (err.name === "ValidationError") {
    return res.status(400).json({
      ...response,
      error: "Validation Error",
      details: err.details,
    });
  }

  if (err.name === "UnauthorizedError") {
    return res.status(401).json({
      ...response,
      error: "Unauthorized",
      message: "Invalid or missing authentication token",
    });
  }

  res.status(err.status || 500).json(response);
});

// Initialize components with enhanced error handling
async function initializeSqlComponents() {
  try {
    debug("Initializing SQL components...");

    if (!db.pool) {
      throw new Error("Database pool not initialized");
    }

    const SqlQueryExecutor = require("./Helpers/sqlQueryExecutor");
    sqlExecutor = new SqlQueryExecutor(db.pool);
    debug("SQL executor initialized");

    // Set default transaction isolation level
    await db.pool.query(
      "SET SESSION CHARACTERISTICS AS TRANSACTION ISOLATION LEVEL READ COMMITTED"
    );
    debug("Transaction isolation level set");

    const ClientSqlHelper = require("./Helpers/clientSqlHelper");
    clientSqlHelper = new ClientSqlHelper(sqlExecutor);
    debug("Client SQL helper initialized");

    return true;
  } catch (error) {
    console.error("Failed to initialize SQL components:", error);
    return false;
  }
}

// Initialize database with enhanced error handling
async function initializeDatabase() {
  try {
    debug("Starting database initialization...");

    const dbHelper = new DatabaseHelper(db.pool);
    const tableHelper = new TableHelper(db.pool);

    // Check database existence
    const dbExists = await dbHelper.checkDatabaseExists("cladbe");
    if (!dbExists) {
      debug("Creating database 'cladbe'...");
      await dbHelper.createDatabase("cladbe");
      debug("Database created successfully");
    } else {
      debug("Database 'cladbe' already exists");
    }

    // Setup tables and indexes
    debug("Setting up tables and indexes...");
    await tableHelper.createLeadsSearchTable();

    // Verify database setup
    const tables = await db.pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);
    debug(
      "Available tables:",
      tables.rows.map((r) => r.table_name)
    );

    debug("Database initialization completed successfully");
    return true;
  } catch (error) {
    console.error("Database initialization failed:", error);
    console.error("Stack trace:", error.stack);
    return false;
  }
}

// Enhanced graceful shutdown handler
function gracefulShutdown(signal) {
  const shutdownTime = new Date().toISOString();
  console.log(
    `[${shutdownTime}] ${
      signal || "Shutdown"
    } signal received. Starting graceful shutdown...`
  );

  if (db.pool) {
    console.log("Closing database connections...");
    db.pool.end(() => {
      console.log("Database connections closed successfully");
      process.exit(0);
    });
  } else {
    process.exit(0);
  }

  // Force shutdown after timeout
  setTimeout(() => {
    console.error(
      `[${new Date().toISOString()}] Could not close connections in time, forcefully shutting down`
    );
    process.exit(1);
  }, 10000);
}

// Process error handlers
process.on("uncaughtException", (error) => {
  console.error(`[${new Date().toISOString()}] Uncaught Exception:`, error);
  console.error("Stack:", error.stack);
  gracefulShutdown("UNCAUGHT_EXCEPTION");
});

process.on("unhandledRejection", (reason, promise) => {
  console.error(
    `[${new Date().toISOString()}] Unhandled Rejection at:`,
    promise
  );
  console.error("Reason:", reason);
  gracefulShutdown("UNHANDLED_REJECTION");
});

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

const PORT = process.env.PORT || 3000;

// Enhanced server startup
async function startServer() {
  try {
    debug("Starting server initialization...");

    // Initialize SQL components first
    debug("Initializing SQL components...");
    const sqlInitialized = await initializeSqlComponents();
    if (!sqlInitialized) {
      throw new Error("Failed to initialize SQL components");
    }

    // Initialize database
    debug("Initializing database...");
    const dbInitialized = await initializeDatabase();
    if (!dbInitialized) {
      throw new Error("Failed to initialize database");
    }

    // Start server
    const server = app.listen(PORT, () => {
      const startTime = new Date().toISOString();
      console.log(`[${startTime}] Server running on port ${PORT}`);
      console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
      console.log(`Debug mode: ${DEBUG ? "enabled" : "disabled"}`);
      console.log(
        `API base URL: https://cladbeserver-production.up.railway.app`
      );
    });

    // Enhanced error handling for server
    server.on("error", (error) => {
      console.error(`[${new Date().toISOString()}] Server error:`, error);
      if (error.code === "EADDRINUSE") {
        console.error(`Port ${PORT} is already in use`);
        process.exit(1);
      }
    });

    // Add server ready event handler
    server.on("listening", () => {
      debug("Server is ready to accept connections");
    });

    return server;
  } catch (error) {
    console.error(
      `[${new Date().toISOString()}] Failed to start server:`,
      error
    );
    process.exit(1);
  }
}

// Start the server and export for testing
const server = startServer();
module.exports = { app, server };
