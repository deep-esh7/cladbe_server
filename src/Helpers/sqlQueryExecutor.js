// File: src/Helpers/SqlQueryExecutor.js

class DatabaseError extends Error {
  constructor(message, code, query, params) {
    super(message);
    this.name = "DatabaseError";
    this.code = code;
    this.query = query;
    this.params = params;
    this.timestamp = new Date().toISOString();
  }
}

class SqlQueryExecutor {
  constructor(pool) {
    this.pool = pool;
    this.retryDelay = 1000; // 1 second delay for retries
    this.maxRetries = 3; // Maximum number of retries

    this.pool.on("error", (err) => {
      console.error("Unexpected error on idle client", err);
    });
  }

  validateQueryAndParams(query, params = []) {
    // Count number of parameter placeholders ($1, $2, etc.)
    const paramMatches = query.match(/\$\d+/g) || [];
    const paramCount = paramMatches.length;

    // Verify parameter count matches
    if (paramCount !== params.length) {
      throw new DatabaseError(
        `Parameter count mismatch. Query expects ${paramCount} parameters but got ${params.length}`,
        "PARAM_COUNT_MISMATCH",
        query,
        params
      );
    }

    // Verify parameter numbering is sequential and starts from 1
    const paramNumbers = paramMatches
      .map((p) => parseInt(p.substring(1)))
      .sort((a, b) => a - b);

    for (let i = 0; i < paramNumbers.length; i++) {
      if (paramNumbers[i] !== i + 1) {
        throw new DatabaseError(
          `Invalid parameter numbering. Parameters must be sequential starting from $1`,
          "INVALID_PARAM_NUMBERING",
          query,
          params
        );
      }
    }
  }

  sanitizeParams(params) {
    return params.map((param) => {
      if (param === null || param === undefined) return null;
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
          }
        });
      }
      if (param instanceof Date) {
        return param.toISOString();
      }
      return param;
    });
  }

  async executeQuery(query, params = [], retryCount = 0) {
    const client = await this.pool.connect();
    try {
      console.log("Executing query:", {
        query,
        params,
        timestamp: new Date().toISOString(),
      });

      // Validate and sanitize parameters
      this.validateQueryAndParams(query, params);
      const sanitizedParams = this.sanitizeParams(params);

      const result = await client.query(query, sanitizedParams);

      console.log("Query successful:", {
        rowCount: result.rowCount,
        timestamp: new Date().toISOString(),
      });

      return result.rows;
    } catch (error) {
      if (error.code === "42P01" && retryCount < this.maxRetries) {
        // Table does not exist - retry case
        console.log(
          `Table does not exist, attempt ${retryCount + 1} of ${
            this.maxRetries
          }`
        );
        await new Promise((resolve) => setTimeout(resolve, this.retryDelay));
        return this.executeQuery(query, params, retryCount + 1);
      }

      console.error("Query execution error:", {
        error: error.message,
        code: error.code,
        detail: error.detail,
        query,
        params,
        timestamp: new Date().toISOString(),
      });

      throw new DatabaseError(error.message, error.code, query, params);
    } finally {
      client.release();
    }
  }

  async executeTransaction(queries, retryCount = 0) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const results = [];
      for (const { query, params = [] } of queries) {
        console.log("Executing transaction query:", {
          query,
          params,
          timestamp: new Date().toISOString(),
        });

        try {
          // Validate and sanitize each query in the transaction
          this.validateQueryAndParams(query, params);
          const sanitizedParams = this.sanitizeParams(params);

          const result = await client.query(query, sanitizedParams);
          results.push(result.rows);
        } catch (error) {
          if (error.code === "42P01" && retryCount < this.maxRetries) {
            console.log(
              `Table does not exist in transaction, attempt ${
                retryCount + 1
              } of ${this.maxRetries}`
            );
            await client.query("ROLLBACK");
            await new Promise((resolve) =>
              setTimeout(resolve, this.retryDelay)
            );
            return this.executeTransaction(queries, retryCount + 1);
          }
          throw error;
        }
      }

      await client.query("COMMIT");
      return results;
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Transaction error:", {
        error: error.message,
        code: error.code,
        detail: error.detail,
        timestamp: new Date().toISOString(),
      });
      throw new DatabaseError(
        error.message,
        error.code,
        "Transaction",
        queries
      );
    } finally {
      client.release();
    }
  }

  async executePreparedStatement(name, query, params = []) {
    const client = await this.pool.connect();
    try {
      console.log("Preparing statement:", {
        name,
        query,
        params,
        timestamp: new Date().toISOString(),
      });

      // Validate parameters
      this.validateQueryAndParams(query, params);
      const sanitizedParams = this.sanitizeParams(params);

      // First, deallocate if exists to avoid conflicts
      try {
        await client.query(`DEALLOCATE IF EXISTS "${name}"`);
      } catch (error) {
        console.log("Deallocate not needed:", error.message);
      }

      // Prepare the statement
      await client.query(`PREPARE "${name}" AS ${query}`);

      // Execute the prepared statement
      const result = await client.query(
        `EXECUTE "${name}"($1)`,
        sanitizedParams
      );

      // Deallocate to clean up
      await client.query(`DEALLOCATE "${name}"`);

      return result.rows;
    } catch (error) {
      console.error("Prepared statement error:", {
        error: error.message,
        code: error.code,
        name,
        query,
        params,
        timestamp: new Date().toISOString(),
      });
      throw new DatabaseError(error.message, error.code, query, params);
    } finally {
      client.release();
    }
  }

  async executeWithLock(tableName, operation, timeout = 30000) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // Set statement timeout
      await client.query(`SET LOCAL statement_timeout = ${timeout}`);

      console.log(`Acquiring lock on table ${tableName}...`);
      await client.query(`LOCK TABLE ${tableName} IN ACCESS EXCLUSIVE MODE`);

      const result = await operation(client);

      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Lock operation error:", {
        error: error.message,
        code: error.code,
        table: tableName,
        timestamp: new Date().toISOString(),
      });
      throw new DatabaseError(
        error.message,
        error.code,
        `LOCK TABLE ${tableName}`,
        null
      );
    } finally {
      client.release();
    }
  }

  async checkTableExists(tableName) {
    const query = `
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = $1
      );
    `;
    const result = await this.executeQuery(query, [tableName]);
    return result[0].exists;
  }

  async getTableColumns(tableName) {
    const query = `
      SELECT 
        column_name,
        data_type,
        is_nullable,
        column_default,
        character_maximum_length,
        numeric_precision,
        numeric_scale,
        udt_name,
        is_identity
      FROM information_schema.columns
      WHERE table_name = $1
      ORDER BY ordinal_position;
    `;
    return this.executeQuery(query, [tableName]);
  }

  async vacuum(tableName, analyze = true) {
    const client = await this.pool.connect();
    try {
      // Need to run outside a transaction
      const query = `VACUUM ${analyze ? "ANALYZE" : ""} ${tableName}`;
      console.log(`Executing VACUUM on ${tableName}:`, query);
      await client.query(query);
      console.log(`VACUUM completed on ${tableName}`);
    } catch (error) {
      console.error(`VACUUM failed on ${tableName}:`, error);
      throw new DatabaseError(
        error.message,
        error.code,
        `VACUUM ${tableName}`,
        null
      );
    } finally {
      client.release();
    }
  }

  async analyzeTable(tableName) {
    const client = await this.pool.connect();
    try {
      const query = `ANALYZE ${tableName}`;
      console.log(`Analyzing table ${tableName}`);
      await client.query(query);
      console.log(`Analysis completed on ${tableName}`);
    } catch (error) {
      console.error(`Analysis failed on ${tableName}:`, error);
      throw new DatabaseError(
        error.message,
        error.code,
        `ANALYZE ${tableName}`,
        null
      );
    } finally {
      client.release();
    }
  }
}

module.exports = SqlQueryExecutor;
