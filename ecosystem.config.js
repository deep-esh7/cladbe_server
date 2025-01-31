module.exports = {
  apps: [
    {
      name: "cladbe_server",
      script: "./src/server.js",
      watch: false,
      ignore_watch: ["*"],

      // Process Management
      exec_mode: "cluster",
      instances: "max",
      kill_timeout: 6000,
      wait_ready: true,
      listen_timeout: 15000,

      // Resource Management
      max_memory_restart: "2G",
      node_args: "--max-old-space-size=4096",
      max_open_files: 65535,

      // Performance
      max_restarts: 5,
      min_uptime: "30s",
      restart_delay: 5000,

      // Logging
      error_file: "./logs/pm2.error.log",
      out_file: "./logs/pm2.out.log",
      log_type: "json",
      merge_logs: true,

      // Environment Variables
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

      env_production: {
        NODE_ENV: "production",
        UV_THREADPOOL_SIZE: 4,
      },
    },
  ],
};
