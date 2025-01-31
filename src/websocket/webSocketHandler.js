// WebSocketHandler.js
const WebSocket = require("ws");
const { v4: uuidv4 } = require("uuid");

class WebSocketHandler {
  constructor(server, store) {
    this.wss = new WebSocket.Server({ server, path: "/ws" });
    this.store = store;
    this.subscriptions = new Map();
    this.clientSubscriptions = new Map();
    this.setupWebSocket();

    // Listen for store updates
    this.store.on("update", async ({ key, value, source }) => {
      if (key.startsWith("subscription:")) {
        await this.handleStoreUpdate(key, value);
      }
    });
  }

  setupWebSocket() {
    this.wss.on("connection", (ws, req) => {
      const clientId = uuidv4();
      this.clientSubscriptions.set(ws, new Set());

      console.log(`New client connected: ${clientId}`);

      ws.isAlive = true;
      ws.on("pong", () => {
        ws.isAlive = true;
      });

      ws.on("message", async (message) => {
        try {
          const data = JSON.parse(message);
          await this.handleMessage(ws, clientId, data);
        } catch (error) {
          console.error("Message handling error:", error);
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
    console.log(
      `Processing message type: ${message.type} from client ${clientId}`
    );

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
      // Store subscription details
      this.subscriptions.set(subscriptionId, {
        ws,
        clientId,
        ...message.data,
      });

      this.clientSubscriptions.get(ws).add(subscriptionId);

      // Store in local store for cross-worker sharing
      const storeKey = `subscription:${subscriptionId}`;
      await this.store.set(storeKey, message.data, { ttl: 300 }); // 5 minute TTL

      this.sendMessage(ws, {
        type: "subscribed",
        subscriptionId,
      });

      // Send initial data if available
      await this.handleStoreUpdate(storeKey, message.data);
    } catch (error) {
      console.error("Subscription failed:", error);
      this.sendError(ws, error.message, subscriptionId);
    }
  }

  async handleUnsubscribe(ws, subscriptionId) {
    try {
      this.subscriptions.delete(subscriptionId);
      this.clientSubscriptions.get(ws)?.delete(subscriptionId);
      await this.store.del(`subscription:${subscriptionId}`);

      this.sendMessage(ws, {
        type: "unsubscribed",
        subscriptionId,
      });
    } catch (error) {
      console.error("Unsubscribe failed:", error);
      this.sendError(ws, error.message);
    }
  }

  async handleStoreUpdate(key, value) {
    const subscriptionId = key.replace("subscription:", "");
    const subscription = this.subscriptions.get(subscriptionId);

    if (subscription && subscription.ws.readyState === WebSocket.OPEN) {
      this.sendMessage(subscription.ws, {
        type: "data",
        subscriptionId,
        data: value,
      });
    }
  }

  handlePing(ws, message) {
    this.sendMessage(ws, {
      type: "pong",
      timestamp: new Date().toISOString(),
      data: message.data,
    });
  }

  handleClientDisconnect(ws, clientId) {
    console.log(`Client disconnected: ${clientId}`);
    const subscriptions = this.clientSubscriptions.get(ws) || new Set();

    subscriptions.forEach(async (subscriptionId) => {
      await this.store.del(`subscription:${subscriptionId}`);
      this.subscriptions.delete(subscriptionId);
    });

    this.clientSubscriptions.delete(ws);
  }

  sendMessage(ws, message) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          ...message,
          timestamp: new Date().toISOString(),
        })
      );
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

  broadcast(message) {
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        this.sendMessage(client, message);
      }
    });
  }

  async gracefulShutdown() {
    console.log("Starting WebSocket graceful shutdown");

    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.close(1000, "Server shutting down");
      }
    });

    return new Promise((resolve) => {
      this.wss.close(() => {
        console.log("WebSocket server closed");
        resolve();
      });
    });
  }
}

module.exports = WebSocketHandler;
