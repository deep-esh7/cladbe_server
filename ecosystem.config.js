module.exports = {
  apps: [
    {
      name: "cladbe_server",
      script: "./src/server.js",
      watch: false,
      ignore_watch: ["*"],

      // Optimized Clustering
      instances: 12,
      exec_mode: "cluster",

      // Resource Management
      max_memory_restart: "4G",
      node_args: [
        "--max-old-space-size=4096",
        "--nouse-idle-notification",
        "--expose-gc",
      ],

      env_production: {
        NODE_ENV: "production",
        PORT: 3000,
        UV_THREADPOOL_SIZE: 4,
        // Keep existing env vars
        DATABASE_URL: process.env.DATABASE_URL,
        FIREBASE_CONFIG: process.env.FIREBASE_CONFIG,
        PGDATABASE: process.env.PGDATABASE,
        PGHOST: process.env.PGHOST,
        PGPASSWORD: process.env.PGPASSWORD,
        PGPORT: process.env.PGPORT,
        PGUSER: process.env.PGUSER,
        TATA_CALLS_TOKEN: process.env.TATA_CALLS_TOKEN,
        BREVO_EMAILS_TOKEN: process.env.BREVO_EMAILS_TOKEN,

        // WebSocket optimizations
        WS_MAX_PAYLOAD: "50kb",
        WS_BACKLOG: 20000,
        WS_MAX_CONNECTIONS: 20000,
        WS_HEARTBEAT_INTERVAL: 30000,
        WS_PING_TIMEOUT: 5000,
      },

      // Performance Tuning
      kill_timeout: 10000,
      exp_backoff_restart_delay: 100,
      max_restarts: 10,
      restart_delay: 4000,
      min_uptime: "30s",

      // Garbage Collection optimization
      gc_interval: 300000, // Run GC every 5 minutes

      // Logging
      error_file: "/dev/null",
      out_file: "/dev/null",
      log_type: "json",
      merge_logs: true,
    },
  ],
};
