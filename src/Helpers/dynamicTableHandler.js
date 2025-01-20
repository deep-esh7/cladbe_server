// dynamicTableHandler.js

class DynamicTableHandler {
  constructor(sqlHelper) {
    this.sqlHelper = sqlHelper;
  }

  parseInsertQuery(query, parameters) {
    try {
      // Extract table name using regex
      const tableMatch = query.match(/INSERT INTO ["']?([^\s"']+)["']?/i);
      if (!tableMatch) throw new Error("Unable to parse table name from query");
      const tableName = tableMatch[1].replace(/['"]/g, "");

      // Extract column names
      const columnMatch = query.match(/\(([\s\S]*?)\)\s+VALUES/i);
      if (!columnMatch) throw new Error("Unable to parse columns from query");
      const columns = columnMatch[1]
        .split(",")
        .map((col) => col.trim().replace(/['"]/g, ""));

      // Create column definitions by mapping columns with parameters
      const columnDefinitions = columns.map((colName, index) => {
        const value = parameters[index];
        return {
          name: colName,
          ...this.inferColumnDefinition(colName, value),
        };
      });

      return {
        tableName,
        columnDefinitions,
      };
    } catch (error) {
      console.error("Error parsing insert query:", error);
      throw error;
    }
  }

  inferColumnDefinition(columnName, value) {
    // Base definition
    const definition = {
      type: this.inferDataType(value),
      constraints: [],
    };

    // Add constraints based on column name and value
    if (columnName.toLowerCase() === "id") {
      definition.constraints.push("PRIMARY KEY");
    }

    // Add NOT NULL if value is provided and not null
    if (value !== null && value !== undefined) {
      definition.constraints.push("NOT NULL");
    }

    return definition;
  }

  inferDataType(value) {
    if (value === null || value === undefined) {
      return "TEXT"; // Default type for null values
    }

    switch (typeof value) {
      case "string":
        if (this.isUUID(value)) return "UUID";
        if (this.isTimestamp(value)) return "TIMESTAMP";
        if (value.length > 255) return "TEXT";
        return "VARCHAR(255)";

      case "number":
        if (Number.isInteger(value)) return "INTEGER";
        return "NUMERIC";

      case "boolean":
        return "BOOLEAN";

      case "object":
        if (Array.isArray(value)) return "JSONB";
        if (value instanceof Date) return "TIMESTAMP";
        return "JSONB";

      default:
        return "TEXT";
    }
  }

  isUUID(str) {
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(str);
  }

  isTimestamp(str) {
    const date = new Date(str);
    return (
      date instanceof Date &&
      !isNaN(date) &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(str)
    );
  }

  async createTableFromQuery(query, parameters) {
    try {
      const { tableName, columnDefinitions } = this.parseInsertQuery(
        query,
        parameters
      );

      // Generate CREATE TABLE query
      const createTableQuery = this.generateCreateTableQuery(
        tableName,
        columnDefinitions
      );
      console.log("Creating table with query:", createTableQuery);

      // Execute table creation
      await this.sqlHelper.executeQuery(createTableQuery);
      console.log(`Table ${tableName} created successfully`);

      return true;
    } catch (error) {
      console.error("Error creating table:", error);
      throw error;
    }
  }

  generateCreateTableQuery(tableName, columnDefinitions) {
    const columnClauses = columnDefinitions.map((col) => {
      const constraints =
        col.constraints.length > 0 ? " " + col.constraints.join(" ") : "";
      return `"${col.name}" ${col.type}${constraints}`;
    });

    return `CREATE TABLE IF NOT EXISTS "${tableName}" (${columnClauses.join(
      ", "
    )})`;
  }
}

module.exports = DynamicTableHandler;
