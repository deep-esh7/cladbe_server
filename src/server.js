const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const { DatabaseHelper } = require("../src/Helpers/databaseHelper.js");
const { TableHelper } = require("./Helpers/leadsTableHelper.js");
const leadsRoutes = require("./routes/leadsSearch.routes.js");
const db = require("../src/db/connection.js");

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(morgan("dev")); // Logging

// Routes
app.use("/leads", leadsRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    error: "Internal server error",
    message: err.message,
  });
});

const PORT = process.env.PORT || 3000;

async function initializeDatabase() {
  try {
    // Initialize database helpers
    const dbHelper = new DatabaseHelper(db.pool);
    const tableHelper = new TableHelper(db.pool);

    // Check if database exists, if not create it
    const dbExists = await dbHelper.checkDatabaseExists("cladbe");
    if (!dbExists) {
      console.log("Creating database...");
      await dbHelper.createDatabase("cladbe");
    }

    // Create leads table
    console.log("Setting up tables...");
    await tableHelper.createLeadsTable();
    // await tableHelper.dropLeadsTable();

    console.log("Database initialization completed");
  } catch (error) {
    console.error("Database initialization failed:", error);
    process.exit(1);
  }
}

// Start server
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  await initializeDatabase();
});
