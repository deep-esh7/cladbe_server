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

    // Monitor pool events
    this.pool.on("error", (err) => {
      console.error("Unexpected error on idle client", err);
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

      const result = await client.query(query, params);

      console.log("Query successful:", {
        rowCount: result.rowCount,
        timestamp: new Date().toISOString(),
      });

      return result.rows;
    } catch (error) {
      if (error.code === "42P01" && retryCount < this.maxRetries) {
        // relation does not exist
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
      for (const { query, params } of queries) {
        console.log("Executing transaction query:", {
          query,
          params,
          timestamp: new Date().toISOString(),
        });

        try {
          const result = await client.query(query, params);
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

      // First, deallocate if exists to avoid conflicts
      try {
        await client.query(`DEALLOCATE IF EXISTS "${name}"`);
      } catch (error) {
        console.log("Deallocate not needed:", error.message);
      }

      // Prepare the statement
      await client.query(`PREPARE "${name}" AS ${query}`);

      // Execute the prepared statement
      const result = await client.query(`EXECUTE "${name}"($1)`, params);

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
        WHERE table_name = $1
      );
    `;
    const result = await this.executeQuery(query, [tableName]);
    return result[0].exists;
  }

  async getTableColumns(tableName) {
    const query = `
      SELECT column_name, data_type, is_nullable, 
             column_default, character_maximum_length
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
      await client.query(`VACUUM ${analyze ? "ANALYZE" : ""} ${tableName}`);
    } finally {
      client.release();
    }
  }
}

module.exports = SqlQueryExecutor;
