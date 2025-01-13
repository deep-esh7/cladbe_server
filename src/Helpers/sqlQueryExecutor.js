// File: src/Helpers/SqlQueryExecutor.js
class SqlQueryExecutor {
    constructor(pool) {
      this.pool = pool;
    }
  
    async executeQuery(query, params = []) {
      const client = await this.pool.connect();
      try {
        console.log('Executing query:', { query, params });
        const result = await client.query(query, params);
        return result.rows;
      } catch (error) {
        console.error('Query execution error:', error);
        throw error;
      } finally {
        client.release();
      }
    }
  
    async executeTransaction(queries) {
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        
        const results = [];
        for (const { query, params } of queries) {
          console.log('Executing transaction query:', { query, params });
          const result = await client.query(query, params);
          results.push(result.rows);
        }
        
        await client.query('COMMIT');
        return results;
      } catch (error) {
        await client.query('ROLLBACK');
        console.error('Transaction error:', error);
        throw error;
      } finally {
        client.release();
      }
    }
  
    async executePreparedStatement(query, params = []) {
      const client = await this.pool.connect();
      try {
        // For complex queries that need to be reused
        const statement = {
          text: query,
          values: params,
        };
        
        console.log('Executing prepared statement:', statement);
        const result = await client.query(statement);
        return result.rows;
      } catch (error) {
        console.error('Prepared statement error:', error);
        throw error;
      } finally {
        client.release();
      }
    }
  
    async executeWithLock(tableName, operation) {
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        // Lock table for exclusive access
        await client.query(`LOCK TABLE ${tableName} IN ACCESS EXCLUSIVE MODE`);
        
        const result = await operation(client);
        
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        console.error('Lock operation error:', error);
        throw error;
      } finally {
        client.release();
      }
    }
  }
  
  module.exports = SqlQueryExecutor;