// src/scripts/setupDatabase.js
const { DatabaseHelper } = require("../Helpers/databaseHelper");
const { TableHelper } = require("../Helpers/tableHelper");
const db = require("../db/connection");

async function setupDatabase() {
  try {
    console.log("Starting database setup...");

    const dbHelper = new DatabaseHelper(db.pool);
    const tableHelper = new TableHelper(db.pool);

    // Create tables
    console.log("Creating tables...");
    await tableHelper.createLeadsTable();

    // Add search indexes
    console.log("Adding search indexes...");
    await tableHelper.addSearchIndexes();

    console.log("Database setup completed successfully");
    process.exit(0);
  } catch (error) {
    console.error("Database setup failed:", error);
    process.exit(1);
  }
}

setupDatabase();