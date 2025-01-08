const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");
require("dotenv").config({
  path: path.join(__dirname, "../../.env"),
  debug: process.env.DEBUG,
});

class Database {
  constructor() {
    this._pool = null;
    this._retry = 0;
    this._maxRetries = 3;
    this.initializePool();
  }

  initializePool() {
    try {
      // Validate environment variables
      this.validateEnvVariables();

      // Clean configuration without db_type
      const dbConfig = {
        user: process.env.PGUSER,
        password: process.env.PGPASSWORD,
        host: process.env.PGHOST,
        port: parseInt(process.env.PGPORT), // Ensure port is a number
        database: process.env.PGDATABASE,
        // Only use connectionString if no individual params provided
        ...(process.env.DATABASE_URL && {
          connectionString: process.env.DATABASE_URL,
        }),
        ssl: {
          rejectUnauthorized: false,
        },
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000, // Increased timeout
        application_name: "cladbe_server",
      };

      this._pool = new Pool(dbConfig);

      // Add connection error handler
      this._pool.on("error", (err) => {
        console.error("Unexpected error on idle client", err);
        this.handlePoolError(err);
      });

      // Add successful connection handler
      this._pool.on("connect", (client) => {
        console.log("New client connected to database");
        client.on("error", (err) => {
          console.error("Database client error:", err);
        });
      });

      console.log("Database pool initialized successfully");
    } catch (error) {
      console.error("Failed to initialize database pool:", error);
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
    if (this._retry < this._maxRetries) {
      this._retry++;
      console.log(
        `Attempting to reconnect... (${this._retry}/${this._maxRetries})`
      );
      await this.close();
      setTimeout(() => this.initializePool(), 5000); // Wait 5s before retry
    } else {
      console.error("Max retry attempts reached");
      process.exit(-1);
    }
  }

  handleInitializationError(error) {
    console.error("Initialization Error Details:", {
      code: error.code,
      message: error.message,
      stack: error.stack,
    });
    throw error;
  }

  get pool() {
    if (!this._pool) {
      this.initializePool();
    }
    return this._pool;
  }

  async query(text, params) {
    let client;
    try {
      client = await this.pool.connect();
      const start = Date.now();
      const result = await client.query(text, params);
      const duration = Date.now() - start;

      if (process.env.NODE_ENV !== "production") {
        console.log({
          query: text,
          params,
          duration,
          rowCount: result.rowCount,
        });
      }

      return result;
    } catch (error) {
      console.error("Database query error:", {
        error: error.message,
        query: text,
        params,
      });
      throw error;
    } finally {
      if (client) client.release();
    }
  }

  async transaction(callback) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await callback(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async healthCheck() {
    try {
      const result = await this.query("SELECT NOW()");
      console.log("Health check successful:", result.rows[0]);
      return true;
    } catch (error) {
      console.error("Health check failed:", error.message);
      return false;
    }
  }

  async executeSchema(schemaPath) {
    let client;
    try {
      client = await this.pool.connect();
      const schemaSql = fs.readFileSync(schemaPath, "utf8");
      await client.query(schemaSql);
      console.log("Schema executed successfully");
    } catch (error) {
      console.error("Schema execution error:", error.message);
      throw error;
    } finally {
      if (client) client.release();
    }
  }

  async close() {
    if (this._pool) {
      try {
        await this._pool.end();
        this._pool = null;
        console.log("Database pool closed successfully");
      } catch (error) {
        console.error("Error closing pool:", error.message);
        throw error;
      }
    }
  }
}

// Create and export singleton instance
const db = new Database();
module.exports = db;
module.exports.createNewDatabase = () => new Database();
