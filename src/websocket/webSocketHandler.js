// websocketHandler.js
const WebSocket = require("ws");
const { v4: uuidv4 } = require("uuid");

class WebSocketHandler {
  constructor(server, clientSqlHelper) {
    this.wss = new WebSocket.Server({ server, path: "/ws" });
    this.clientSqlHelper = clientSqlHelper;
    this.subscriptions = new Map();
    this.clientSubscriptions = new Map();
    this.setupWebSocket();

    this.log("WebSocketHandler initialized");
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

  setupWebSocket() {
    this.log("Setting up WebSocket server");

    this.wss.on("connection", (ws, req) => {
      const clientId = uuidv4();
      this.clientSubscriptions.set(ws, new Set());

      this.log(`New client connected: ${clientId}`);

      // Set up ping-pong for connection health check
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

      // Send initial connection success message
      this.sendMessage(ws, {
        type: "connection_established",
        clientId,
      });
    });

    // Setup connection health monitoring
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

    // Clean up all subscriptions for this client
    for (const subId of subscriptions) {
      const sub = this.subscriptions.get(subId);
      if (sub) {
        clearInterval(sub.intervalId);
        this.subscriptions.delete(subId);
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
        interval = 1000,
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

      // Set up polling interval
      const intervalId = setInterval(async () => {
        try {
          const results = await this.clientSqlHelper.executeRead(
            query,
            parameters
          );

          if (ws.readyState === WebSocket.OPEN) {
            this.sendMessage(ws, {
              type: "data",
              subscriptionId,
              data: results,
            });
          }
        } catch (error) {
          this.logError(
            `Subscription query error for ${subscriptionId}:`,
            error
          );
          this.sendError(ws, error.message, subscriptionId);
        }
      }, interval);

      // Store subscription details
      this.subscriptions.set(subscriptionId, {
        intervalId,
        query,
        parameters,
        clientId,
        tableName,
      });

      // Add to client's subscriptions
      this.clientSubscriptions.get(ws).add(subscriptionId);

      // Confirm subscription
      this.sendMessage(ws, {
        type: "subscribed",
        subscriptionId,
        tableName,
      });

      // Send initial data
      const initialResults = await this.clientSqlHelper.executeRead(
        query,
        parameters
      );
      this.sendMessage(ws, {
        type: "data",
        subscriptionId,
        data: initialResults,
      });

      this.log(`Subscription ${subscriptionId} setup completed`);
    } catch (error) {
      this.logError(`Subscription setup failed for ${subscriptionId}:`, error);
      this.sendError(ws, error.message);

      // Clean up any partial subscription
      if (this.subscriptions.has(subscriptionId)) {
        const subscription = this.subscriptions.get(subscriptionId);
        clearInterval(subscription.intervalId);
        this.subscriptions.delete(subscriptionId);
        this.clientSubscriptions.get(ws)?.delete(subscriptionId);
      }
    }
  }

  async handleUnsubscribe(ws, subscriptionId) {
    try {
      this.log(`Processing unsubscribe request for: ${subscriptionId}`);

      const subscription = this.subscriptions.get(subscriptionId);
      if (subscription) {
        clearInterval(subscription.intervalId);
        this.subscriptions.delete(subscriptionId);
        this.clientSubscriptions.get(ws)?.delete(subscriptionId);

        this.sendMessage(ws, {
          type: "unsubscribed",
          subscriptionId,
        });

        this.log(`Successfully unsubscribed: ${subscriptionId}`);
      } else {
        this.log(`No subscription found for ID: ${subscriptionId}`);
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
    this.log("Building query for table:", tableName);

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

    if (filters) {
      this.log("Extracting filter parameters");
      params.push(...filters.flatMap((f) => f.getParameters()));
    }

    if (having) {
      this.log("Extracting having parameters");
      params.push(...having.flatMap((h) => h.getParameters()));
    }

    this.log("Extracted parameters:", params);
    return params;
  }

  sendMessage(ws, message) {
    if (ws.readyState === WebSocket.OPEN) {
      const messageString = JSON.stringify(message);
      this.log("Sending message:", message);
      ws.send(messageString);
    } else {
      this.log("Cannot send message - WebSocket not open");
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

    // Clear all intervals
    for (const [subscriptionId, subscription] of this.subscriptions) {
      clearInterval(subscription.intervalId);
      this.log(`Cleared interval for subscription: ${subscriptionId}`);
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
