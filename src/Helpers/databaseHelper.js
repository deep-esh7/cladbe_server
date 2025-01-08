class DatabaseHelper {
    constructor(pool) {
      this.pool = pool;
    }
  
    async createDatabase(databaseName) {
      const client = await this.pool.connect();
      try {
        // Disconnect existing connections to the database
        await client.query(`
          SELECT pg_terminate_backend(pg_stat_activity.pid)
          FROM pg_stat_activity
          WHERE pg_stat_activity.datname = $1
          AND pid <> pg_backend_pid()
        `, [databaseName]);
  
        // Create database without transaction
        await client.query(`CREATE DATABASE ${databaseName}`);
        
        console.log(`Database ${databaseName} created successfully`);
      } catch (error) {
        throw new Error(`Failed to create database: ${error.message}`);
      } finally {
        client.release();
      }
    }
  
    async dropDatabase(databaseName) {
      const client = await this.pool.connect();
      try {
        // Disconnect existing connections
        await client.query(`
          SELECT pg_terminate_backend(pid)
          FROM pg_stat_activity
          WHERE datname = $1
        `, [databaseName]);
  
        await client.query(`DROP DATABASE IF EXISTS ${databaseName}`);
        
        console.log(`Database ${databaseName} dropped successfully`);
      } catch (error) {
        throw new Error(`Failed to drop database: ${error.message}`);
      } finally {
        client.release();
      }
    }
  
    async checkDatabaseExists(databaseName) {
      const client = await this.pool.connect();
      try {
        const result = await client.query(`
          SELECT 1 FROM pg_database WHERE datname = $1
        `, [databaseName]);
        
        return result.rows.length > 0;
      } catch (error) {
        throw new Error(`Failed to check database existence: ${error.message}`);
      } finally {
        client.release();
      }
    }
  
    async initializeDatabase(databaseName) {
      try {
        // Connect to the default database first
        const exists = await this.checkDatabaseExists(databaseName);
        if (!exists) {
          await this.createDatabase(databaseName);
          return true;
        }
        return false;
      } catch (error) {
        console.error(`Database initialization failed: ${error.message}`);
        throw error;
      }
    }
  }
  
  module.exports = {
    DatabaseHelper
  };