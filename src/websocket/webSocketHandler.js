// WebSocketHandler.js
const WebSocket = require("ws");
const { v4: uuidv4 } = require("uuid");

class WebSocketHandler {
  constructor(server, store) {
    this.wss = new WebSocket.Server({
      server,
      path: "/ws",
      // Performance optimizations
      perMessageDeflate: {
        zlibDeflateOptions: {
          chunkSize: 1024,
          memLevel: 7,
          level: 3,
        },
        zlibInflateOptions: {
          chunkSize: 10 * 1024,
        },
        clientNoContextTakeover: true,
        serverNoContextTakeover: true,
        threshold: 1024,
      },
    });

    this.store = store;
    this.subscriptions = new Map();
    this.clientSubscriptions = new Map();
    this.messageQueue = new Map();
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
      const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;

      // Rate limiting setup
      this.messageQueue.set(clientId, {
        messages: 0,
        lastReset: Date.now(),
        timer: setInterval(() => {
          const client = this.messageQueue.get(clientId);
          if (client) {
            client.messages = 0;
            client.lastReset = Date.now();
          }
        }, 1000),
      });

      this.clientSubscriptions.set(ws, new Set());
      ws.binaryType = "arraybuffer"; // More efficient binary handling

      console.log(`New client connected: ${clientId} from ${ip}`);

      ws.isAlive = true;
      ws.on("pong", () => {
        ws.isAlive = true;
      });

      ws.on("message", async (message) => {
        try {
          // Rate limiting check
          const client = this.messageQueue.get(clientId);
          if (client.messages >= 100) {
            // 100 messages per second limit
            this.sendError(ws, "Rate limit exceeded");
            return;
          }
          client.messages++;

          const data = JSON.parse(message);
          await this.handleMessage(ws, clientId, data);
        } catch (error) {
          console.error("Message handling error:", error);
          this.sendError(ws, `Message handling error: ${error.message}`);
        }
      });

      ws.on("close", () => {
        clearInterval(this.messageQueue.get(clientId)?.timer);
        this.messageQueue.delete(clientId);
        this.handleClientDisconnect(ws, clientId);
      });

      ws.on("error", (error) => {
        console.error(`WebSocket error for client ${clientId}:`, error);
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
    const startTime = process.hrtime();

    try {
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

      // Performance monitoring
      const [seconds, nanoseconds] = process.hrtime(startTime);
      const duration = seconds * 1000 + nanoseconds / 1000000;
      if (duration > 100) {
        // Log slow operations
        console.warn(
          `Slow message handling (${duration.toFixed(2)}ms): ${message.type}`
        );
      }
    } catch (error) {
      console.error("Message handling error:", error);
      this.sendError(ws, error.message);
    }
  }

  async handleSubscribe(ws, clientId, message) {
    const subscriptionId = message.subscriptionId || uuidv4();
    try {
      this.subscriptions.set(subscriptionId, {
        ws,
        clientId,
        ...message.data,
      });

      this.clientSubscriptions.get(ws).add(subscriptionId);

      const storeKey = `subscription:${subscriptionId}`;
      await this.store.set(storeKey, message.data, { ttl: 300 });

      this.sendMessage(ws, {
        type: "subscribed",
        subscriptionId,
      });

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
      timestamp: Date.now(),
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
      try {
        const data = JSON.stringify({
          ...message,
          timestamp: Date.now(),
        });

        if (data.length > 1024 * 50) {
          // 50KB threshold
          console.warn(`Large message being sent: ${data.length} bytes`);
        }

        ws.send(data);
      } catch (error) {
        console.error("Error sending message:", error);
      }
    }
  }

  sendError(ws, error, subscriptionId = null) {
    this.sendMessage(ws, {
      type: "error",
      error,
      subscriptionId,
      timestamp: Date.now(),
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

    // Clear all intervals
    this.messageQueue.forEach((client) => {
      clearInterval(client.timer);
    });

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
