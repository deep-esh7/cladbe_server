module.exports = {
  apps: [
    {
      name: "cladbe_server",
      script: "./src/server.js",
      watch: false,
      ignore_watch: ["*"],

      // Use all cores
      instances: 12, // Use all CPU cores
      exec_mode: "cluster",

      // Resource Management
      max_memory_restart: "4G", // Increased from 2G
      node_args: "--max-old-space-size=4096",

      env_production: {
        NODE_ENV: "production",
        PORT: 3000,
        UV_THREADPOOL_SIZE: 4, // Optimal thread pool size
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

      // Performance Settings
      kill_timeout: 10000, // Increased from 6000
      exp_backoff_restart_delay: 100,
      max_restarts: 10, // Increased from 5
      restart_delay: 4000,
      min_uptime: "30s",

      // Logging
      error_file: "/dev/null",
      out_file: "/dev/null",
      log_type: "json",
      merge_logs: true,
    },
  ],
};
