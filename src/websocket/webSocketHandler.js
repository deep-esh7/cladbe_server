// websocketHandler.js
const WebSocket = require("ws");
const { v4: uuidv4 } = require("uuid");

class WebSocketHandler {
  constructor(server, clientSqlHelper, pool) {
    this.wss = new WebSocket.Server({ server, path: "/ws" });
    this.clientSqlHelper = clientSqlHelper;
    this.pool = pool; // Database pool
    this.subscriptions = new Map();
    this.clientSubscriptions = new Map();
    this.dataCache = new Map(); // Cache for last sent data
    this.setupWebSocket();
    this.log("WebSocketHandler initialized");

    // Set up PostgreSQL notification listener
    this.setupNotificationListener();
  }

  log(message, ...args) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}][WebSocketHandler] ${message}`, ...args);
  }

  logError(message, error, ...args) {
    const timestamp = new Date().toISOString();
    console.error(
      `[${timestamp}][WebSocketHandler][ERROR] ${message}`,
      error,
      ...args
    );
  }

  async setupNotificationListener() {
    try {
      const client = await this.pool.connect();
      client.on("notification", async (msg) => {
        // Handle database change notifications
        const { table, operation } = JSON.parse(msg.payload);
        await this.handleDatabaseChange(table);
      });

      // Listen for changes on all relevant tables
      await client.query("LISTEN table_changes");

      this.log("Notification listener setup completed");
    } catch (error) {
      this.logError("Error setting up notification listener:", error);
    }
  }

  async handleDatabaseChange(tableName) {
    // Find all subscriptions for this table
    for (const [subId, sub] of this.subscriptions.entries()) {
      if (sub.tableName === tableName) {
        await this.refreshSubscriptionData(subId, sub);
      }
    }
  }

  setupWebSocket() {
    this.log("Setting up WebSocket server");

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
          this.log(`Received message from client ${clientId}:`, data);
          await this.handleMessage(ws, clientId, data);
        } catch (error) {
          this.logError("Message handling error:", error);
          this.sendError(ws, `Message handling error: ${error.message}`);
        }
      });

      ws.on("error", (error) => {
        this.logError(`WebSocket error for client ${clientId}:`, error);
      });

      ws.on("close", () => {
        this.handleClientDisconnect(ws, clientId);
      });

      this.sendMessage(ws, {
        type: "connection_established",
        clientId,
      });
    });

    this.setupHealthCheck();
  }

  setupHealthCheck() {
    const interval = setInterval(() => {
      this.wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
          this.log("Terminating inactive connection");
          return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping(() => {});
      });
    }, 30000);

    this.wss.on("close", () => {
      clearInterval(interval);
    });
  }

  handleClientDisconnect(ws, clientId) {
    this.log(`Client disconnected: ${clientId}`);
    const subscriptions = this.clientSubscriptions.get(ws) || new Set();

    for (const subId of subscriptions) {
      const sub = this.subscriptions.get(subId);
      if (sub) {
        if (sub.client) {
          sub.client.release();
        }
        this.subscriptions.delete(subId);
        this.dataCache.delete(subId);
        this.log(`Cleaned up subscription: ${subId}`);
      }
    }

    this.clientSubscriptions.delete(ws);
    this.log(`Removed all subscriptions for client: ${clientId}`);
  }

  async handleMessage(ws, clientId, message) {
    this.log(`Processing message of type: ${message.type}`);

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
    let dedicatedClient = null;

    try {
      this.log(`Processing subscription request:`, message.data);

      const {
        tableName,
        columns,
        filters,
        groupBy,
        having,
        orderBy,
        limit,
        offset,
        interval = 5000,
      } = message.data;

      if (!tableName) {
        throw new Error("Table name is required");
      }

      const query = this.buildQuery({
        tableName,
        columns,
        filters,
        groupBy,
        having,
        orderBy,
        limit,
        offset,
      });

      this.log(`Built query for subscription ${subscriptionId}:`, query);
      const parameters = this.extractParameters(filters, having);

      // Get a dedicated client for this subscription
      dedicatedClient = await this.pool.connect();

      // Set up change notification trigger for this table if not exists
      await this.setupTableTrigger(dedicatedClient, tableName);

      // Initial data fetch and send
      const initialResults = await this.executeQueryWithRetry(
        dedicatedClient,
        query,
        parameters
      );

      const subscriptionData = {
        intervalId: null,
        query,
        parameters,
        clientId,
        tableName,
        client: dedicatedClient,
        ws,
      };

      // Store subscription details
      this.subscriptions.set(subscriptionId, subscriptionData);
      this.clientSubscriptions.get(ws).add(subscriptionId);
      this.dataCache.set(subscriptionId, JSON.stringify(initialResults));

      // Confirm subscription
      this.sendMessage(ws, {
        type: "subscribed",
        subscriptionId,
        tableName,
      });

      // Send initial data
      this.sendMessage(ws, {
        type: "data",
        subscriptionId,
        data: initialResults,
      });

      // Set up polling interval as backup
      subscriptionData.intervalId = setInterval(async () => {
        await this.refreshSubscriptionData(subscriptionId, subscriptionData);
      }, interval);

      this.log(`Subscription ${subscriptionId} setup completed`);
    } catch (error) {
      this.logError(`Subscription setup failed for ${subscriptionId}:`, error);
      if (dedicatedClient) {
        dedicatedClient.release();
      }
      this.sendError(ws, error.message);

      if (this.subscriptions.has(subscriptionId)) {
        const subscription = this.subscriptions.get(subscriptionId);
        clearInterval(subscription.intervalId);
        this.subscriptions.delete(subscriptionId);
        this.clientSubscriptions.get(ws)?.delete(subscriptionId);
      }
    }
  }

  async refreshSubscriptionData(subscriptionId, subscription) {
    const { ws, client, query, parameters } = subscription;

    try {
      const results = await this.executeQueryWithRetry(
        client,
        query,
        parameters
      );
      const newDataString = JSON.stringify(results);

      // Only send if data has changed
      if (this.dataCache.get(subscriptionId) !== newDataString) {
        this.dataCache.set(subscriptionId, newDataString);
        if (ws.readyState === WebSocket.OPEN) {
          this.sendMessage(ws, {
            type: "data",
            subscriptionId,
            data: results,
          });
        }
      }
    } catch (error) {
      this.logError(
        `Refresh failed for subscription ${subscriptionId}:`,
        error
      );
      this.sendError(ws, error.message, subscriptionId);
    }
  }

  async executeQueryWithRetry(client, query, parameters, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await client.query(query, parameters);
        return result.rows;
      } catch (error) {
        if (attempt === maxRetries) throw error;
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    }
  }

  async setupTableTrigger(client, tableName) {
    const triggerName = `${tableName}_notify_trigger`;
    const functionName = `${tableName}_notify_function`;

    try {
      // Create notification function if not exists
      await client.query(`
        CREATE OR REPLACE FUNCTION ${functionName}() RETURNS TRIGGER AS $$
        BEGIN
          PERFORM pg_notify('table_changes', json_build_object(
            'table', TG_TABLE_NAME,
            'operation', TG_OP
          )::text);
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
      `);

      // Create trigger if not exists
      await client.query(`
        DROP TRIGGER IF EXISTS ${triggerName} ON ${tableName};
        CREATE TRIGGER ${triggerName}
        AFTER INSERT OR UPDATE OR DELETE ON ${tableName}
        FOR EACH ROW EXECUTE FUNCTION ${functionName}();
      `);
    } catch (error) {
      this.logError(`Error setting up trigger for ${tableName}:`, error);
      throw error;
    }
  }

  async handleUnsubscribe(ws, subscriptionId) {
    try {
      this.log(`Processing unsubscribe request for: ${subscriptionId}`);

      const subscription = this.subscriptions.get(subscriptionId);
      if (subscription) {
        clearInterval(subscription.intervalId);
        if (subscription.client) {
          subscription.client.release();
        }
        this.subscriptions.delete(subscriptionId);
        this.clientSubscriptions.get(ws)?.delete(subscriptionId);
        this.dataCache.delete(subscriptionId);

        this.sendMessage(ws, {
          type: "unsubscribed",
          subscriptionId,
        });

        this.log(`Successfully unsubscribed: ${subscriptionId}`);
      }
    } catch (error) {
      this.logError(`Unsubscribe failed for ${subscriptionId}:`, error);
      this.sendError(ws, error.message);
    }
  }

  handlePing(ws, message) {
    try {
      this.sendMessage(ws, {
        type: "pong",
        timestamp: new Date().toISOString(),
        echo: message.data,
      });
    } catch (error) {
      this.logError("Error handling ping:", error);
    }
  }

  buildQuery({
    tableName,
    columns,
    filters,
    groupBy,
    having,
    orderBy,
    limit,
    offset,
  }) {
    return this.clientSqlHelper._buildQueryWithModifiers({
      tableName,
      columns,
      filters,
      groupBy,
      having,
      orderBy,
      limit,
      offset,
    });
  }

  extractParameters(filters, having) {
    const params = [];
    if (filters) params.push(...filters.flatMap((f) => f.getParameters()));
    if (having) params.push(...having.flatMap((h) => h.getParameters()));
    return params;
  }

  sendMessage(ws, message) {
    if (ws.readyState === WebSocket.OPEN) {
      const messageString = JSON.stringify(message);
      ws.send(messageString);
    }
  }

  sendError(ws, error, subscriptionId = null) {
    this.sendMessage(ws, {
      type: "error",
      error,
      subscriptionId,
      timestamp: new Date().toISOString(),
    });
  }

  async gracefulShutdown() {
    this.log("Starting graceful shutdown");

    for (const [_, subscription] of this.subscriptions) {
      clearInterval(subscription.intervalId);
      if (subscription.client) {
        subscription.client.release();
      }
    }

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
