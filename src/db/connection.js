// File: Database.js
const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");
require("dotenv").config({
  path: path.resolve(__dirname, "../../.env"),
  debug: process.env.DEBUG,
});

class Database {
  constructor() {
    this._pool = null;
    this._retry = 0;
    this._maxRetries = 3;
    this._debugMode = process.env.DEBUG === "true";
    this._queryLog = [];
    this._maxQueryLogSize = 100;
    this._activeTransactions = new Set();
    this.initializePool();
  }

  debug(...args) {
    if (this._debugMode) {
      const timestamp = new Date().toISOString();
      console.log(`[Database Debug ${timestamp}]`, ...args);
    }
  }

  logQuery(query, params, duration, error = null) {
    const queryInfo = {
      timestamp: new Date().toISOString(),
      query,
      params,
      duration,
      error: error ? { message: error.message, code: error.code } : null,
      transactionId: this._getCurrentTransactionId(),
    };

    this._queryLog.unshift(queryInfo);
    if (this._queryLog.length > this._maxQueryLogSize) {
      this._queryLog.pop();
    }

    this.debug("Query logged:", queryInfo);
  }

  _getCurrentTransactionId() {
    return [...this._activeTransactions].slice(-1)[0];
  }

  initializePool() {
    try {
      this.validateEnvVariables();

      const dbConfig = {
        user: process.env.PGUSER,
        password: process.env.PGPASSWORD,
        host: process.env.PGHOST,
        port: parseInt(process.env.PGPORT),
        database: process.env.PGDATABASE,
        ...(process.env.DATABASE_URL && {
          connectionString: process.env.DATABASE_URL,
        }),
        ssl: {
          rejectUnauthorized: false,
        },
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
        application_name: "cladbe_server",
      };

      this.debug("Initializing pool with config:", {
        ...dbConfig,
        password: "***HIDDEN***",
      });

      this._pool = new Pool(dbConfig);

      this._pool.on("error", (err) => {
        this.debug("Pool error:", err);
        this.handlePoolError(err);
      });

      this._pool.on("connect", async (client) => {
        this.debug("New client connected");

        try {
          await client.query("SET session_replication_role = replica;");
          await client.query("SET synchronous_commit = on;");
          this.debug("Session parameters set successfully");
        } catch (err) {
          this.debug("Error setting session parameters:", err);
        }

        client.on("error", (err) => {
          this.debug("Client error:", err);
        });

        client.on("notice", (notice) => {
          this.debug("Database notice:", notice);
        });
      });

      this.debug("Pool initialized successfully");
    } catch (error) {
      this.debug("Pool initialization failed:", error);
      this.handleInitializationError(error);
    }
  }

  validateEnvVariables() {
    const required = ["PGUSER", "PGPASSWORD", "PGHOST", "PGPORT", "PGDATABASE"];
    const missing = required.filter((key) => !process.env[key]);

    if (missing.length) {
      throw new Error(
        `Missing required environment variables: ${missing.join(", ")}`
      );
    }
  }

  async handlePoolError(error) {
    this.debug("Pool error occurred:", error);

    if (this._retry < this._maxRetries) {
      this._retry++;
      this.debug(
        `Attempting to reconnect... (${this._retry}/${this._maxRetries})`
      );
      await this.close();
      setTimeout(() => this.initializePool(), 5000);
    } else {
      this.debug("Max retry attempts reached");
      process.exit(-1);
    }
  }

  handleInitializationError(error) {
    this.debug("Initialization Error Details:", {
      code: error.code,
      message: error.message,
      stack: error.stack,
    });
    throw error;
  }

  async query(text, params) {
    const queryId = Math.random().toString(36).substring(7);
    let client;
    const startTime = Date.now();

    try {
      this.debug(`[Query ${queryId}] Starting execution:`, { text, params });
      client = await this.pool.connect();

      const result = await client.query(text, params);
      const duration = Date.now() - startTime;

      this.debug(`[Query ${queryId}] Completed in ${duration}ms:`, {
        rowCount: result.rowCount,
        command: result.command,
      });

      this.logQuery(text, params, duration);
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.debug(`[Query ${queryId}] Failed after ${duration}ms:`, error);
      this.logQuery(text, params, duration, error);
      throw error;
    } finally {
      if (client) {
        client.release();
        this.debug(`[Query ${queryId}] Client released`);
      }
    }
  }

  async transaction(callback) {
    const transactionId = Math.random().toString(36).substring(7);
    const client = await this.pool.connect();
    const startTime = Date.now();

    try {
      this.debug(`[Transaction ${transactionId}] Starting`);
      this._activeTransactions.add(transactionId);

      await client.query("BEGIN");
      const result = await callback(client);
      await client.query("COMMIT");

      const duration = Date.now() - startTime;
      this.debug(
        `[Transaction ${transactionId}] Committed after ${duration}ms`
      );
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.debug(
        `[Transaction ${transactionId}] Failed after ${duration}ms:`,
        error
      );

      try {
        await client.query("ROLLBACK");
        this.debug(`[Transaction ${transactionId}] Rolled back`);
      } catch (rollbackError) {
        this.debug(
          `[Transaction ${transactionId}] Rollback failed:`,
          rollbackError
        );
      }

      throw error;
    } finally {
      this._activeTransactions.delete(transactionId);
      client.release();
      this.debug(`[Transaction ${transactionId}] Client released`);
    }
  }

  async verifyConnection() {
    try {
      await this.query("SELECT 1");

      const diagnostics = await this.runDiagnostics();
      this.debug("Connection verified successfully:", diagnostics);

      return true;
    } catch (error) {
      this.debug("Connection verification failed:", error);
      return false;
    }
  }

  async runDiagnostics() {
    try {
      this.debug("Running diagnostics");

      const diagnostics = {
        poolStatus: {
          totalCount: this._pool.totalCount,
          idleCount: this._pool.idleCount,
          waitingCount: this._pool.waitingCount,
        },
        postgresVersion: await this.query("SELECT version()"),
        currentConnections: await this.query(`
          SELECT count(*) as active_connections 
          FROM pg_stat_activity 
          WHERE state = 'active'
        `),
        databaseSize: await this.query(`
          SELECT pg_size_pretty(pg_database_size(current_database())) as db_size
        `),
        activeTransactions: this._activeTransactions.size,
        recentQueries: this._queryLog.slice(0, 5),
      };

      this.debug("Diagnostics results:", diagnostics);
      return diagnostics;
    } catch (error) {
      this.debug("Diagnostics failed:", error);
      throw error;
    }
  }

  get pool() {
    if (!this._pool) {
      this.initializePool();
    }
    return this._pool;
  }

  async close() {
    if (this._pool) {
      this.debug("Closing database pool...");
      try {
        await this._pool.end();
        this._pool = null;
        this.debug("Database pool closed successfully");
      } catch (error) {
        this.debug("Error closing pool:", error);
        throw error;
      }
    }
  }
}

// Create and export singleton instance
const db = new Database();

// Verify connection on startup
db.verifyConnection().then((success) => {
  if (!success) {
    console.error("Initial connection verification failed");
    process.exit(1);
  }
});

module.exports = db;
module.exports.createNewDatabase = () => new Database();
