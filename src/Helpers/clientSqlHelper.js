// File: src/Helpers/ClientSqlHelper.js
class ClientSqlHelper {
    constructor(sqlExecutor) {
      this.sqlExecutor = sqlExecutor;
    }
  
    async executeRead(query, params = []) {
      try {
        console.log('Executing read operation:', { query, params });
        return await this.sqlExecutor.executeQuery(query, params);
      } catch (error) {
        console.error('Read operation failed:', error);
        throw error;
      }
    }
  
    async executeWrite(query, params = []) {
      try {
        console.log('Executing write operation:', { query, params });
        return await this.sqlExecutor.executeQuery(query, params);
      } catch (error) {
        console.error('Write operation failed:', error);
        throw error;
      }
    }
  
    async executeTransaction(operations) {
      try {
        console.log('Executing transaction:', operations);
        return await this.sqlExecutor.executeTransaction(operations);
      } catch (error) {
        console.error('Transaction failed:', error);
        throw error;
      }
    }
  
    // Table Operations
    async createTable(tableName, columns) {
      const columnDefinitions = columns
        .map(col => `${col.name} ${col.type}${col.constraints ? ' ' + col.constraints : ''}`)
        .join(', ');
  
      const query = `CREATE TABLE IF NOT EXISTS ${tableName} (${columnDefinitions})`;
      return this.executeWrite(query);
    }
  
    async dropTable(tableName) {
      const query = `DROP TABLE IF EXISTS ${tableName}`;
      return this.executeWrite(query);
    }
  
    async truncateTable(tableName) {
      const query = `TRUNCATE TABLE ${tableName}`;
      return this.executeWrite(query);
    }
  
    async getTableColumns(tableName) {
      const query = `
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_name = $1
        ORDER BY ordinal_position
      `;
      return this.executeRead(query, [tableName]);
    }
  
    // Column Operations
    async addColumn(tableName, columnName, columnType, constraints = '') {
      const query = `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnType} ${constraints}`;
      return this.executeWrite(query);
    }
  
    async dropColumn(tableName, columnName) {
      const query = `ALTER TABLE ${tableName} DROP COLUMN ${columnName}`;
      return this.executeWrite(query);
    }
  
    async renameColumn(tableName, oldName, newName) {
      const query = `ALTER TABLE ${tableName} RENAME COLUMN ${oldName} TO ${newName}`;
      return this.executeWrite(query);
    }
  
    async modifyColumn(tableName, columnName, newType, constraints = '') {
      const query = `ALTER TABLE ${tableName} ALTER COLUMN ${columnName} TYPE ${newType} ${constraints}`;
      return this.executeWrite(query);
    }
  
    // Row Operations
    async deleteRows(tableName, condition) {
      const query = `DELETE FROM ${tableName} WHERE ${condition}`;
      return this.executeWrite(query);
    }
  
    async insertRow(tableName, data) {
      const columns = Object.keys(data);
      const values = Object.values(data);
      const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
      
      const query = `
        INSERT INTO ${tableName} (${columns.join(', ')}) 
        VALUES (${placeholders})
        RETURNING *
      `;
      return this.executeWrite(query, values);
    }
  
    async updateRows(tableName, data, condition) {
      const sets = Object.entries(data)
        .map(([key, _], i) => `${key} = $${i + 1}`)
        .join(', ');
      
      const query = `
        UPDATE ${tableName}
        SET ${sets}
        WHERE ${condition}
        RETURNING *
      `;
      return this.executeWrite(query, Object.values(data));
    }
  
    // Query Operations
    async query(query, params = []) {
      return this.executeRead(query, params);
    }
  
    async execute(query, params = []) {
      return this.executeWrite(query, params);
    }
  
    // Example usage:
    // await clientSqlHelper.createTable('users', [
    //   { name: 'id', type: 'SERIAL', constraints: 'PRIMARY KEY' },
    //   { name: 'name', type: 'VARCHAR(255)', constraints: 'NOT NULL' },
    //   { name: 'email', type: 'VARCHAR(255)', constraints: 'UNIQUE' }
    // ]);
    //
    // await clientSqlHelper.addColumn('users', 'age', 'INTEGER');
    // await clientSqlHelper.deleteRows('users', 'age < 18');
    // await clientSqlHelper.insertRow('users', { name: 'John', email: 'john@example.com' });
  }
  
  module.exports = ClientSqlHelper;