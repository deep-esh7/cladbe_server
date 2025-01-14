class ClientSqlHelper {
  constructor(sqlExecutor) {
    this.sqlExecutor = sqlExecutor;
    console.log("ClientSqlHelper initialized");
  }

  // Convert ? style parameters to $1, $2, etc.
  convertQueryParameters(query) {
    let paramCount = 0;
    return query.replace(/\?/g, () => `$${++paramCount}`);
  }

  async executeRead(query, params = []) {
    try {
      console.log("Original query:", query);
      const convertedQuery = this.convertQueryParameters(query);
      console.log("Converted query:", convertedQuery);
      console.log("Executing read operation:", {
        query: convertedQuery,
        params,
      });

      const result = await this.sqlExecutor.executeQuery(
        convertedQuery,
        params
      );
      console.log("Read operation successful:", result);
      return result;
    } catch (error) {
      console.error("Read operation failed:", error);
      throw error;
    }
  }

  async executeWrite(query, params = []) {
    try {
      console.log("Original query:", query);
      const convertedQuery = this.convertQueryParameters(query);
      console.log("Converted query:", convertedQuery);
      console.log("Executing write operation:", {
        query: convertedQuery,
        params,
      });

      const result = await this.sqlExecutor.executeQuery(
        convertedQuery,
        params
      );
      console.log("Write operation successful. Result:", result);
      return result;
    } catch (error) {
      console.error("Write operation failed:", error);
      throw error;
    }
  }

  async tableExists(tableName) {
    try {
      console.log("Checking if table exists:", tableName);
      const query = `
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public'
          AND table_name = $1
        );
      `;
      const result = await this.executeRead(query, [tableName]);
      const exists = result[0]?.exists || false;
      console.log(`Table ${tableName} exists:`, exists);
      return exists;
    } catch (error) {
      console.error("Table exists check failed:", error);
      throw error;
    }
  }

  async getTableColumns(tableName) {
    try {
      console.log("Getting columns for table:", tableName);
      const query = `
        SELECT 
          column_name,
          data_type,
          is_nullable,
          column_default,
          character_maximum_length as length,
          numeric_precision as precision,
          numeric_scale as scale
        FROM information_schema.columns
        WHERE table_name = $1
        ORDER BY ordinal_position;
      `;
      return await this.executeRead(query, [tableName]);
    } catch (error) {
      console.error("Get table columns failed:", error);
      throw error;
    }
  }

  async executeTransaction(operations) {
    try {
      console.log("Executing transaction with operations:", operations);
      await this.executeWrite("BEGIN");

      const results = [];
      for (const operation of operations) {
        const convertedQuery = this.convertQueryParameters(operation.query);
        const result = await this.executeWrite(
          convertedQuery,
          operation.params
        );
        results.push(result);
      }

      await this.executeWrite("COMMIT");
      console.log("Transaction completed successfully");
      return results;
    } catch (error) {
      console.error("Transaction failed, rolling back:", error);
      await this.executeWrite("ROLLBACK");
      throw error;
    }
  }

  async createTable(tableName, columns) {
    try {
      console.log("Creating table:", tableName);
      const columnDefinitions = columns
        .map(
          (col) =>
            `${col.name} ${col.type}${
              col.constraints ? " " + col.constraints : ""
            }`
        )
        .join(", ");

      const query = `CREATE TABLE IF NOT EXISTS ${tableName} (${columnDefinitions})`;
      await this.executeWrite(query);
      console.log("Table created successfully");
    } catch (error) {
      console.error("Create table failed:", error);
      throw error;
    }
  }

  async dropTable(tableName, cascade = false) {
    try {
      console.log("Dropping table:", tableName, cascade ? "with cascade" : "");
      const query = `DROP TABLE IF EXISTS ${tableName}${
        cascade ? " CASCADE" : ""
      }`;
      await this.executeWrite(query);
      console.log("Table dropped successfully");
    } catch (error) {
      console.error("Drop table failed:", error);
      throw error;
    }
  }

  // Method to verify table structure
  async verifyTableStructure(tableName) {
    try {
      const tableInfo = await this.executeRead(
        `
        SELECT 
          table_schema,
          table_name,
          table_type
        FROM information_schema.tables 
        WHERE table_name = $1
      `,
        [tableName]
      );

      const columns = await this.getTableColumns(tableName);

      const constraints = await this.executeRead(
        `
        SELECT 
          tc.constraint_name,
          tc.constraint_type,
          kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
        WHERE tc.table_name = $1
      `,
        [tableName]
      );

      return {
        tableInfo: tableInfo[0],
        columns,
        constraints,
      };
    } catch (error) {
      console.error("Table verification failed:", error);
      throw error;
    }
  }
}

module.exports = ClientSqlHelper;
