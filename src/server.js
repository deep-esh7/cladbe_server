const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const path = require("path");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const WebSocketHandler = require("./websocket/webSocketHandler.js");
const { fetchAgentData } = require("./test/testCallFetch");

// Import database and helper dependencies
const db = require("./db/connection.js");
const { DatabaseHelper } = require("./Helpers/databaseHelper");
const { TableHelper } = require("./Helpers/leadsTableHelper");
const leadsRoutes = require("./routes/leadsSearch.routes");
const pg = require("pg"); // Add this at the top with other imports

const app = express();
// Add this with other global variables
let notificationListener;

//aaa

// Initialize PostgreSQL notification listener
async function setupNotificationListener(pool) {
  notificationListener = new pg.Client(pool.options);
  await notificationListener.connect();

  notificationListener.on("notification", async (msg) => {
    try {
      const payload = JSON.parse(msg.payload);
      if (wsHandler) {
        await wsHandler.handleDatabaseChange(payload.table);
      }
    } catch (e) {
      console.error("Error handling database notification:", e);
    }
  });

  await notificationListener.query("LISTEN table_changes");
  return notificationListener;
}

// Initialize variables for SQL components
let sqlExecutor;
let clientSqlHelper;
let wsHandler;

app.set("trust proxy", true);

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  trustProxy: true,
  message: "Too many requests, please try again later.",
  keyGenerator: (req) => {
    return req.ip; // IP address from the most-trusted source
  },
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
    console.log("Executing SQL command:", {
      query,
      parameters,
      timestamp: new Date().toISOString(),
    });

    // Handle auto table creation for INSERT queries
    if (query.trim().toUpperCase().startsWith("INSERT")) {
      try {
        await clientSqlHelper.ensureTableExists(query, parameters);
      } catch (error) {
        console.error("Table creation failed:", error);
        throw error;
      }
    }

    // Execute the query
    const result = await clientSqlHelper.executeWrite(query, parameters);
    res.json({ success: true, data: result });
  } catch (error) {
    console.error("Command execution failed:", error);
    if (error.code === "42P01") {
      // PostgreSQL error code for undefined_table
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

// Optional: Add table definition validation middleware
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
    const SqlQueryExecutor = require("./Helpers/sqlQueryExecutor");
    sqlExecutor = new SqlQueryExecutor(db.pool);

    // Test database connection
    const client = await db.pool.connect();
    try {
      const result = await client.query(
        "SELECT NOW() as current_time, version() as pg_version"
      );
      console.log("Database connection test successful:", {
        currentTime: result.rows[0].current_time,
        postgresVersion: result.rows[0].pg_version,
      });
    } finally {
      client.release();
    }
    console.log("SQL executor initialized and tested");

    // Initialize client SQL helper
    const ClientSqlHelper = require("./Helpers/clientSqlHelper");
    clientSqlHelper = new ClientSqlHelper(sqlExecutor);

    // Verify SQL helper initialization
    await clientSqlHelper.executeRead("SELECT 1");
    console.log("Client SQL helper initialized and verified");

    return true;
  } catch (error) {
    console.error("Failed to initialize SQL components:", error);
    await handleSqlInitializationError(error);
    return false;
  }
}

// Helper function for SQL initialization errors
async function handleSqlInitializationError(error) {
  if (error.code === "ECONNREFUSED") {
    console.error(
      "Could not connect to database. Please check if database server is running."
    );
    return;
  }
  if (error.code === "28P01") {
    console.error("Invalid database credentials");
    return;
  }
  console.error("Unhandled SQL initialization error:", error);
}

// Initialize WebSocket
async function initializeWebSocket(server) {
  try {
    console.log("Initializing WebSocket handler...");

    // Initialize WebSocket handler with PostgreSQL pool
    wsHandler = new WebSocketHandler(server, clientSqlHelper, db.pool);

    // Setup notification listener for real-time updates
    await wsHandler.setupNotificationListener();

    // Add error handling for the WebSocket server
    wsHandler.wss.on("error", (error) => {
      console.error("WebSocket server error:", error);
    });

    console.log("WebSocket handler initialized successfully");
    return true;
  } catch (error) {
    console.error("Failed to initialize WebSocket handler:", error);
    if (error.code === "EADDRINUSE") {
      console.error("WebSocket port is already in use");
    }
    return false;
  }
}

// 2. Database Initialization
async function initializeDatabase() {
  try {
    console.log("Starting database initialization...");

    const dbHelper = new DatabaseHelper(db.pool);
    const tableHelper = new TableHelper(db.pool);

    // Check and create database if needed
    const dbExists = await dbHelper.checkDatabaseExists("cladbe");
    if (!dbExists) {
      console.log("Creating database 'cladbe'...");
      await dbHelper.createDatabase("cladbe");
    }

    // Create enhanced notification function
    await db.pool.query(`
      CREATE OR REPLACE FUNCTION notify_table_change() RETURNS TRIGGER AS $$
      DECLARE
        payload jsonb;
      BEGIN
        -- Build payload based on operation type
        payload = json_build_object(
          'table', TG_TABLE_NAME,
          'operation', TG_OP,
          'schema', TG_TABLE_SCHEMA,
          'old_data', CASE 
            WHEN TG_OP = 'DELETE' THEN row_to_json(OLD)
            WHEN TG_OP = 'UPDATE' THEN row_to_json(OLD)
            ELSE NULL 
          END,
          'new_data', CASE 
            WHEN TG_OP IN ('INSERT', 'UPDATE') THEN row_to_json(NEW)
            ELSE NULL 
          END,
          'timestamp', CURRENT_TIMESTAMP,
          'transaction_id', txid_current()
        );

        -- Send notification
        PERFORM pg_notify('table_changes', payload::text);
        
        -- Handle different operations
        IF TG_OP = 'DELETE' THEN
          RETURN OLD;
        END IF;
        
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    // Create tables and setup initial structures
    console.log("Setting up tables and indexes...");
    await tableHelper.createLeadsSearchTable();

    // Verify database setup
    const tables = await clientSqlHelper.getAllTables();
    console.log(`Initialized with ${tables.length} tables`);

    console.log("Database initialization completed successfully");
    return true;
  } catch (error) {
    console.error("Database initialization failed:", error);
    console.error("Stack trace:", error.stack);
    await handleDatabaseInitializationError(error);
    return false;
  }
}

// Helper function for database initialization errors
async function handleDatabaseInitializationError(error) {
  if (error.code === "42P04") {
    console.log("Database already exists, continuing...");
    return;
  }
  if (error.code === "3D000") {
    console.error("Database does not exist and cannot be created");
    return;
  }
  console.error("Unhandled database initialization error:", error);
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
// Modified startServer function
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

    // Start server with increased timeouts for long-running operations
    const server = app.listen(PORT, "0.0.0.0", () => {
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

    server.on("listening", () => {
      console.log(
        `Server bound to ${server.address().address}:${server.address().port}`
      );
    });

    // Increase server timeouts
    server.timeout = 120000; // 2 minutes
    server.keepAliveTimeout = 65000;

    // Initialize WebSocket after server starts
    const wsInitialized = await initializeWebSocket(server);
    if (!wsInitialized) {
      throw new Error("Failed to initialize WebSocket");
    }

    // Enhanced error handling for server
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

async function gracefulShutdown(signal) {
  console.log(
    `${signal || "Shutdown"} signal received. Starting graceful shutdown...`
  );

  let shutdownTimeout = setTimeout(() => {
    console.error(
      "Could not close connections in time, forcefully shutting down"
    );
    process.exit(1);
  }, 30000);

  try {
    // Track shutdown progress
    const shutdown = {
      websocket: false,
      database: false,
    };

    // Close WebSocket connections gracefully
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

    // Close database connections
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

    clearTimeout(shutdownTimeout);

    // Final shutdown status
    console.log("Shutdown status:", shutdown);
    if (shutdown.websocket && shutdown.database) {
      console.log("Graceful shutdown completed successfully");
      process.exit(0);
    } else {
      console.log("Partial shutdown completed with errors");
      process.exit(1);
    }
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
//emptyt

// Start the server and export for testing
const server = startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
module.exports = {
  app,
  server,
  initializeWebSocket,
  initializeDatabase,
  initializeSqlComponents,
  gracefulShutdown,
};
