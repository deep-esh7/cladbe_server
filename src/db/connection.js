const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

class Database {
  constructor() {
    this._pool = null;
    this.initializePool();
  }

  initializePool() {
    try {
      const dbConfig = {
        user: process.env.PGUSER,
        password: process.env.PGPASSWORD,
        host: process.env.PGHOST,
        port: process.env.PGPORT,
        database: process.env.PGDATABASE,
        connectionString: process.env.DATABASE_URL,
        ssl: {
          rejectUnauthorized: false,
        },
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
        application_name: "cladbe_server",
      };

      this._pool = new Pool(dbConfig);

      this._pool.on("error", (err) => {
        console.error("Unexpected error on idle client", err);
        process.exit(-1);
      });

      this._pool.on("connect", (client) => {
        console.log("New client connected to database");
        client.on("error", (err) => {
          console.error("Database client error:", err);
        });
      });

      console.log("Database pool initialized successfully");
    } catch (error) {
      console.error("Failed to initialize database pool:", error);
      throw error;
    }
  }

  get pool() {
    if (!this._pool) {
      this.initializePool();
    }
    return this._pool;
  }

  async query(text, params) {
    const client = await this.pool.connect();
    try {
      const start = Date.now();
      const result = await client.query(text, params);
      const duration = Date.now() - start;

      console.log({
        query: text,
        params,
        duration,
        rowCount: result.rowCount,
      });

      return result;
    } catch (error) {
      console.error("Database query error:", {
        error: error.message,
        query: text,
        params,
      });
      throw error;
    } finally {
      client.release();
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
      return result.rows.length > 0;
    } catch (error) {
      console.error("Database health check failed:", error);
      return false;
    }
  }

  async executeSchema(schemaPath) {
    const client = await this.pool.connect();
    try {
      const schemaSql = fs.readFileSync(schemaPath, "utf8");
      await client.query(schemaSql);
      console.log("Schema executed successfully.");
    } catch (error) {
      console.error("Error executing schema:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async close() {
    try {
      if (this._pool) {
        await this._pool.end();
        this._pool = null;
        console.log("Database pool closed successfully");
      }
    } catch (error) {
      console.error("Error closing database pool:", error);
      throw error;
    }
  }
}

// Create and export singleton instance
const db = new Database();

module.exports = db;

// Export method to create new instance (useful for testing)
module.exports.createNewDatabase = () => new Database();
