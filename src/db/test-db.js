// test-db.js
const db = require("./connection");

async function testConnection() {
  try {
    console.log("Testing database connection...");
    console.log("Environment variables:");
    console.log(`Host: ${process.env.PGHOST}`);
    console.log(`Port: ${process.env.PGPORT}`);
    console.log(`Database: ${process.env.PGDATABASE}`);
    console.log(`User: ${process.env.PGUSER}`);

    const isHealthy = await db.healthCheck();
    console.log("Connection test result:", isHealthy ? "SUCCESS" : "FAILED");

    if (isHealthy) {
      const { rows } = await db.query("SELECT version()");
      console.log("PostgreSQL version:", rows[0].version);
    }
  } catch (error) {
    console.error("Test failed:", error.message);
  } finally {
    await db.close();
  }
}

testConnection();
