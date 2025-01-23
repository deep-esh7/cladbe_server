module.exports = {
  apps: [
    {
      name: "cladbe_server",
      script: "./src/server.js",
      watch: false,              // Disable file watching
      ignore_watch: [           
        "node_modules", 
        "logs",
        ".git",
        "*.log"
      ],
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
      autorestart: true,
      max_memory_restart: "300M",
      kill_timeout: 3000,
      exp_backoff_restart_delay: 100,
      max_restarts: 5,          // Reduced from 10 to prevent excessive restarts
      restart_delay: 4000,
      
      // Added new configurations for better stability
      min_uptime: "30s",        // Consider process stable after 30s
      listen_timeout: 3000,     // Give process 3s to bind to port
      merge_logs: true,         // Merge worker logs
      combine_logs: true,       // Combine output and error logs
      log_date_format: "YYYY-MM-DD HH:mm Z",  // Better timestamp format
      wait_ready: true,         // Wait for ready signal
      stop_exit_codes: [0],     // Graceful stop on these exit codes
      instances: 1,             // Run single instance
      exec_mode: "fork",        // Run in fork mode
    },
  ],
 };