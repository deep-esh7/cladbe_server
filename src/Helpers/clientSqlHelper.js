const { raw } = require("pg");

class ClientSqlError extends Error {
  constructor(message, operation, query, params, originalError = null) {
    super(message);
    this.name = "ClientSqlError";
    this.operation = operation;
    this.query = query;
    this.params = params;
    this.originalError = originalError;
    this.timestamp = new Date().toISOString();
  }
}

class ClientSqlHelper {
  constructor(sqlExecutor) {
    if (!sqlExecutor) {
      throw new Error("SQL Executor is required");
    }
    this.sqlExecutor = sqlExecutor;
    this._debugMode = process.env.DEBUG === "true";
    this.log("ClientSqlHelper initialized");
  }

  log(message, ...args) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}][ClientSqlHelper] ${message}`, ...args);
  }

  logError(message, error, ...args) {
    const timestamp = new Date().toISOString();
    console.error(
      `[${timestamp}][ClientSqlHelper][ERROR] ${message}`,
      error,
      ...args
    );
  }

  validateQuery(query, operation) {
    if (!query || typeof query !== "string") {
      throw new ClientSqlError(
        "Invalid query: must be a non-empty string",
        operation,
        query
      );
    }

    this.log("Validating query:", {
      operation,
      query,
      length: query.length,
    });

    const dangerousPatterns = [
      // /;\s*DROP\s+/i,
      // /;\s*DELETE\s+/i,
      // /;\s*TRUNCATE\s+/i,
      // /;\s*ALTER\s+/i,
      // /--/,
      // /\/\*/,
      // /UNION\s+SELECT/i
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(query)) {
        throw new ClientSqlError(
          "Potentially dangerous query detected",
          operation,
          query
        );
      }
    }
  }

  sanitizeTableName(tableName) {
    this.log("Sanitizing table name:", {
      raw: tableName,
      type: typeof tableName,
      length: tableName?.length,
      charCodes: tableName
        ? Array.from(tableName).map((c) => c.charCodeAt(0))
        : [],
      trimmed: tableName?.trim(),
      regexTest: tableName ? /^[a-zA-Z0-9_]+$/.test(tableName) : false,
    });

    if (!tableName || typeof tableName !== "string") {
      throw new ClientSqlError(
        "Invalid table name",
        "TABLE_OPERATION",
        tableName
      );
    }

    tableName = tableName.trim();

    if (!/^[a-zA-Z0-9_]+$/.test(tableName)) {
      throw new ClientSqlError(
        "Table name can only contain letters, numbers, and underscores",
        "TABLE_OPERATION",
        tableName
      );
    }

    const sanitized = tableName.toLowerCase();
    this.log("Sanitized table name:", {
      original: tableName,
      sanitized,
      length: sanitized.length,
    });

    return sanitized;
  }

  async inferTableStructure(query, params) {
    const tableMatch = query.match(/INSERT INTO ["']?([^\s"']+)["']?/i);
    const columnsMatch = query.match(/\(([\s\S]*?)\)\s+VALUES/i);

    if (!tableMatch || !columnsMatch) {
      throw new Error("Unable to parse table structure from query");
    }

    const tableName = tableMatch[1].replace(/['"]/g, "");
    const columns = columnsMatch[1]
      .split(",")
      .map((col) => col.trim().replace(/['"]/g, ""));

    const columnDefinitions = columns.map((colName, index) => {
      const value = params[index];
      return {
        name: colName,
        type: this._inferColumnType(colName, value),
        constraints: this._inferColumnConstraints(colName, value),
      };
    });

    return { tableName, columnDefinitions };
  }

  _inferColumnType(columnName, value) {
    if (value === null || value === undefined) {
      const lowerColName = columnName.toLowerCase();
      if (lowerColName === "id" || lowerColName.endsWith("_id")) return "UUID";
      if (
        lowerColName.includes("created_at") ||
        lowerColName.includes("updated_at")
      )
        return "TIMESTAMP";
      if (lowerColName.includes("is_") || lowerColName.includes("has_"))
        return "BOOLEAN";
      return "TEXT";
    }

    switch (typeof value) {
      case "string":
        if (this._isUUID(value)) return "UUID";
        if (this._isTimestamp(value)) return "TIMESTAMP";
        if (value.length > 255) return "TEXT";
        return "VARCHAR(255)";
      case "number":
        return Number.isInteger(value) ? "INTEGER" : "NUMERIC";
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

  _inferColumnConstraints(columnName, value) {
    const constraints = [];
    const lowerColName = columnName.toLowerCase();

    if (lowerColName === "id") {
      constraints.push("PRIMARY KEY");
    }

    if (value !== null && value !== undefined) {
      constraints.push("NOT NULL");
    }

    if (lowerColName.includes("email") || lowerColName.includes("username")) {
      constraints.push("UNIQUE");
    }

    return constraints.join(" ");
  }

  _isUUID(str) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      str
    );
  }

  _isTimestamp(str) {
    const date = new Date(str);
    return (
      date instanceof Date &&
      !isNaN(date) &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(str)
    );
  }

  _buildQueryWithModifiers({
    tableName,
    columns,
    filters,
    groupBy,
    having,
    orderBy,
    limit,
    offset,
    modifiers,
  }) {
    this.log("Building query with modifiers:", {
      tableName,
      columns,
      filters: filters?.length,
      groupBy,
      having: having?.length,
      orderBy,
      limit,
      offset,
    });

    const buffer = [];

    buffer.push("SELECT");
    if (modifiers?.some((m) => m.modifiers?.some((mod) => mod.distinct))) {
      buffer.push("DISTINCT");
    }
    buffer.push(columns?.join(", ") || "*");

    const sanitizedTableName = this.sanitizeTableName(tableName);
    buffer.push(`FROM ${sanitizedTableName}`);

    if (filters?.length > 0) {
      const filterConditions = filters
        .map((f) => `(${this.convertQueryParameters(f.toSQL())})`)
        .join(" AND ");
      buffer.push(`WHERE ${filterConditions}`);
    }

    if (groupBy?.length > 0) {
      buffer.push(`GROUP BY ${groupBy.join(", ")}`);
    }

    if (having?.length > 0) {
      const havingConditions = having
        .map((h) => `(${this.convertQueryParameters(h.toSQL())})`)
        .join(" AND ");
      buffer.push(`HAVING ${havingConditions}`);
    }

    if (orderBy?.length > 0) {
      buffer.push(`ORDER BY ${orderBy.join(", ")}`);
      const nullsOrder = modifiers
        ?.flatMap((m) => m.modifiers)
        .find((m) => m.nullsOrder)?.nullsOrder;
      if (nullsOrder) {
        buffer.push(`NULLS ${nullsOrder.toUpperCase()}`);
      }
    }

    if (limit != null) {
      buffer.push(`LIMIT ${limit}`);
    }
    if (offset != null) {
      buffer.push(`OFFSET ${offset}`);
    }

    const query = buffer.join(" ");
    this.log("Built query:", query);
    return query;
  }

  extractParameters(filters, having) {
    const allFilters = [...(filters || []), ...(having || [])];
    const params = allFilters.flatMap((f) => f.getParameters());
    this.log("Extracted parameters:", {
      filterCount: filters?.length || 0,
      havingCount: having?.length || 0,
      paramCount: params.length,
      params,
    });
    return params;
  }

  convertQueryParameters(query) {
    let paramCount = 0;
    const convertedQuery = query.replace(/\?/g, () => `$${++paramCount}`);
    this.log("Converting parameters:", {
      original: query,
      converted: convertedQuery,
      paramCount,
    });
    return convertedQuery;
  }

  async executeRead(query, params = []) {
    const operation = "READ";
    try {
      this.validateQuery(query, operation);
      this.log("Executing read operation:", { query, params });

      const convertedQuery = this.convertQueryParameters(query);
      const result = await this.sqlExecutor.executeQuery(
        convertedQuery,
        params
      );

      this.log("Read operation successful:", {
        rowCount: result?.length,
        query: convertedQuery,
      });
      return result;
    } catch (error) {
      this.logError("Read operation failed:", error, { query, params });
      throw new ClientSqlError(
        "Read operation failed: " + error.message,
        operation,
        query,
        params,
        error
      );
    }
  }

  async executeWrite(query, params = []) {
    const operation = "WRITE";
    try {
      this.validateQuery(query, operation);
      this.log("Executing write operation:", { query, params });

      // Check if it's an INSERT query and handle table creation if needed
      if (query.trim().toUpperCase().startsWith("INSERT")) {
        try {
          const tableMatch = query.match(/INSERT INTO ["']?([^\s"']+)["']?/i);
          if (tableMatch) {
            const tableName = tableMatch[1].replace(/['"]/g, "");
            const exists = await this.tableExists(tableName);

            if (!exists) {
              this.log(`Table ${tableName} does not exist, creating...`);
              const { columnDefinitions } = await this.inferTableStructure(
                query,
                params
              );

              const createTableQuery = `
                CREATE TABLE IF NOT EXISTS ${tableName} (
                  ${columnDefinitions
                    .map(
                      (col) =>
                        `${col.name} ${col.type}${
                          col.constraints ? " " + col.constraints : ""
                        }`
                    )
                    .join(",\n")}
                )
              `;

              await this.sqlExecutor.executeQuery(createTableQuery);
              this.log(`Table ${tableName} created successfully`);

              // Add indexes for commonly indexed columns
              const indexableColumns = columnDefinitions
                .filter(
                  (col) =>
                    col.name.toLowerCase().includes("email") ||
                    col.name.toLowerCase().includes("username") ||
                    col.constraints.includes("UNIQUE")
                )
                .map((col) => col.name);

              for (const column of indexableColumns) {
                const indexName = `idx_${tableName}_${column.toLowerCase()}`;
                await this.createIndex({
                  name: indexName,
                  tableName: tableName,
                  columns: [column],
                  unique: true,
                });
              }
            }
          }
        } catch (error) {
          this.logError("Error in table creation:", error);
          throw error;
        }
      }

      const convertedQuery = this.convertQueryParameters(query);
      const result = await this.sqlExecutor.executeQuery(
        convertedQuery,
        params
      );

      this.log("Write operation successful:", {
        rowCount: result?.length,
        query: convertedQuery,
      });
      return result;
    } catch (error) {
      this.logError("Write operation failed:", error, { query, params });
      throw new ClientSqlError(
        "Write operation failed: " + error.message,
        operation,
        query,
        params,
        error
      );
    }
  }

  async executeTransaction(operations) {
    const operation = "TRANSACTION";
    try {
      if (!Array.isArray(operations) || operations.length === 0) {
        throw new Error("Invalid operations array");
      }

      this.log("Beginning transaction:", {
        operationCount: operations.length,
      });

      const results = [];
      await this.executeWrite("BEGIN");

      for (const [index, op] of operations.entries()) {
        this.validateQuery(op.query, "TRANSACTION_OPERATION");
        this.log(
          `Executing transaction operation ${index + 1}/${operations.length}`
        );

        const result = await this.executeWrite(op.query, op.params || []);
        results.push(result);
      }

      await this.executeWrite("COMMIT");
      this.log("Transaction committed successfully");
      return results;
    } catch (error) {
      this.logError("Transaction failed:", error);
      await this.executeWrite("ROLLBACK").catch((rollbackError) => {
        this.logError("Rollback failed:", rollbackError);
      });
      throw new ClientSqlError(
        "Transaction failed: " + error.message,
        operation,
        null,
        operations,
        error
      );
    }
  }

  // ... [Include all other existing methods without changes] ...

  async tableExists(tableName) {
    const operation = "TABLE_EXISTS";
    try {
      tableName = this.sanitizeTableName(tableName);
      this.log("Checking if table exists:", tableName);

      const query = `
        SELECT EXISTS (
          SELECT 1 
          FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = $1
        )
      `;

      const result = await this.executeRead(query, [tableName]);
      const exists = result[0]?.exists ?? false;

      this.log(`Table ${tableName} exists:`, exists);
      return exists;
    } catch (error) {
      this.logError("Table exists check failed:", error, { tableName });
      throw new ClientSqlError(
        "Table exists check failed: " + error.message,
        operation,
        tableName,
        null,
        error
      );
    }
  }

  async getTableColumns(tableName) {
    const operation = "GET_COLUMNS";
    try {
      tableName = this.sanitizeTableName(tableName);
      this.log("Getting columns for table:", tableName);

      const query = `
        SELECT 
          column_name,
          data_type,
          is_nullable,
          column_default,
          character_maximum_length as length,
          numeric_precision as precision,
          numeric_scale as scale,
          udt_name,
          is_identity,
          identity_generation
        FROM information_schema.columns
        WHERE table_schema = 'public' 
        AND table_name = $1
        ORDER BY ordinal_position;
      `;

      const columns = await this.executeRead(query, [tableName]);
      this.log(`Retrieved ${columns.length} columns for ${tableName}`);
      return columns;
    } catch (error) {
      this.logError("Get table columns failed:", error, { tableName });
      throw new ClientSqlError(
        "Get table columns failed: " + error.message,
        operation,
        tableName,
        null,
        error
      );
    }
  }

  async verifyTableStructure(tableName) {
    const operation = "VERIFY_TABLE";
    try {
      tableName = this.sanitizeTableName(tableName);
      this.log("Verifying table structure:", tableName);

      const [tableInfo, columns, constraints, indexes] = await Promise.all([
        this.executeRead(
          `
          SELECT 
            table_schema,
            table_name,
            table_type,
            pg_catalog.obj_description(
              (quote_ident(table_schema) || '.' || quote_ident(table_name))::regclass, 
              'pg_class'
            ) as description
          FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = $1;
        `,
          [tableName]
        ),

        this.getTableColumns(tableName),

        this.executeRead(
          `
          SELECT 
            tc.constraint_name,
            tc.constraint_type,
            kcu.column_name,
            ccu.table_name AS foreign_table_name,
            ccu.column_name AS foreign_column_name
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name
          LEFT JOIN information_schema.constraint_column_usage ccu
            ON ccu.constraint_name = tc.constraint_name
          WHERE tc.table_name = $1
          ORDER BY tc.constraint_name;
        `,
          [tableName]
        ),

        this.executeRead(
          `
          SELECT
            i.relname AS index_name,
            am.amname AS index_type,
            idx.indisunique AS is_unique,
            idx.indisprimary AS is_primary
          FROM pg_class t
          JOIN pg_index idx ON t.oid = idx.indrelid
          JOIN pg_class i ON i.oid = idx.indexrelid
          JOIN pg_am am ON i.relam = am.oid
          WHERE t.relname = $1
          ORDER BY i.relname;
        `,
          [tableName]
        ),
      ]);

      const structure = {
        tableInfo: tableInfo[0],
        columns,
        constraints,
        indexes,
        verified: true,
        verifiedAt: new Date().toISOString(),
      };

      this.log("Table structure verification completed:", {
        tableName,
        columnCount: columns.length,
        constraintCount: constraints.length,
        indexCount: indexes.length,
      });

      return structure;
    } catch (error) {
      this.logError("Table verification failed:", error, { tableName });
      throw new ClientSqlError(
        "Table verification failed: " + error.message,
        operation,
        tableName,
        null,
        error
      );
    }
  }

  async createTable(tableName, columns) {
    const operation = "CREATE_TABLE";
    try {
      tableName = this.sanitizeTableName(tableName);

      if (!Array.isArray(columns) || columns.length === 0) {
        throw new Error("Invalid columns definition");
      }

      this.log("Creating table:", { tableName, columnCount: columns.length });

      const columnDefinitions = columns
        .map((col) => {
          if (!col.name || !col.type) {
            throw new Error("Invalid column definition");
          }
          return `${col.name} ${col.type}${
            col.constraints ? " " + col.constraints : ""
          }`;
        })
        .join(", ");

      const query = `
        CREATE TABLE IF NOT EXISTS ${tableName} (
          ${columnDefinitions}
        );
      `;

      await this.executeWrite(query);
      this.log("Table created");
    } catch (error) {
      this.logError("error creating table:", error, { tableName });
      throw new ClientSqlError(
        "error creating table: " + error.message,
        operation,
        tableName,
        null,
        error
      );
    }
  }

  async dropTable(tableName, cascade = false) {
    const operation = "DROP_TABLE";
    try {
      tableName = this.sanitizeTableName(tableName);
      this.log("Dropping table:", { tableName, cascade });

      const query = `DROP TABLE IF EXISTS ${tableName}${
        cascade ? " CASCADE" : ""
      };`;
      await this.executeWrite(query);

      this.log("Table dropped successfully:", tableName);
    } catch (error) {
      this.logError("Drop table failed:", error, { tableName, cascade });
      throw new ClientSqlError(
        "Drop table failed: " + error.message,
        operation,
        tableName,
        { cascade },
        error
      );
    }
  }

  async truncateTable(
    tableName,
    options = { restartIdentity: false, cascade: false }
  ) {
    const operation = "TRUNCATE";
    try {
      tableName = this.sanitizeTableName(tableName);
      this.log("Truncating table:", { tableName, options });

      const clauses = [];
      if (options.restartIdentity) clauses.push("RESTART IDENTITY");
      if (options.cascade) clauses.push("CASCADE");

      const query = `TRUNCATE TABLE ${tableName}${
        clauses.length ? " " + clauses.join(" ") : ""
      };`;
      await this.executeWrite(query);

      this.log("Table truncated successfully:", tableName);
    } catch (error) {
      this.logError("Truncate table failed:", error, { tableName, options });
      throw new ClientSqlError(
        "Truncate table failed: " + error.message,
        operation,
        tableName,
        options,
        error
      );
    }
  }

  async addColumn(tableName, columnDef) {
    const operation = "ADD_COLUMN";
    try {
      tableName = this.sanitizeTableName(tableName);
      this.log("Adding column to table:", { tableName, columnDef });

      if (!columnDef.name || !columnDef.type) {
        throw new Error("Invalid column definition");
      }

      const query = `
        ALTER TABLE ${tableName} 
        ADD COLUMN ${columnDef.name} ${columnDef.type}
        ${columnDef.constraints ? columnDef.constraints : ""};
      `;

      await this.executeWrite(query);
      this.log("Column added successfully:", columnDef.name);
    } catch (error) {
      this.logError("Add column failed:", error, { tableName, columnDef });
      throw new ClientSqlError(
        "Add column failed: " + error.message,
        operation,
        tableName,
        columnDef,
        error
      );
    }
  }

  async dropColumn(tableName, columnName, cascade = false) {
    const operation = "DROP_COLUMN";
    try {
      tableName = this.sanitizeTableName(tableName);
      this.log("Dropping column:", { tableName, columnName, cascade });

      const query = `
        ALTER TABLE ${tableName} 
        DROP COLUMN ${columnName}${cascade ? " CASCADE" : ""};
      `;

      await this.executeWrite(query);
      this.log("Column dropped successfully:", columnName);
    } catch (error) {
      this.logError("Drop column failed:", error, {
        tableName,
        columnName,
        cascade,
      });
      throw new ClientSqlError(
        "Drop column failed: " + error.message,
        operation,
        tableName,
        { columnName, cascade },
        error
      );
    }
  }

  async createIndex(indexDef) {
    const operation = "CREATE_INDEX";
    try {
      const tableName = this.sanitizeTableName(indexDef.tableName);
      this.log("Creating index:", indexDef);

      let query = `CREATE ${indexDef.unique ? "UNIQUE " : ""}INDEX `;
      if (indexDef.ifNotExists) query += "IF NOT EXISTS ";
      query += `${indexDef.name} ON ${tableName}`;
      if (indexDef.using) query += ` USING ${indexDef.using}`;
      query += ` (${indexDef.columns.join(", ")})`;
      if (indexDef.where) query += ` WHERE ${indexDef.where}`;

      await this.executeWrite(query);
      this.log("Index created successfully:", indexDef.name);
    } catch (error) {
      this.logError("Create index failed:", error, indexDef);
      throw new ClientSqlError(
        "Create index failed: " + error.message,
        operation,
        indexDef.tableName,
        indexDef,
        error
      );
    }
  }

  async dropIndex(indexName, cascade = false) {
    const operation = "DROP_INDEX";
    try {
      this.log("Dropping index:", { indexName, cascade });

      const query = `DROP INDEX IF EXISTS ${indexName}${
        cascade ? " CASCADE" : ""
      };`;
      await this.executeWrite(query);

      this.log("Index dropped successfully:", indexName);
    } catch (error) {
      this.logError("Drop index failed:", error, { indexName, cascade });
      throw new ClientSqlError(
        "Drop index failed: " + error.message,
        operation,
        null,
        { indexName, cascade },
        error
      );
    }
  }

  async addConstraint(tableName, constraintDef) {
    const operation = "ADD_CONSTRAINT";
    try {
      tableName = this.sanitizeTableName(tableName);
      this.log("Adding constraint:", { tableName, constraintDef });

      const query = `
        ALTER TABLE ${tableName}
        ADD CONSTRAINT ${constraintDef.name} ${constraintDef.definition};
      `;

      await this.executeWrite(query);
      this.log("Constraint added successfully:", constraintDef.name);
    } catch (error) {
      this.logError("Add constraint failed:", error, {
        tableName,
        constraintDef,
      });
      throw new ClientSqlError(
        "Add constraint failed: " + error.message,
        operation,
        tableName,
        constraintDef,
        error
      );
    }
  }

  async dropConstraint(tableName, constraintName, cascade = false) {
    const operation = "DROP_CONSTRAINT";
    try {
      tableName = this.sanitizeTableName(tableName);
      this.log("Dropping constraint:", { tableName, constraintName, cascade });

      const query = `
        ALTER TABLE ${tableName}
        DROP CONSTRAINT IF EXISTS ${constraintName}${cascade ? " CASCADE" : ""};
      `;

      await this.executeWrite(query);
      this.log("Constraint dropped successfully:", constraintName);
    } catch (error) {
      this.logError("Drop constraint failed:", error, {
        tableName,
        constraintName,
        cascade,
      });
      throw new ClientSqlError(
        "Drop constraint failed: " + error.message,
        operation,
        tableName,
        { constraintName, cascade },
        error
      );
    }
  }

  async ensureTableExists(query, params) {
    try {
      // Extract table name from the INSERT query
      const tableMatch = query.match(/INSERT INTO ["']?([^\s"']+)["']?/i);
      if (!tableMatch) {
        throw new Error("Unable to parse table name from query");
      }

      const tableName = tableMatch[1].replace(/['"]/g, "");
      this.log(`Checking if table ${tableName} exists`);

      const exists = await this.tableExists(tableName);

      if (!exists) {
        this.log(`Table ${tableName} does not exist, creating...`);
        const { columnDefinitions } = await this.inferTableStructure(
          query,
          params
        );

        const createTableQuery = `
          CREATE TABLE IF NOT EXISTS ${tableName} (
            ${columnDefinitions
              .map(
                (col) =>
                  `${col.name} ${col.type}${
                    col.constraints ? " " + col.constraints : ""
                  }`
              )
              .join(",\n")}
          )
        `;

        await this.executeWrite(createTableQuery);
        this.log(`Table ${tableName} created successfully`);

        // Add indexes for commonly indexed columns
        const indexableColumns = columnDefinitions
          .filter(
            (col) =>
              col.name.toLowerCase().includes("email") ||
              col.name.toLowerCase().includes("username") ||
              col.constraints.includes("UNIQUE")
          )
          .map((col) => col.name);

        for (const column of indexableColumns) {
          const indexName = `idx_${tableName}_${column.toLowerCase()}`;
          await this.createIndex({
            name: indexName,
            tableName: tableName,
            columns: [column],
            unique: true,
          });
        }

        return true;
      }

      return true;
    } catch (error) {
      this.logError(`Error ensuring table exists:`, error);
      throw error;
    }
  }

  // Also modify the executeWrite method to use ensureTableExists:

  async executeWrite(query, params = []) {
    const operation = "WRITE";
    try {
      this.validateQuery(query, operation);
      this.log("Executing write operation:", { query, params });

      // Check if it's an INSERT query and handle table creation if needed
      if (query.trim().toUpperCase().startsWith("INSERT")) {
        await this.ensureTableExists(query, params);
      }

      const convertedQuery = this.convertQueryParameters(query);
      const result = await this.sqlExecutor.executeQuery(
        convertedQuery,
        params
      );

      this.log("Write operation successful:", {
        rowCount: result?.length,
        query: convertedQuery,
      });
      return result;
    } catch (error) {
      this.logError("Write operation failed:", error, { query, params });
      throw new ClientSqlError(
        "Write operation failed: " + error.message,
        operation,
        query,
        params,
        error
      );
    }
  }

  async vacuum(tableName, analyze = true) {
    const operation = "VACUUM";
    try {
      tableName = this.sanitizeTableName(tableName);
      this.log("Vacuuming table:", { tableName, analyze });

      // VACUUM cannot be executed within a transaction
      const query = `VACUUM ${analyze ? "ANALYZE" : ""} ${tableName};`;
      await this.executeWrite(query);

      this.log("Vacuum completed successfully:", tableName);
    } catch (error) {
      this.logError("Vacuum failed:", error, { tableName, analyze });
      throw new ClientSqlError(
        "Vacuum failed: " + error.message,
        operation,
        tableName,
        { analyze },
        error
      );
    }
  }

  async getAllTables(includeStats = false) {
    const operation = "GET_ALL_TABLES";
    try {
      this.log("Getting all tables" + (includeStats ? " with statistics" : ""));

      const query = includeStats
        ? `
        SELECT 
          t.table_name as name,
          pg_stat_get_live_tuples(pgc.oid) as row_count,
          pg_total_relation_size(pgc.oid) as size_in_bytes,
          pg_stat_get_last_analyze_time(pgc.oid) as last_analyzed,
          obj_description(pgc.oid, 'pg_class') as description
        FROM information_schema.tables t
        JOIN pg_class pgc ON pgc.relname = t.table_name
        WHERE t.table_schema = 'public'
        AND t.table_type = 'BASE TABLE'
        ORDER BY t.table_name;
        `
        : `
        SELECT 
          table_name as name,
          null as row_count,
          null as size_in_bytes,
          null as last_analyzed,
          null as description
        FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
        ORDER BY table_name;
        `;

      const tables = await this.executeRead(query);

      this.log(`Found ${tables.length} tables`);
      return tables;
    } catch (error) {
      this.logError("Get all tables failed:", error);
      throw new ClientSqlError(
        "Get all tables failed: " + error.message,
        operation,
        null,
        { includeStats },
        error
      );
    }
  }

  async analyze(tableName, columns = []) {
    const operation = "ANALYZE";
    try {
      tableName = this.sanitizeTableName(tableName);
      this.log("Analyzing table:", { tableName, columns });

      const query = `ANALYZE ${tableName}${
        columns.length ? ` (${columns.join(", ")})` : ""
      };`;
      await this.executeWrite(query);

      this.log("Analyze completed successfully:", tableName);
    } catch (error) {
      this.logError("Analyze failed:", error, { tableName, columns });
      throw new ClientSqlError(
        "Analyze failed: " + error.message,
        operation,
        tableName,
        { columns },
        error
      );
    }
  }
}

module.exports = ClientSqlHelper;
