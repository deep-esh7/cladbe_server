module.exports = {
  apps: [
    {
      name: "cladbe_server",
      script: "./src/server.js",
      watch: false,
      ignore_watch: ["*"],

      // Cluster Configuration for Max Capacity
      instances: "max", // Use all CPU cores
      exec_mode: "cluster", // Cluster mode for better performance

      // Resource Management
      max_memory_restart: "2G", // Increased memory limit
      node_args: "--max-old-space-size=4096", // 4GB heap size
      max_open_files: 65535, // Max file descriptors

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
        UV_THREADPOOL_SIZE: 4, // Optimize thread pool
      },

      // Performance Tuning
      kill_timeout: 6000, // Increased for better graceful shutdown
      exp_backoff_restart_delay: 100,
      max_restarts: 10, // Increased for better resilience
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
