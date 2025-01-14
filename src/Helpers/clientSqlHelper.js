// File: src/Helpers/ClientSqlHelper.js
class ClientSqlHelper {
  constructor(sqlExecutor) {
    this.sqlExecutor = sqlExecutor;
    console.log("ClientSqlHelper initialized");
  }

  async executeRead(query, params = []) {
    try {
      console.log("Executing read operation:", { query, params });
      const result = await this.sqlExecutor.executeQuery(query, params);
      console.log("Read operation successful:", result);
      return result;
    } catch (error) {
      console.error("Read operation failed:", error);
      throw error;
    }
  }

  async executeWrite(query, params = []) {
    try {
      console.log("Executing write operation:", { query, params });
      const result = await this.sqlExecutor.executeQuery(query, params);
      console.log("Write operation successful:", result);
      return result;
    } catch (error) {
      console.error("Write operation failed:", error);
      throw error;
    }
  }

  async executeTransaction(operations) {
    try {
      console.log("Executing transaction:", operations);
      const result = await this.sqlExecutor.executeTransaction(operations);
      console.log("Transaction successful:", result);
      return result;
    } catch (error) {
      console.error("Transaction failed:", error);
      throw error;
    }
  }

  // Table Operations
  async createTable(tableName, columns) {
    try {
      console.log("Creating table:", tableName, "with columns:", columns);
      const columnDefinitions = columns
        .map(
          (col) =>
            `${col.name} ${col.type}${
              col.constraints ? " " + col.constraints : ""
            }`
        )
        .join(", ");

      const query = `CREATE TABLE IF NOT EXISTS ${tableName} (${columnDefinitions})`;
      console.log("Create table query:", query);
      return await this.executeWrite(query);
    } catch (error) {
      console.error("Create table failed:", error);
      throw error;
    }
  }

  async dropTable(tableName) {
    try {
      console.log("Dropping table:", tableName);
      const query = `DROP TABLE IF EXISTS ${tableName}`;
      return await this.executeWrite(query);
    } catch (error) {
      console.error("Drop table failed:", error);
      throw error;
    }
  }

  async truncateTable(tableName) {
    try {
      console.log("Truncating table:", tableName);
      const query = `TRUNCATE TABLE ${tableName}`;
      return await this.executeWrite(query);
    } catch (error) {
      console.error("Truncate table failed:", error);
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
        ORDER BY ordinal_position
      `;
      return await this.executeRead(query, [tableName]);
    } catch (error) {
      console.error("Get table columns failed:", error);
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
      return result[0]?.exists || false;
    } catch (error) {
      console.error("Table exists check failed:", error);
      throw error;
    }
  }

  // Column Operations
  async addColumn(tableName, columnName, columnType, constraints = "") {
    try {
      console.log("Adding column:", {
        tableName,
        columnName,
        columnType,
        constraints,
      });
      const query = `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnType} ${constraints}`;
      return await this.executeWrite(query);
    } catch (error) {
      console.error("Add column failed:", error);
      throw error;
    }
  }

  async dropColumn(tableName, columnName) {
    try {
      console.log("Dropping column:", { tableName, columnName });
      const query = `ALTER TABLE ${tableName} DROP COLUMN ${columnName}`;
      return await this.executeWrite(query);
    } catch (error) {
      console.error("Drop column failed:", error);
      throw error;
    }
  }

  async renameColumn(tableName, oldName, newName) {
    try {
      console.log("Renaming column:", { tableName, oldName, newName });
      const query = `ALTER TABLE ${tableName} RENAME COLUMN ${oldName} TO ${newName}`;
      return await this.executeWrite(query);
    } catch (error) {
      console.error("Rename column failed:", error);
      throw error;
    }
  }

  async modifyColumn(tableName, columnName, newType, constraints = "") {
    try {
      console.log("Modifying column:", {
        tableName,
        columnName,
        newType,
        constraints,
      });
      const query = `ALTER TABLE ${tableName} ALTER COLUMN ${columnName} TYPE ${newType} ${constraints}`;
      return await this.executeWrite(query);
    } catch (error) {
      console.error("Modify column failed:", error);
      throw error;
    }
  }

  // Row Operations
  async deleteRows(tableName, condition) {
    try {
      console.log("Deleting rows:", { tableName, condition });
      const query = `DELETE FROM ${tableName} WHERE ${condition}`;
      return await this.executeWrite(query);
    } catch (error) {
      console.error("Delete rows failed:", error);
      throw error;
    }
  }

  async insertRow(tableName, data) {
    try {
      console.log("Inserting row:", { tableName, data });
      const columns = Object.keys(data);
      const values = Object.values(data);
      const placeholders = values.map((_, i) => `$${i + 1}`).join(", ");

      const query = `
        INSERT INTO ${tableName} (${columns.join(", ")}) 
        VALUES (${placeholders})
        RETURNING *
      `;
      return await this.executeWrite(query, values);
    } catch (error) {
      console.error("Insert row failed:", error);
      throw error;
    }
  }

  async updateRows(tableName, data, condition) {
    try {
      console.log("Updating rows:", { tableName, data, condition });
      const sets = Object.entries(data)
        .map(([key, _], i) => `${key} = $${i + 1}`)
        .join(", ");

      const query = `
        UPDATE ${tableName}
        SET ${sets}
        WHERE ${condition}
        RETURNING *
      `;
      return await this.executeWrite(query, Object.values(data));
    } catch (error) {
      console.error("Update rows failed:", error);
      throw error;
    }
  }

  // Query Operations
  async query(query, params = []) {
    try {
      console.log("Executing query:", { query, params });
      return await this.executeRead(query, params);
    } catch (error) {
      console.error("Query failed:", error);
      throw error;
    }
  }

  async execute(query, params = []) {
    try {
      console.log("Executing command:", { query, params });
      return await this.executeWrite(query, params);
    } catch (error) {
      console.error("Execute failed:", error);
      throw error;
    }
  }
}

module.exports = ClientSqlHelper; // File: src/Helpers/ClientSqlHelper.js
class ClientSqlHelper {
  constructor(sqlExecutor) {
    this.sqlExecutor = sqlExecutor;
    console.log("ClientSqlHelper initialized");
  }

  async executeRead(query, params = []) {
    try {
      console.log("Executing read operation:", { query, params });
      const result = await this.sqlExecutor.executeQuery(query, params);
      console.log("Read operation successful:", result);
      return result;
    } catch (error) {
      console.error("Read operation failed:", error);
      throw error;
    }
  }

  async executeWrite(query, params = []) {
    try {
      console.log("Executing write operation:", { query, params });
      const result = await this.sqlExecutor.executeQuery(query, params);
      console.log("Write operation successful:", result);
      return result;
    } catch (error) {
      console.error("Write operation failed:", error);
      throw error;
    }
  }

  async executeTransaction(operations) {
    try {
      console.log("Executing transaction:", operations);
      const result = await this.sqlExecutor.executeTransaction(operations);
      console.log("Transaction successful:", result);
      return result;
    } catch (error) {
      console.error("Transaction failed:", error);
      throw error;
    }
  }

  // Table Operations
  async createTable(tableName, columns) {
    try {
      console.log("Creating table:", tableName, "with columns:", columns);
      const columnDefinitions = columns
        .map(
          (col) =>
            `${col.name} ${col.type}${
              col.constraints ? " " + col.constraints : ""
            }`
        )
        .join(", ");

      const query = `CREATE TABLE IF NOT EXISTS ${tableName} (${columnDefinitions})`;
      console.log("Create table query:", query);
      return await this.executeWrite(query);
    } catch (error) {
      console.error("Create table failed:", error);
      throw error;
    }
  }

  async dropTable(tableName) {
    try {
      console.log("Dropping table:", tableName);
      const query = `DROP TABLE IF EXISTS ${tableName}`;
      return await this.executeWrite(query);
    } catch (error) {
      console.error("Drop table failed:", error);
      throw error;
    }
  }

  async truncateTable(tableName) {
    try {
      console.log("Truncating table:", tableName);
      const query = `TRUNCATE TABLE ${tableName}`;
      return await this.executeWrite(query);
    } catch (error) {
      console.error("Truncate table failed:", error);
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
          ORDER BY ordinal_position
        `;
      return await this.executeRead(query, [tableName]);
    } catch (error) {
      console.error("Get table columns failed:", error);
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
      return result[0]?.exists || false;
    } catch (error) {
      console.error("Table exists check failed:", error);
      throw error;
    }
  }

  // Column Operations
  async addColumn(tableName, columnName, columnType, constraints = "") {
    try {
      console.log("Adding column:", {
        tableName,
        columnName,
        columnType,
        constraints,
      });
      const query = `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnType} ${constraints}`;
      return await this.executeWrite(query);
    } catch (error) {
      console.error("Add column failed:", error);
      throw error;
    }
  }

  async dropColumn(tableName, columnName) {
    try {
      console.log("Dropping column:", { tableName, columnName });
      const query = `ALTER TABLE ${tableName} DROP COLUMN ${columnName}`;
      return await this.executeWrite(query);
    } catch (error) {
      console.error("Drop column failed:", error);
      throw error;
    }
  }

  async renameColumn(tableName, oldName, newName) {
    try {
      console.log("Renaming column:", { tableName, oldName, newName });
      const query = `ALTER TABLE ${tableName} RENAME COLUMN ${oldName} TO ${newName}`;
      return await this.executeWrite(query);
    } catch (error) {
      console.error("Rename column failed:", error);
      throw error;
    }
  }

  async modifyColumn(tableName, columnName, newType, constraints = "") {
    try {
      console.log("Modifying column:", {
        tableName,
        columnName,
        newType,
        constraints,
      });
      const query = `ALTER TABLE ${tableName} ALTER COLUMN ${columnName} TYPE ${newType} ${constraints}`;
      return await this.executeWrite(query);
    } catch (error) {
      console.error("Modify column failed:", error);
      throw error;
    }
  }

  // Row Operations
  async deleteRows(tableName, condition) {
    try {
      console.log("Deleting rows:", { tableName, condition });
      const query = `DELETE FROM ${tableName} WHERE ${condition}`;
      return await this.executeWrite(query);
    } catch (error) {
      console.error("Delete rows failed:", error);
      throw error;
    }
  }

  async insertRow(tableName, data) {
    try {
      console.log("Inserting row:", { tableName, data });
      const columns = Object.keys(data);
      const values = Object.values(data);
      const placeholders = values.map((_, i) => `$${i + 1}`).join(", ");

      const query = `
          INSERT INTO ${tableName} (${columns.join(", ")}) 
          VALUES (${placeholders})
          RETURNING *
        `;
      return await this.executeWrite(query, values);
    } catch (error) {
      console.error("Insert row failed:", error);
      throw error;
    }
  }

  async updateRows(tableName, data, condition) {
    try {
      console.log("Updating rows:", { tableName, data, condition });
      const sets = Object.entries(data)
        .map(([key, _], i) => `${key} = $${i + 1}`)
        .join(", ");

      const query = `
          UPDATE ${tableName}
          SET ${sets}
          WHERE ${condition}
          RETURNING *
        `;
      return await this.executeWrite(query, Object.values(data));
    } catch (error) {
      console.error("Update rows failed:", error);
      throw error;
    }
  }

  // Query Operations
  async query(query, params = []) {
    try {
      console.log("Executing query:", { query, params });
      return await this.executeRead(query, params);
    } catch (error) {
      console.error("Query failed:", error);
      throw error;
    }
  }

  async execute(query, params = []) {
    try {
      console.log("Executing command:", { query, params });
      return await this.executeWrite(query, params);
    } catch (error) {
      console.error("Execute failed:", error);
      throw error;
    }
  }
}

module.exports = ClientSqlHelper;
