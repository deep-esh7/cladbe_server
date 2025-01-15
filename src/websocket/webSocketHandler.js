// websocketHandler.js
const WebSocket = require("ws");
const { v4: uuidv4 } = require("uuid");

class WebSocketHandler {
  constructor(server, clientSqlHelper) {
    this.wss = new WebSocket.Server({ server, path: "/ws" });
    this.clientSqlHelper = clientSqlHelper;
    this.subscriptions = new Map();
    this.setupWebSocket();

    // Keep track of subscriptions by client
    this.clientSubscriptions = new Map();
  }

  setupWebSocket() {
    this.wss.on("connection", (ws, req) => {
      const clientId = uuidv4();
      this.clientSubscriptions.set(ws, new Set());

      console.log(`WebSocket client connected: ${clientId}`);

      ws.on("message", async (message) => {
        try {
          const data = JSON.parse(message);
          await this.handleMessage(ws, clientId, data);
        } catch (error) {
          console.error("WebSocket message handling error:", error);
          this.sendError(ws, error.message);
        }
      });

      ws.on("close", () => {
        this.handleClientDisconnect(ws, clientId);
      });
    });
  }

  handleClientDisconnect(ws, clientId) {
    console.log(`Client ${clientId} disconnected`);
    const subscriptions = this.clientSubscriptions.get(ws) || new Set();

    // Clean up all subscriptions for this client
    for (const subId of subscriptions) {
      const sub = this.subscriptions.get(subId);
      if (sub) {
        clearInterval(sub.intervalId);
        this.subscriptions.delete(subId);
      }
    }

    this.clientSubscriptions.delete(ws);
  }

  async handleMessage(ws, clientId, data) {
    switch (data.type) {
      case "subscribe":
        await this.handleSubscribe(ws, clientId, data);
        break;

      case "unsubscribe":
        await this.handleUnsubscribe(ws, data.subscriptionId);
        break;

      default:
        this.sendError(ws, "Unknown message type");
    }
  }

  async handleSubscribe(ws, clientId, data) {
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
    } = data;

    const subscriptionId = uuidv4();

    try {
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

      const parameters = this.extractParameters(filters, having);

      // Store subscription and start polling
      const intervalId = setInterval(async () => {
        try {
          const results = await this.clientSqlHelper.executeRead(
            query,
            parameters
          );

          if (ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: "data",
                subscriptionId,
                data: results,
              })
            );
          }
        } catch (error) {
          console.error("Subscription query error:", error);
          this.sendError(ws, error.message, subscriptionId);
        }
      }, interval);

      // Store subscription details
      this.subscriptions.set(subscriptionId, {
        intervalId,
        query,
        parameters,
        clientId,
      });

      // Add to client's subscriptions
      this.clientSubscriptions.get(ws).add(subscriptionId);

      // Send success response
      ws.send(
        JSON.stringify({
          type: "subscribed",
          subscriptionId,
        })
      );

      // Send initial data immediately
      const initialResults = await this.clientSqlHelper.executeRead(
        query,
        parameters
      );
      ws.send(
        JSON.stringify({
          type: "data",
          subscriptionId,
          data: initialResults,
        })
      );
    } catch (error) {
      console.error("Subscription error:", error);
      this.sendError(ws, error.message);
    }
  }

  async handleUnsubscribe(ws, subscriptionId) {
    const subscription = this.subscriptions.get(subscriptionId);
    if (subscription) {
      clearInterval(subscription.intervalId);
      this.subscriptions.delete(subscriptionId);
      this.clientSubscriptions.get(ws)?.delete(subscriptionId);

      ws.send(
        JSON.stringify({
          type: "unsubscribed",
          subscriptionId,
        })
      );
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
    return this.clientSqlHelper.convertQueryParameters(
      this.clientSqlHelper._buildQueryWithModifiers({
        tableName,
        columns,
        filters,
        groupBy,
        having,
        orderBy,
        limit,
        offset,
      })
    );
  }

  extractParameters(filters, having) {
    const params = [];

    if (filters) {
      params.push(...filters.flatMap((f) => f.getParameters()));
    }
    if (having) {
      params.push(...having.flatMap((h) => h.getParameters()));
    }

    return params;
  }

  sendError(ws, error, subscriptionId = null) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: "error",
          error,
          subscriptionId,
        })
      );
    }
  }
}

module.exports = WebSocketHandler;
