// File: SqlQueryExecutor.js
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
    this.retryDelay = 1000;
    this.maxRetries = 3;
    this._debugMode = process.env.DEBUG === "true";
    this._queryHistory = new Map();

    this.pool.on("error", (err) => {
      this.debug("Pool error:", err);
    });
  }

  debug(...args) {
    if (this._debugMode) {
      console.log("[SqlQueryExecutor Debug]", ...args);
    }
  }

  async verifyTableContents(tableName) {
    const client = await this.pool.connect();
    try {
      this.debug(`Verifying contents for table: ${tableName}`);

      // Check table definition
      const structure = await client.query(
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
        ORDER BY ordinal_position;
      `,
        [tableName]
      );

      // Check constraints
      const constraints = await client.query(
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
        WHERE tc.table_name = $1;
      `,
        [tableName]
      );

      // Get row count
      const countResult = await client.query(
        `SELECT COUNT(*) FROM ${tableName}`
      );

      // Get sample data
      const sampleData = await client.query(`
        SELECT * FROM ${tableName} 
        ORDER BY ${this._getPrimaryKeyColumn(structure.rows) || "1"} 
        LIMIT 5
      `);

      // Get table statistics
      const stats = await client.query(
        `
        SELECT * FROM pg_stat_user_tables
        WHERE relname = $1
      `,
        [tableName]
      );

      // Check for recent modifications
      const modifications = await client.query(
        `
        SELECT 
          schemaname,
          relname,
          n_tup_ins as inserts,
          n_tup_upd as updates,
          n_tup_del as deletes,
          n_live_tup as live_tuples,
          n_dead_tup as dead_tuples,
          last_vacuum,
          last_analyze
        FROM pg_stat_user_tables
        WHERE relname = $1
      `,
        [tableName]
      );

      const verificationResults = {
        structure: structure.rows,
        constraints: constraints.rows,
        rowCount: parseInt(countResult.rows[0].count),
        sampleData: sampleData.rows,
        statistics: stats.rows[0],
        modifications: modifications.rows[0],
      };

      this.debug("Table verification results:", verificationResults);
      return verificationResults;
    } catch (error) {
      this.debug("Table verification failed:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async executeQuery(query, params = [], retryCount = 0) {
    const queryId = Math.random().toString(36).substring(7);
    const client = await this.pool.connect();

    try {
      this.debug(`[Query ${queryId}] Executing:`, {
        query,
        params,
        retryCount,
        timestamp: new Date().toISOString(),
      });

      // Validate and sanitize parameters
      this.validateQueryAndParams(query, params);
      const sanitizedParams = this.sanitizeParams(params);

      const startTime = Date.now();
      const result = await client.query(query, sanitizedParams);
      const duration = Date.now() - startTime;

      this._queryHistory.set(queryId, {
        query,
        params: sanitizedParams,
        duration,
        rowCount: result.rowCount,
        timestamp: new Date().toISOString(),
        success: true,
      });

      this.debug(`[Query ${queryId}] Successful:`, {
        duration,
        rowCount: result.rowCount,
      });

      return result.rows;
    } catch (error) {
      this._queryHistory.set(queryId, {
        query,
        params,
        error: error.message,
        timestamp: new Date().toISOString(),
        success: false,
      });

      if (error.code === "42P01" && retryCount < this.maxRetries) {
        this.debug(`[Query ${queryId}] Table does not exist, retrying...`);
        await new Promise((resolve) => setTimeout(resolve, this.retryDelay));
        return this.executeQuery(query, params, retryCount + 1);
      }

      this.debug(`[Query ${queryId}] Failed:`, error);
      throw error;
    } finally {
      client.release();
    }
  }

  async getQueryHistory(limit = 10) {
    const history = Array.from(this._queryHistory.entries())
      .sort((a, b) => new Date(b[1].timestamp) - new Date(a[1].timestamp))
      .slice(0, limit);

    return history.map(([id, details]) => ({
      queryId: id,
      ...details,
    }));
  }

  clearQueryHistory() {
    this._queryHistory.clear();
    this.debug("Query history cleared");
  }

  validateQueryAndParams(query, params = []) {
    this.debug("Validating query and params:", { query, params });

    const paramMatches = query.match(/\$\d+/g) || [];
    const paramCount = paramMatches.length;

    if (paramCount !== params.length) {
      this.debug("Parameter count mismatch:", {
        expected: paramCount,
        got: params.length,
      });
      throw new DatabaseError(
        `Parameter count mismatch. Query expects ${paramCount} parameters but got ${params.length}`,
        "PARAM_COUNT_MISMATCH",
        query,
        params
      );
    }

    const paramNumbers = paramMatches
      .map((p) => parseInt(p.substring(1)))
      .sort((a, b) => a - b);

    for (let i = 0; i < paramNumbers.length; i++) {
      if (paramNumbers[i] !== i + 1) {
        this.debug("Invalid parameter numbering:", {
          expected: i + 1,
          got: paramNumbers[i],
        });
        throw new DatabaseError(
          `Invalid parameter numbering. Parameters must be sequential starting from $1`,
          "INVALID_PARAM_NUMBERING",
          query,
          params
        );
      }
    }

    this.debug("Query validation successful");
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

  async executeTransaction(queries, retryCount = 0) {
    const transactionId = Math.random().toString(36).substring(7);
    const client = await this.pool.connect();
    try {
      this.debug(`[Transaction ${transactionId}] Beginning`);
      await client.query("BEGIN");

      const results = [];
      for (const { query, params = [] } of queries) {
        this.debug(`[Transaction ${transactionId}] Executing query:`, {
          query,
          params,
          timestamp: new Date().toISOString(),
        });

        try {
          this.validateQueryAndParams(query, params);
          const sanitizedParams = this.sanitizeParams(params);
          const result = await client.query(query, sanitizedParams);
          results.push(result.rows);

          this.debug(`[Transaction ${transactionId}] Query successful:`, {
            rowCount: result.rowCount,
          });
        } catch (error) {
          if (error.code === "42P01" && retryCount < this.maxRetries) {
            this.debug(
              `[Transaction ${transactionId}] Table does not exist, retrying...`
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
      this.debug(`[Transaction ${transactionId}] Committed successfully`);
      return results;
    } catch (error) {
      this.debug(`[Transaction ${transactionId}] Failed:`, error);
      await client.query("ROLLBACK");
      this.debug(`[Transaction ${transactionId}] Rolled back`);
      throw new DatabaseError(
        error.message,
        error.code,
        "Transaction",
        queries
      );
    } finally {
      client.release();
      this.debug(`[Transaction ${transactionId}] Client released`);
    }
  }

  async executePreparedStatement(name, query, params = []) {
    const statementId = Math.random().toString(36).substring(7);
    const client = await this.pool.connect();
    try {
      this.debug(`[Statement ${statementId}] Preparing:`, {
        name,
        query,
        params,
      });

      this.validateQueryAndParams(query, params);
      const sanitizedParams = this.sanitizeParams(params);

      try {
        await client.query(`DEALLOCATE IF EXISTS "${name}"`);
      } catch (error) {
        this.debug(
          `[Statement ${statementId}] Deallocate not needed:`,
          error.message
        );
      }

      await client.query(`PREPARE "${name}" AS ${query}`);
      const result = await client.query(
        `EXECUTE "${name}"($1)`,
        sanitizedParams
      );
      await client.query(`DEALLOCATE "${name}"`);

      return result.rows;
    } catch (error) {
      this.debug(`[Statement ${statementId}] Failed:`, error);
      throw new DatabaseError(error.message, error.code, query, params);
    } finally {
      client.release();
    }
  }

  async executeWithLock(tableName, operation, timeout = 30000) {
    const lockId = Math.random().toString(36).substring(7);
    const client = await this.pool.connect();
    try {
      this.debug(`[Lock ${lockId}] Acquiring lock on table ${tableName}`);
      await client.query("BEGIN");
      await client.query(`SET LOCAL statement_timeout = ${timeout}`);
      await client.query(`LOCK TABLE ${tableName} IN ACCESS EXCLUSIVE MODE`);

      this.debug(`[Lock ${lockId}] Lock acquired, executing operation`);
      const result = await operation(client);

      await client.query("COMMIT");
      this.debug(`[Lock ${lockId}] Operation completed and committed`);
      return result;
    } catch (error) {
      this.debug(`[Lock ${lockId}] Operation failed:`, error);
      await client.query("ROLLBACK");
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

  _getPrimaryKeyColumn(columns) {
    const idColumn = columns.find(
      (col) =>
        col.column_name.toLowerCase() === "id" ||
        col.column_default?.includes("nextval")
    );
    return idColumn ? idColumn.column_name : null;
  }

  async analyzeTablePerformance(tableName) {
    const client = await this.pool.connect();
    try {
      const stats = {
        indexes: await client.query(
          `
          SELECT
            schemaname,
            tablename,
            indexname,
            idx_scan,
            idx_tup_read,
            idx_tup_fetch
          FROM pg_stat_user_indexes
          WHERE tablename = $1;
        `,
          [tableName]
        ),

        tableStats: await client.query(
          `
          SELECT
            seq_scan,
            seq_tup_read,
            idx_scan,
            n_tup_ins,
            n_tup_upd,
            n_tup_del,
            n_live_tup,
            n_dead_tup,
            last_vacuum,
            last_autovacuum,
            last_analyze,
            last_autoanalyze
          FROM pg_stat_user_tables
          WHERE relname = $1;
        `,
          [tableName]
        ),

        size: await client.query(
          `
          SELECT
            pg_size_pretty(pg_total_relation_size($1)) as total_size,
            pg_size_pretty(pg_table_size($1)) as table_size,
            pg_size_pretty(pg_indexes_size($1)) as index_size
          FROM pg_class
          WHERE relname = $1;
        `,
          [tableName]
        ),
      };

      this.debug("Performance analysis results:", stats);
      return stats;
    } catch (error) {
      this.debug("Performance analysis failed:", error);
      throw error;
    } finally {
      client.release();
    }
  }
}

module.exports = SqlQueryExecutor;
