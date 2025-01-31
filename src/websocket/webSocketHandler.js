// WebSocketHandler.js
const WebSocket = require("ws");
const { v4: uuidv4 } = require("uuid");
const os = require("os");

class WebSocketHandler {
  constructor(server, store) {
    // Configure WebSocket server with optimized settings

    this.wsPool = new Map();
    // In WebSocketHandler.js constructor
    this.maxConnectionsPerWorker = Math.floor(
      20000 / (process.env.WORKERS_COUNT || os.cpus().length)
    );
    // Enhanced message queue
    this.messageQueue = new Array(1000);
    this.queueIndex = 0;

    // Increase batch settings
    this.batchSize = 1000;
    this.batchInterval = 100;
    this.pendingMessages = new Map();

    this.wss = new WebSocket.Server({
      server, // Keep only this
      path: "/ws",
      perMessageDeflate: {
        zlibDeflateOptions: {
          level: 1,
          memLevel: 8,
          chunkSize: 32 * 1024,
        },
        zlibInflateOptions: {
          chunkSize: 32 * 1024,
        },
        clientNoContextTakeover: true,
        serverNoContextTakeover: true,
        serverMaxWindowBits: 15,
        concurrencyLimit: 20,
        threshold: 8 * 1024,
      },
    });

    this.store = store;
    this.subscriptions = new Map();
    this.clientSubscriptions = new Map();
    this.messageQueue = new Map();
    this.clientStats = new Map();
    this.setupWebSocket();

    // Message batching
    this.batchSize = 100;
    this.batchInterval = 50; // ms
    this.batchedMessages = new Map();

    setInterval(() => this.processBatchedMessages(), this.batchInterval);

    // Listen for store updates
    this.store.on("update", async ({ key, value, source }) => {
      if (key.startsWith("subscription:")) {
        await this.handleStoreUpdate(key, value);
      }
    });
  }

  processBatchedMessages() {
    for (const [clientId, messages] of this.batchedMessages.entries()) {
      if (messages.length > 0) {
        const client = this.subscriptions.get(clientId)?.ws;
        if (client && client.readyState === WebSocket.OPEN) {
          const batch = messages.splice(0, this.batchSize);
          this.sendMessage(client, {
            type: "batch",
            messages: batch,
          });
        }
      }
    }
  }
  setupWebSocket() {
    this.wss.on("connection", async (ws, req) => {
      if (this.wsPool.size >= this.maxConnectionsPerWorker) {
        try {
          const loads = await new Promise((resolve) => {
            process.send({ type: "get_loads" });
            process.once("message", (msg) => {
              if (msg.type === "loads") resolve(msg.loads);
            });
          });

          const minLoad = Math.min(...loads.map((l) => l[1]));
          const currentLoad = this.wsPool.size / this.maxConnectionsPerWorker;

          if (currentLoad > minLoad) {
            ws.close(1013, "Redirecting to different worker");
            return;
          }
        } catch (error) {
          console.error("Load balancing error:", error);
        }
      }

      const clientId = uuidv4();
      this.wsPool.set(clientId, ws);

      // Rest of your existing connection handling code
      const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
      this.clientSubscriptions.set(ws, new Set());
      this.batchedMessages.set(clientId, []);
      this.clientStats.set(clientId, {
        connectTime: Date.now(),
        messageCount: 0,
        lastActivity: Date.now(),
        ip: ip,
      });

      ws.binaryType = "arraybuffer";
      console.log(`New client connected: ${clientId} from ${ip}`);

      const rateLimitState = {
        messages: 0,
        lastReset: Date.now(),
        timer: setInterval(() => {
          rateLimitState.messages = 0;
          rateLimitState.lastReset = Date.now();
        }, 1000),
      };

      ws.isAlive = true;
      // Rest of your event handlers
      ws.on("pong", () => {
        ws.isAlive = true;
        this.updateClientStats(clientId, "pong");
      });

      ws.on("message", async (message) => {
        try {
          rateLimitState.messages++;
          if (rateLimitState.messages > 100) {
            this.sendError(ws, "Rate limit exceeded");
            return;
          }

          const data = JSON.parse(message);
          await this.handleMessage(ws, clientId, data);
          this.updateClientStats(clientId, "message");
        } catch (error) {
          console.error(
            `Message handling error for client ${clientId}:`,
            error
          );
          this.sendError(ws, `Message handling error: ${error.message}`);
        }
      });

      ws.on("error", (error) => {
        console.error(`WebSocket error for client ${clientId}:`, error);
        this.handleClientDisconnect(ws, clientId);
      });

      ws.on("close", () => {
        clearInterval(rateLimitState.timer);
        this.handleClientDisconnect(ws, clientId);
      });

      this.sendMessage(ws, {
        type: "connection_established",
        clientId,
      });
    });

    this.setupHeartbeat();
  }
  updateClientStats(clientId, activity) {
    const stats = this.clientStats.get(clientId);
    if (stats) {
      stats.lastActivity = Date.now();
      if (activity === "message") {
        stats.messageCount++;
      }
    }
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

    if (this.queueIndex >= 900) {
      ws.pause();
      await new Promise((resolve) => {
        const checkQueue = () => {
          if (this.queueIndex < 500) {
            ws.resume();
            resolve();
          } else {
            setTimeout(checkQueue, 100);
          }
        };
        checkQueue();
      });
    }

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

      // Log slow operations
      const [seconds, nanoseconds] = process.hrtime(startTime);
      const duration = seconds * 1000 + nanoseconds / 1000000;
      if (duration > 100) {
        console.warn(
          `Slow message handling (${duration.toFixed(2)}ms): ${message.type}`
        );
      }
    } catch (error) {
      console.error(`Message handling error:`, error);
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
      const messages = this.batchedMessages.get(subscription.clientId) || [];
      messages.push({
        type: "data",
        subscriptionId,
        data: value,
      });
      this.batchedMessages.set(subscription.clientId, messages);
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
    this.batchedMessages.delete(clientId);
    this.clientStats.delete(clientId);
  }

  sendMessage(ws, message) {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        const data = JSON.stringify({
          ...message,
          timestamp: Date.now(),
        });

        if (data.length > 50 * 1024) {
          // 50KB warning threshold
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
    const batchedBroadcast = JSON.stringify({
      ...message,
      timestamp: Date.now(),
    });

    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(batchedBroadcast);
      }
    });
  }

  getStats() {
    return {
      totalConnections: this.wss.clients.size,
      subscriptions: this.subscriptions.size,
      clientStats: Array.from(this.clientStats.entries()).map(
        ([clientId, stats]) => ({
          clientId,
          ...stats,
          uptime: Date.now() - stats.connectTime,
        })
      ),
    };
  }

  async gracefulShutdown() {
    console.log("Starting WebSocket graceful shutdown");

    // Clear all intervals
    this.clientStats.forEach((stats, clientId) => {
      if (stats.timer) clearInterval(stats.timer);
    });

    // Close all client connections with status code
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
