const WebSocket = require("ws");
const { v4: uuidv4 } = require("uuid");

class WebSocketHandler {
  constructor(server, clientSqlHelper, pool) {
    this.wss = new WebSocket.Server({ server, path: "/ws" });
    this.clientSqlHelper = clientSqlHelper;
    this.pool = pool;
    this.subscriptions = new Map(); // subscriptionId -> subscription details
    this.tableListeners = new Map(); // tableName -> Set of subscriptionIds
    this.clientSubscriptions = new Map(); // ws -> Set of subscriptionIds
    this.dataCache = new Map(); // subscriptionId -> last sent data
    this.setupWebSocket();
    this.notificationClient = null;
    this.log("WebSocketHandler initialized");
  }

  log(message, ...args) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}][WebSocketHandler] ${message}`, ...args);
  }

  logError(message, error, ...args) {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}][WebSocketHandler][ERROR] ${message}`, error, ...args);
  }

  async setupNotificationListener() {
    try {
      // Create a dedicated client for notifications
      this.notificationClient = await this.pool.connect();
      
      this.notificationClient.on("notification", async (msg) => {
        try {
          const payload = JSON.parse(msg.payload);
          await this.handleDatabaseChange(payload);
        } catch (error) {
          this.logError("Error handling notification:", error);
        }
      });

      await this.notificationClient.query("LISTEN table_changes");
      this.log("Notification listener setup completed");
    } catch (error) {
      this.logError("Error setting up notification listener:", error);
      throw error;
    }
  }

  async setupTableTrigger(tableName) {
    if (!tableName) return;

    let client;
    try {
      client = await this.pool.connect();
      const triggerName = `${tableName}_notify_trigger`;
      const functionName = `${tableName}_notify_function`;

      // Create notification function
      await client.query(`
        CREATE OR REPLACE FUNCTION ${functionName}() RETURNS TRIGGER AS $$
        BEGIN
          PERFORM pg_notify(
            'table_changes',
            json_build_object(
              'table', TG_TABLE_NAME,
              'operation', TG_OP,
              'old_data', CASE WHEN TG_OP = 'DELETE' THEN row_to_json(OLD) ELSE NULL END,
              'new_data', CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN row_to_json(NEW) ELSE NULL END,
              'timestamp', CURRENT_TIMESTAMP
            )::text
          );
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
      `);

      // Create trigger
      await client.query(`
        DROP TRIGGER IF EXISTS ${triggerName} ON ${tableName};
        CREATE TRIGGER ${triggerName}
        AFTER INSERT OR UPDATE OR DELETE ON ${tableName}
        FOR EACH ROW
        EXECUTE FUNCTION ${functionName}();
      `);

      this.log(`Trigger setup completed for table: ${tableName}`);
    } catch (error) {
      this.logError(`Error setting up trigger for ${tableName}:`, error);
      throw error;
    } finally {
      if (client) {
        client.release();
      }
    }
  }

  setupWebSocket() {
    this.wss.on("connection", (ws, req) => {
      const clientId = uuidv4();
      this.clientSubscriptions.set(ws, new Set());

      this.log(`New client connected: ${clientId}`);

      ws.isAlive = true;
      ws.on("pong", () => {
        ws.isAlive = true;
      });

      ws.on("message", async (message) => {
        try {
          const data = JSON.parse(message);
          await this.handleMessage(ws, clientId, data);
        } catch (error) {
          this.logError("Message handling error:", error);
          this.sendError(ws, `Message handling error: ${error.message}`);
        }
      });

      ws.on("close", () => {
        this.handleClientDisconnect(ws, clientId);
      });

      this.sendMessage(ws, {
        type: "connection_established",
        clientId,
      });
    });

    this.setupHeartbeat();
  }

  setupHeartbeat() {
    const interval = setInterval(() => {
      this.wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
          this.log("Terminating inactive connection");
          return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
      });
    }, 30000);

    this.wss.on("close", () => {
      clearInterval(interval);
    });
  }

  async handleMessage(ws, clientId, message) {
    this.log(`Processing message type: ${message.type}`);

    switch (message.type) {
      case "subscribe":
        await this.handleSubscribe(ws, clientId, message);
        break;

      case "unsubscribe":
        await this.handleUnsubscribe(ws, message.subscriptionId);
        break;

      case "ping":
        this.handlePing(ws, message);
        break;

      default:
        this.sendError(ws, "Unknown message type");
    }
  }

  async handleSubscribe(ws, clientId, message) {
    const subscriptionId = message.subscriptionId || uuidv4();
    try {
      const { tableName, columns, filters, groupBy, having, orderBy, limit, offset } = message.data;

      if (!tableName) {
        throw new Error("Table name is required");
      }

      // Setup trigger for this table if not already set up
      await this.setupTableTrigger(tableName);

      // Add to table listeners
      if (!this.tableListeners.has(tableName)) {
        this.tableListeners.set(tableName, new Set());
      }
      this.tableListeners.get(tableName).add(subscriptionId);

      // Store subscription details
      this.subscriptions.set(subscriptionId, {
        ws,
        clientId,
        tableName,
        columns,
        filters,
        groupBy,
        having,
        orderBy,
        limit,
        offset
      });

      this.clientSubscriptions.get(ws).add(subscriptionId);

      // Send confirmation
      this.sendMessage(ws, {
        type: "subscribed",
        subscriptionId,
        tableName
      });

      // Send initial data
      await this.sendSubscriptionData(subscriptionId);

      this.log(`Client ${clientId} subscribed to table ${tableName}`);
    } catch (error) {
      this.logError(`Subscription failed:`, error);
      this.sendError(ws, error.message, subscriptionId);
    }
  }

  async handleUnsubscribe(ws, subscriptionId) {
    try {
      const subscription = this.subscriptions.get(subscriptionId);
      if (subscription) {
        const { tableName } = subscription;
        
        // Remove from table listeners
        this.tableListeners.get(tableName)?.delete(subscriptionId);
        
        // Cleanup if no more listeners
        if (this.tableListeners.get(tableName)?.size === 0) {
          this.tableListeners.delete(tableName);
        }

        this.subscriptions.delete(subscriptionId);
        this.clientSubscriptions.get(ws)?.delete(subscriptionId);
        this.dataCache.delete(subscriptionId);

        this.sendMessage(ws, {
          type: "unsubscribed",
          subscriptionId
        });
      }
    } catch (error) {
      this.logError(`Unsubscribe failed:`, error);
      this.sendError(ws, error.message);
    }
  }

  async handleDatabaseChange(payload) {
    const { table, operation, old_data, new_data } = payload;
    
    // Get all subscriptions for this table
    const listeners = this.tableListeners.get(table);
    if (!listeners) return;

    // Update all relevant subscriptions
    for (const subscriptionId of listeners) {
      await this.sendSubscriptionData(subscriptionId, true);
    }
  }

  async sendSubscriptionData(subscriptionId, isUpdate = false) {
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription || subscription.ws.readyState !== WebSocket.OPEN) return;

    try {
      const query = this.clientSqlHelper._buildQueryWithModifiers({
        tableName: subscription.tableName,
        columns: subscription.columns,
        filters: subscription.filters,
        groupBy: subscription.groupBy,
        having: subscription.having,
        orderBy: subscription.orderBy,
        limit: subscription.limit,
        offset: subscription.offset
      });

      const parameters = this.clientSqlHelper.extractParameters(subscription.filters, subscription.having);
      const result = await this.clientSqlHelper.executeRead(query, parameters);
      
      const dataString = JSON.stringify(result);
      if (dataString !== this.dataCache.get(subscriptionId)) {
        this.dataCache.set(subscriptionId, dataString);
        this.sendMessage(subscription.ws, {
          type: "data",
          subscriptionId,
          data: result
        });
      }
    } catch (error) {
      this.logError(`Error sending subscription data:`, error);
      this.sendError(subscription.ws, error.message, subscriptionId);
    }
  }

  handleClientDisconnect(ws, clientId) {
    this.log(`Client disconnected: ${clientId}`);
    const subscriptions = this.clientSubscriptions.get(ws) || new Set();

    for (const subscriptionId of subscriptions) {
      const subscription = this.subscriptions.get(subscriptionId);
      if (subscription) {
        const { tableName } = subscription;
        this.tableListeners.get(tableName)?.delete(subscriptionId);
        this.subscriptions.delete(subscriptionId);
        this.dataCache.delete(subscriptionId);
      }
    }

    this.clientSubscriptions.delete(ws);
  }

  handlePing(ws, message) {
    this.sendMessage(ws, {
      type: "pong",
      timestamp: new Date().toISOString(),
      data: message.data
    });
  }

  sendMessage(ws, message) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        ...message,
        timestamp: new Date().toISOString()
      }));
    }
  }

  sendError(ws, error, subscriptionId = null) {
    this.sendMessage(ws, {
      type: "error",
      error,
      subscriptionId,
      timestamp: new Date().toISOString()
    });
  }

  async gracefulShutdown() {
    this.log("Starting graceful shutdown");

    // Release notification client
    if (this.notificationClient) {
      await this.notificationClient.release();
    }

    // Close all client connections
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.close(1000, "Server shutting down");
      }
    });

    return new Promise((resolve) => {
      this.wss.close(() => {
        this.log("WebSocket server closed");
        resolve();
      });
    });
  }
}

module.exports = WebSocketHandler;