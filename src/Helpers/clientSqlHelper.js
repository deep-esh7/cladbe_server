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

    // Basic SQL injection prevention
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
    this.log("Building query with modifiers");
    const buffer = [];

    // Build SELECT clause
    buffer.push("SELECT");
    if (modifiers?.some((m) => m.modifiers?.some((mod) => mod.distinct))) {
      buffer.push("DISTINCT");
    }
    buffer.push(columns?.join(", ") || "*");

    // FROM clause
    buffer.push(`FROM ${this.sanitizeTableName(tableName)}`);

    // WHERE clause
    if (filters?.length > 0) {
      const filterConditions = filters
        .map((f) => `(${this.convertQueryParameters(f.toSQL())})`)
        .join(" AND ");
      buffer.push(`WHERE ${filterConditions}`);
    }

    // GROUP BY clause
    if (groupBy?.length > 0) {
      buffer.push(`GROUP BY ${groupBy.join(", ")}`);
    }

    // HAVING clause
    if (having?.length > 0) {
      const havingConditions = having
        .map((h) => `(${this.convertQueryParameters(h.toSQL())})`)
        .join(" AND ");
      buffer.push(`HAVING ${havingConditions}`);
    }

    // ORDER BY clause
    if (orderBy?.length > 0) {
      buffer.push(`ORDER BY ${orderBy.join(", ")}`);
      // Handle NULLS ordering if specified in modifiers
      const nullsOrder = modifiers
        ?.flatMap((m) => m.modifiers)
        .find((m) => m.nullsOrder)?.nullsOrder;
      if (nullsOrder) {
        buffer.push(`NULLS ${nullsOrder.toUpperCase()}`);
      }
    }

    // LIMIT and OFFSET
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
    const params = allFilters.flatMap((f) => {
      const sql = f.toSQL();
      const paramCount = (sql.match(/\$\d+/g) || []).length;
      return Array(paramCount).fill(null); // Placeholder for actual parameters
    });
    this.log("Extracted parameters count:", params.length);
    return params;
  }

  convertQueryParameters(query) {
    let paramCount = 0;
    const convertedQuery = query.replace(/\?/g, () => `$${++paramCount}`);
    this.log("Parameter conversion:", {
      original: query,
      converted: convertedQuery,
      paramCount,
    });
    return convertedQuery;
  }

  sanitizeTableName(tableName) {
    if (!tableName || typeof tableName !== "string") {
      throw new ClientSqlError(
        "Invalid table name",
        "TABLE_OPERATION",
        tableName
      );
    }

    // Only allow alphanumeric characters and underscores
    if (!/^[a-zA-Z0-9_]+$/.test(tableName)) {
      throw new ClientSqlError(
        "Table name can only contain letters, numbers, and underscores",
        "TABLE_OPERATION",
        tableName
      );
    }

    return tableName.toLowerCase();
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

  async tableExists(tableName) {
    const operation = "TABLE_EXISTS";
    try {
      tableName = this.sanitizeTableName(tableName);
      this.log("Checking if table exists:", tableName);

      const query = `
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = $1
        );
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

  async executeTransaction(operations) {
    const operation = "TRANSACTION";
    try {
      if (!Array.isArray(operations) || operations.length === 0) {
        throw new Error("Invalid operations array");
      }

      this.log("Beginning transaction with operations:", operations.length);
      const results = [];

      await this.executeWrite("BEGIN");
      this.log("Transaction began");

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

  async createTable(tableName, columns) {
    const operation = "CREATE_TABLE";
    try {
      tableName = this.sanitizeTableName(tableName);

      if (!Array.isArray(columns) || columns.length === 0) {
        throw new Error("Invalid columns definition");
      }

      this.log("Creating table:", { tableName, columns });

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
      this.log("Table created successfully:", tableName);

      // Verify table creation
      const tableStructure = await this.verifyTableStructure(tableName);
      this.log("Table structure verified:", tableStructure);

      return tableStructure;
    } catch (error) {
      this.logError("Create table failed:", error, { tableName, columns });
      throw new ClientSqlError(
        "Create table failed: " + error.message,
        operation,
        tableName,
        columns,
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
          WHERE table_schema = 'public' AND table_name = $1;
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
}

module.exports = ClientSqlHelper;
