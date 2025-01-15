// SqlQueryExecutor.js

class DatabaseError extends Error {
  constructor(message, code, query, params) {
    super(message);
    this.name = "DatabaseError";
    this.code = code;
    this.query = query;
    this.params = params;
    this.timestamp = new Date().toISOString();
    console.error(`[DatabaseError] ${code}: ${message}`);
    console.error("Query:", query);
    console.error("Parameters:", params);
  }
}

class SqlQueryExecutor {
  constructor(pool) {
    console.log("Initializing SqlQueryExecutor...");
    this.pool = pool;
    this.retryDelay = 1000;
    this.maxRetries = 3;
    this.slowQueryThreshold = 1000;
    this._debugMode = true;
    this._metrics = {
      totalQueries: 0,
      slowQueries: 0,
      errors: 0,
      totalDuration: 0,
    };

    this._queryHistory = new Map();

    this.pool.on("error", (err) => {
      this._metrics.errors++;
      console.error("[Pool Error]", err);
    });

    console.log("SqlQueryExecutor initialized successfully");
  }

  log(message, ...args) {
    console.log(`[${new Date().toISOString()}] ${message}`, ...args);
  }

  logError(message, ...args) {
    console.error(`[${new Date().toISOString()}] ERROR: ${message}`, ...args);
  }

  // Add the missing testConnection method
  async testConnection() {
    try {
      console.log("Testing database connection...");
      const client = await this.pool.connect();

      try {
        await client.query("SELECT NOW()");
        console.log("Database connection test successful");
        return true;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error("Database connection test failed:", error);
      throw new DatabaseError(
        "Failed to establish database connection",
        "CONNECTION_TEST_FAILED",
        "SELECT NOW()",
        []
      );
    }
  }

  async executeQuery(query, params = [], options = {}) {
    const queryId = Math.random().toString(36).substring(7);
    this.log(`Starting query execution [${queryId}]`);
    this.log("Query:", query);
    this.log("Parameters:", params);

    let client;
    const startTime = Date.now();

    try {
      client = await this.acquireConnection();
      this.log(`Connection acquired for query [${queryId}]`);

      // Validate and sanitize parameters
      this.validateQueryAndParams(query, params);
      const sanitizedParams = this.sanitizeParams(params);

      // Execute query with timeout
      const result = await this.executeWithTimeout(
        client,
        query,
        sanitizedParams,
        options.timeout || 30000
      );

      const duration = Date.now() - startTime;
      await this.recordMetrics(queryId, duration, result);

      this.log(`Query [${queryId}] completed successfully in ${duration}ms`);
      return result.rows;
    } catch (error) {
      this.logError(`Query [${queryId}] failed:`, error);
      await this.handleError(queryId, error, query, params, startTime);
      throw error;
    } finally {
      if (client) {
        await this.releaseConnection(client);
        this.log(`Connection released for query [${queryId}]`);
      }
    }
  }

  validateQueryAndParams(query, params = []) {
    this.log("Validating query and parameters");
    const paramMatches = query.match(/\$\d+/g) || [];
    const paramCount = paramMatches.length;

    if (paramCount !== params.length) {
      this.logError("Parameter count mismatch", {
        expected: paramCount,
        received: params.length,
      });
      throw new DatabaseError(
        `Parameter count mismatch. Expected ${paramCount}, got ${params.length}`,
        "PARAM_MISMATCH",
        query,
        params
      );
    }

    // Validate parameter numbering
    const paramNumbers = paramMatches
      .map((p) => parseInt(p.substring(1)))
      .sort((a, b) => a - b);

    for (let i = 0; i < paramNumbers.length; i++) {
      if (paramNumbers[i] !== i + 1) {
        this.logError("Invalid parameter sequence", {
          expected: i + 1,
          received: paramNumbers[i],
        });
        throw new DatabaseError(
          "Invalid parameter numbering. Must be sequential",
          "PARAM_SEQUENCE",
          query,
          params
        );
      }
    }
    this.log("Query and parameters validated successfully");
  }

  sanitizeParams(params) {
    this.log("Sanitizing parameters");
    return params.map((param) => {
      if (param === null || param === undefined) {
        return null;
      }
      if (typeof param === "string") {
        // Basic SQL injection prevention
        return param.replace(/[\0\x08\x09\x1a\n\r"'\\\%]/g, (char) => {
          switch (char) {
            case "\0":
              return "\\0";
            case "\x08":
              return "\\b";
            case "\x09":
              return "\\t";
            case "\x1a":
              return "\\z";
            case "\n":
              return "\\n";
            case "\r":
              return "\\r";
            case '"':
            case "'":
            case "\\":
            case "%":
              return "\\" + char;
            default:
              return char;
          }
        });
      }
      if (param instanceof Date) {
        return param.toISOString();
      }
      return param;
    });
  }

  async executeWithTimeout(client, query, params, timeout) {
    this.log(`Executing query with ${timeout}ms timeout`);
    return Promise.race([
      client.query(query, params),
      new Promise((_, reject) =>
        setTimeout(() => {
          this.logError("Query timeout reached");
          reject(new Error("Query timeout"));
        }, timeout)
      ),
    ]);
  }

  async acquireConnection() {
    let retries = 0;
    while (retries < this.maxRetries) {
      try {
        this.log(
          `Attempting to acquire connection (attempt ${retries + 1}/${
            this.maxRetries
          })`
        );
        const client = await this.pool.connect();
        this.log("Connection acquired successfully");
        return client;
      } catch (error) {
        retries++;
        this.logError(
          `Failed to acquire connection (attempt ${retries}):`,
          error
        );
        if (retries === this.maxRetries) throw error;
        await new Promise((resolve) => setTimeout(resolve, this.retryDelay));
      }
    }
  }

  async releaseConnection(client) {
    if (client) {
      try {
        this.log("Releasing connection");
        await client.release();
        this.log("Connection released successfully");
      } catch (error) {
        this.logError("Error releasing client:", error);
      }
    }
  }

  async recordMetrics(queryId, duration, result) {
    this.log(`Recording metrics for query [${queryId}]`);
    this._metrics.totalQueries++;
    this._metrics.totalDuration += duration;

    if (duration > this.slowQueryThreshold) {
      this._metrics.slowQueries++;
      this.log(`[Query ${queryId}] Slow query detected: ${duration}ms`);
    }

    this._queryHistory.set(queryId, {
      duration,
      rowCount: result.rowCount,
      timestamp: new Date().toISOString(),
      success: true,
    });
    this.log("Metrics recorded successfully");
  }

  async handleError(queryId, error, query, params, startTime) {
    const duration = Date.now() - startTime;
    this._metrics.errors++;

    this.logError(`Error in query [${queryId}]:`, {
      error: error.message,
      duration,
      query,
      params,
    });

    this._queryHistory.set(queryId, {
      query,
      params,
      error: error.message,
      duration,
      timestamp: new Date().toISOString(),
      success: false,
    });
  }

  async executeTransaction(queries) {
    const transactionId = Math.random().toString(36).substring(7);
    this.log(`Starting transaction [${transactionId}]`);

    const client = await this.acquireConnection();
    try {
      await client.query("BEGIN");
      this.log(`Transaction [${transactionId}] began`);

      const results = [];
      for (const { query, params = [] } of queries) {
        this.log(`Executing query in transaction [${transactionId}]:`, query);
        const result = await this.executeWithTimeout(
          client,
          query,
          this.sanitizeParams(params),
          30000
        );
        results.push(result.rows);
      }

      await client.query("COMMIT");
      this.log(`Transaction [${transactionId}] committed successfully`);
      return results;
    } catch (error) {
      this.logError(`Transaction [${transactionId}] failed:`, error);
      await client.query("ROLLBACK");
      this.log(`Transaction [${transactionId}] rolled back`);
      throw error;
    } finally {
      await this.releaseConnection(client);
    }
  }

  async getMetrics() {
    this.log("Retrieving metrics");
    const metrics = {
      ...this._metrics,
      averageDuration:
        this._metrics.totalDuration / Math.max(this._metrics.totalQueries, 1),
      errorRate: this._metrics.errors / Math.max(this._metrics.totalQueries, 1),
    };
    this.log("Current metrics:", metrics);
    return metrics;
  }

  async getQueryHistory(limit = 10) {
    this.log(`Retrieving query history (limit: ${limit})`);
    const history = Array.from(this._queryHistory.entries())
      .sort((a, b) => new Date(b[1].timestamp) - new Date(a[1].timestamp))
      .slice(0, limit)
      .map(([id, details]) => ({
        queryId: id,
        ...details,
      }));
    this.log(`Retrieved ${history.length} history entries`);
    return history;
  }

  clearQueryHistory() {
    this.log("Clearing query history");
    this._queryHistory.clear();
    this.log("Query history cleared");
  }
}

module.exports = SqlQueryExecutor;
