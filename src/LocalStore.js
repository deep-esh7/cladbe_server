// LocalStore.js
const cluster = require("cluster");
const EventEmitter = require("events");

class LocalStore extends EventEmitter {
  constructor() {
    super();
    this._store = new Map();
    this._ttlStore = new Map();
    this._workerId = process.pid;
    this._setupIPC();
  }

  _setupIPC() {
    if (!cluster.isMaster) {
      process.on("message", (message) => {
        if (message.type === "store_update") {
          const { key, value, ttl, workerId, operation } = message.data;
          if (workerId !== this._workerId) {
            if (operation === "delete") {
              this._handleDelete(key);
            } else {
              this._handleSet(key, value, ttl);
            }
          }
        }
      });
    }
  }

  _handleSet(key, value, ttl) {
    this._store.set(key, value);
    if (ttl) {
      const existingTimeout = this._ttlStore.get(key);
      if (existingTimeout) {
        clearTimeout(existingTimeout);
      }
      const timeout = setTimeout(() => this.del(key), ttl * 1000);
      this._ttlStore.set(key, timeout);
    }
    this.emit("update", { key, value, source: "ipc" });
  }

  _handleDelete(key) {
    const timeout = this._ttlStore.get(key);
    if (timeout) {
      clearTimeout(timeout);
      this._ttlStore.delete(key);
    }
    this._store.delete(key);
    this.emit("delete", { key, source: "ipc" });
  }

  _broadcastUpdate(key, value, ttl, operation = "set") {
    if (!cluster.isMaster && process.send) {
      process.send({
        type: "store_update",
        data: {
          key,
          value,
          ttl,
          operation,
          workerId: this._workerId,
        },
      });
    }
  }

  async set(key, value, options = {}) {
    try {
      const { ttl } = options;
      this._handleSet(key, value, ttl);
      this._broadcastUpdate(key, value, ttl);
      this.emit("update", { key, value, source: "local" });
      return true;
    } catch (error) {
      console.error("Error setting value:", error);
      return false;
    }
  }

  get(key) {
    return this._store.get(key) || null;
  }

  has(key) {
    return this._store.has(key);
  }

  async del(key) {
    try {
      this._handleDelete(key);
      this._broadcastUpdate(key, null, null, "delete");
      this.emit("delete", { key, source: "local" });
      return true;
    } catch (error) {
      console.error("Error deleting value:", error);
      return false;
    }
  }

  keys() {
    return Array.from(this._store.keys());
  }

  values() {
    return Array.from(this._store.values());
  }

  entries() {
    return Array.from(this._store.entries());
  }

  size() {
    return this._store.size;
  }

  clear() {
    const keys = this.keys();
    keys.forEach((key) => this.del(key));
  }

  getSnapshot() {
    const snapshot = {};
    for (const [key, value] of this._store.entries()) {
      snapshot[key] = value;
    }
    return snapshot;
  }

  cleanup() {
    // Clean up any expired TTL entries
    const now = Date.now();
    for (const [key, timeout] of this._ttlStore.entries()) {
      if (timeout._idleStart + timeout._idleTimeout < now) {
        this.del(key);
      }
    }
  }
}

module.exports = LocalStore;
