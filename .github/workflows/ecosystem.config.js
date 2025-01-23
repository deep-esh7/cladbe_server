module.exports = {
  apps: [
    {
      name: "cladbe_server",
      script: "./src/server.js",
      watch: false,
      env: {
        NODE_ENV: "production",
        PORT: 3000,
        DATABASE_URL: process.env.DATABASE_URL,
        FIREBASE_CONFIG: process.env.FIREBASE_CONFIG,
        PGDATABASE: process.env.PGDATABASE,
        PGHOST: process.env.PGHOST,
        PGPASSWORD: process.env.PGPASSWORD,
        PGPORT: process.env.PGPORT,
        PGUSER: process.env.PGUSER,
        TATA_CALLS_TOKEN: process.env.TATA_CALLS_TOKEN,
        BREVO_EMAILS_TOKEN: process.env.BREVO_EMAILS_TOKEN,
      },
      error_file: "logs/err.log",
      out_file: "logs/out.log",
      time: true,
      // Add this to ensure newlines are preserved in environment variables
      env_production: {
        NODE_ENV: "production",
      },
    },
  ],
};
