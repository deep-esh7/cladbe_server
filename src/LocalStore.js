// LocalStore.js
const cluster = require("cluster");
const EventEmitter = require("events");

class LocalStore extends EventEmitter {
  constructor(db) {
    super();
    this._store = new Map();
    this._db = db;
    this._prefix = "localstore:";
    this._workerId = process.pid;
    this._setupIPC();
    this._setupTableIfNeeded();
  }

  async _setupTableIfNeeded() {
    try {
      await this._db.query(`
        CREATE TABLE IF NOT EXISTS local_store_data (
          key TEXT PRIMARY KEY,
          value JSONB,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          worker_id TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_local_store_updated 
        ON local_store_data(updated_at);
      `);
    } catch (error) {
      console.error("Error setting up local store table:", error);
    }
  }

  _setupIPC() {
    if (!cluster.isMaster) {
      process.on("message", (message) => {
        if (message.type === "store_update") {
          const { key, value, workerId } = message.data;
          if (workerId !== this._workerId) {
            this._store.set(key, value);
            this.emit("update", { key, value, source: "ipc" });
          }
        }
      });
    }
  }

  _broadcastUpdate(key, value) {
    if (!cluster.isMaster && process.send) {
      process.send({
        type: "store_update",
        data: {
          key,
          value,
          workerId: this._workerId,
        },
      });
    }
  }

  async set(key, value, options = {}) {
    const fullKey = this._prefix + key;
    const { ttl } = options;

    try {
      this._store.set(key, value);

      await this._db.query(
        `INSERT INTO local_store_data (key, value, worker_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (key) 
         DO UPDATE SET 
           value = $2,
           updated_at = CURRENT_TIMESTAMP,
           worker_id = $3`,
        [fullKey, JSON.stringify(value), this._workerId]
      );

      this._broadcastUpdate(key, value);

      if (ttl) {
        setTimeout(() => this.del(key), ttl * 1000);
      }

      this.emit("update", { key, value, source: "local" });
      return true;
    } catch (error) {
      console.error("Error setting value:", error);
      return false;
    }
  }

  async get(key) {
    if (this._store.has(key)) {
      return this._store.get(key);
    }

    try {
      const fullKey = this._prefix + key;
      const result = await this._db.query(
        "SELECT value FROM local_store_data WHERE key = $1",
        [fullKey]
      );

      if (result.rows.length > 0) {
        const value = result.rows[0].value;
        this._store.set(key, value);
        return value;
      }
    } catch (error) {
      console.error("Error getting value:", error);
    }

    return null;
  }

  async del(key) {
    const fullKey = this._prefix + key;
    try {
      this._store.delete(key);
      await this._db.query("DELETE FROM local_store_data WHERE key = $1", [
        fullKey,
      ]);
      this._broadcastUpdate(key, null);
      this.emit("delete", { key, source: "local" });
      return true;
    } catch (error) {
      console.error("Error deleting value:", error);
      return false;
    }
  }

  async getAll(pattern = "*") {
    try {
      const result = await this._db.query(
        `SELECT key, value FROM local_store_data 
         WHERE key LIKE $1`,
        [this._prefix + pattern.replace("*", "%")]
      );

      return result.rows.reduce((acc, row) => {
        const key = row.key.replace(this._prefix, "");
        acc[key] = row.value;
        return acc;
      }, {});
    } catch (error) {
      console.error("Error getting all values:", error);
      return {};
    }
  }

  async cleanup(maxAge = 3600) {
    try {
      const result = await this._db.query(
        `DELETE FROM local_store_data 
         WHERE updated_at < NOW() - INTERVAL '1 second' * $1
         RETURNING key`,
        [maxAge]
      );

      result.rows.forEach((row) => {
        const key = row.key.replace(this._prefix, "");
        this._store.delete(key);
      });

      return result.rowCount;
    } catch (error) {
      console.error("Error during cleanup:", error);
      return 0;
    }
  }
}

module.exports = LocalStore;
