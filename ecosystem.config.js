module.exports = {
  apps: [
    {
      name: "cladbe_server",
      script: "./src/server.js",
      watch: false,
      ignore_watch: ["*"], // Ignore everything

      // Environment settings
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

      // Cluster mode settings
      instances: "max", // Use maximum CPU cores
      exec_mode: "cluster", // Change to cluster mode for better performance

      // Memory optimization
      node_args: "--max-old-space-size=4096 --expose-gc",
      max_memory_restart: "2G", // Increased from 300M for better stability

      // Logging settings
      error_file: "/dev/null",
      out_file: "/dev/null",
      log_type: "json",
      merge_logs: true,

      // Performance tuning
      kill_timeout: 5000, // Increased for better graceful shutdown
      exp_backoff_restart_delay: 100,
      max_restarts: 10, // Increased for better resilience
      restart_delay: 4000,
      min_uptime: "30s",
      wait_ready: true, // Wait for ready signal
      listen_timeout: 10000, // 10s to listen

      // Instance management
      instance_var: "INSTANCE_ID",
      increment_var: "PORT",

      // Source map settings
      source_map_support: false,

      // Garbage collection optimization
      gc_interval: 300000, // Run GC every 5 minutes

      // Custom environment variables for clustering
      env_production: {
        NODE_ENV: "production",
        UV_THREADPOOL_SIZE: 4, // Optimize thread pool per instance
      },

      // Graceful shutdown
      shutdown_with_message: true,

      // Health check
      status_interval: 30000, // Check status every 30s
    },
  ],

  // Deploy configuration
  deploy: {
    production: {
      // Your existing deployment settings...
      "post-deploy":
        "npm install && pm2 reload ecosystem.config.js --env production",
    },
  },
};
