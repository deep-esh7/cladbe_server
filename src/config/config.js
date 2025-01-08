require("dotenv").config();

const dbConfig = {
  host: process.env.PGHOST || "localhost",
  port: parseInt(process.env.PGPORT || "5432"),
  database: process.env.PGDATABASE || "cladbe",
  user: process.env.PGUSER || "postgres",
  password: process.env.PGPASSWORD,
  ssl:
    process.env.NODE_ENV === "production"
      ? {
          rejectUnauthorized: false,
          ca: process.env.SSL_CERT_DAYS,
        }
      : false,
};

module.exports = dbConfig;
