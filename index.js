const net = require("net");
const crypto = require("crypto");

const EOM = Buffer.from([0x04]);
const DELIMITER = "\x1E";
const EOM_BYTE = 0x04;

class ONQLClient {
  /**
   * @param {object} [options]
   * @param {number} [options.defaultTimeout=10] - Default timeout in seconds for requests.
   */
  constructor(options = {}) {
    this._socket = null;
    this._buffer = Buffer.alloc(0);
    this._pendingRequests = new Map();
    this._subscriptions = new Map();
    this._defaultTimeout = (options.defaultTimeout != null ? options.defaultTimeout : 10);
    this._connected = false;
  }

  /**
   * Create and connect an ONQLClient.
   * @param {object} [options]
   * @param {string} [options.host="localhost"]
   * @param {number} [options.port=5656]
   * @param {number} [options.defaultTimeout=10] - Default timeout in seconds.
   * @returns {Promise<ONQLClient>}
   */
  static create(options = {}) {
    const host = options.host || "localhost";
    const port = options.port || 5656;
    const defaultTimeout = options.defaultTimeout != null ? options.defaultTimeout : 10;

    const client = new ONQLClient({ defaultTimeout });

    return new Promise((resolve, reject) => {
      const socket = new net.Socket();
      client._socket = socket;

      socket.connect(port, host, () => {
        client._connected = true;
        resolve(client);
      });

      socket.on("data", (data) => {
        client._onData(data);
      });

      socket.on("error", (err) => {
        if (!client._connected) {
          reject(err);
          return;
        }
        client._onClose();
      });

      socket.on("close", () => {
        client._onClose();
      });
    });
  }

  /**
   * Handle incoming data from the socket. Buffer it and extract complete
   * messages delimited by EOM (0x04).
   * @param {Buffer} data
   */
  _onData(data) {
    this._buffer = Buffer.concat([this._buffer, data]);

    let eomIndex;
    while ((eomIndex = this._buffer.indexOf(EOM_BYTE)) !== -1) {
      const messageBytes = this._buffer.slice(0, eomIndex);
      this._buffer = this._buffer.slice(eomIndex + 1);

      const fullResponse = messageBytes.toString("utf-8");
      const parts = fullResponse.split(DELIMITER);

      if (parts.length !== 3) {
        continue;
      }

      const [responseRid, sourceId, responsePayload] = parts;

      // Check subscriptions first
      const cb = this._subscriptions.get(responseRid);
      if (cb) {
        this._dispatchSubscription(responseRid, sourceId, responsePayload);
        continue;
      }

      // Check pending requests
      const pending = this._pendingRequests.get(responseRid);
      if (pending) {
        pending.resolve({
          request_id: responseRid,
          source: sourceId,
          payload: responsePayload,
        });
      }
    }
  }

  /**
   * Handle socket close / error: reject all pending requests.
   */
  _onClose() {
    this._connected = false;
    for (const [rid, pending] of this._pendingRequests) {
      pending.reject(new Error("Connection lost."));
    }
    this._pendingRequests.clear();
  }

  /**
   * Close the connection.
   * @returns {Promise<void>}
   */
  close() {
    return new Promise((resolve) => {
      this._pendingRequests.clear();
      if (this._socket) {
        this._connected = false;
        this._socket.destroy();
        this._socket = null;
      }
      resolve();
    });
  }

  /**
   * Generate a random 8-character hex request ID.
   * @returns {string}
   */
  _generateRequestId() {
    return crypto.randomBytes(4).toString("hex");
  }

  /**
   * Send a request and wait for a response.
   * @param {string} keyword
   * @param {string} payload
   * @param {number} [timeout] - Timeout in seconds. Defaults to defaultTimeout.
   * @returns {Promise<{request_id: string, source: string, payload: string}>}
   */
  sendRequest(keyword, payload, timeout) {
    if (timeout == null) {
      timeout = this._defaultTimeout;
    }

    if (!this._socket || !this._connected) {
      return Promise.reject(new Error("Client is not connected."));
    }

    const requestId = this._generateRequestId();
    const message = Buffer.concat([
      Buffer.from(`${requestId}${DELIMITER}${keyword}${DELIMITER}${payload}`, "utf-8"),
      EOM,
    ]);

    return new Promise((resolve, reject) => {
      let timer = null;

      const cleanup = () => {
        this._pendingRequests.delete(requestId);
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
      };

      this._pendingRequests.set(requestId, {
        resolve: (value) => {
          cleanup();
          resolve(value);
        },
        reject: (err) => {
          cleanup();
          reject(err);
        },
      });

      if (timeout > 0) {
        timer = setTimeout(() => {
          const pending = this._pendingRequests.get(requestId);
          if (pending) {
            cleanup();
            reject(new Error("Request timed out."));
          }
        }, timeout * 1000);
      }

      this._socket.write(message, (err) => {
        if (err) {
          cleanup();
          reject(err);
        }
      });
    });
  }

  /**
   * Subscribe to streaming responses.
   * @param {string} onquery - The onquery identifier.
   * @param {string} query - The query string.
   * @param {function(string, string, string): void} callback - Called with (rid, source, payload).
   * @returns {Promise<string>} The subscription request ID.
   */
  subscribe(onquery, query, callback) {
    if (!this._socket || !this._connected) {
      return Promise.reject(new Error("Client is not connected."));
    }

    const rid = this._generateRequestId();
    this._subscriptions.set(rid, callback);

    const payload = JSON.stringify({ onquery, query });
    const frame = Buffer.concat([
      Buffer.from(`${rid}${DELIMITER}subscribe${DELIMITER}${payload}`, "utf-8"),
      EOM,
    ]);

    return new Promise((resolve, reject) => {
      this._socket.write(frame, (err) => {
        if (err) {
          this._subscriptions.delete(rid);
          reject(err);
          return;
        }
        resolve(rid);
      });
    });
  }

  /**
   * Unsubscribe from a previous subscription.
   * @param {string} rid - The subscription request ID to cancel.
   * @returns {Promise<void>}
   */
  unsubscribe(rid) {
    this._subscriptions.delete(rid);

    if (!this._socket || !this._connected) {
      return Promise.resolve();
    }

    const payload = JSON.stringify({ rid });
    const frame = Buffer.concat([
      Buffer.from(`${rid}${DELIMITER}unsubscribe${DELIMITER}${payload}`, "utf-8"),
      EOM,
    ]);

    return new Promise((resolve) => {
      this._socket.write(frame, () => {
        resolve();
      });
    });
  }

  /**
   * Dispatch a subscription callback. If the callback returns a promise,
   * it is left to settle on its own (fire-and-forget), matching the Python
   * driver's asyncio.create_task behavior.
   * @param {string} rid
   * @param {string} keyword
   * @param {string} payload
   */
  _dispatchSubscription(rid, keyword, payload) {
    const cb = this._subscriptions.get(rid);
    if (!cb) {
      return;
    }
    try {
      cb(rid, keyword, payload);
    } catch (_) {
      // Silently ignore callback errors, matching Python driver behavior.
    }
  }

  // ------------------------------------------------------------------
  // Direct ORM-style API (insert / update / delete / onql / build)
  // ------------------------------------------------------------------

  /**
   * Set the default database name used by insert / update / delete / onql.
   * Returns `this` so calls can be chained.
   * @param {string} db
   * @returns {ONQLClient}
   */
  setup(db) {
    this._db = db;
    return this;
  }

  /**
   * Parse the standard `{error, data}` envelope returned by the server.
   * Throws when `error` is truthy; otherwise returns `data`.
   * @param {string} raw
   * @returns {any}
   */
  _processResult(raw) {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (_) {
      throw new Error(String(raw));
    }
    if (parsed && parsed.error) {
      throw new Error(parsed.error);
    }
    return parsed ? parsed.data : undefined;
  }

  /**
   * Insert one or more records into a table.
   * @param {string} table
   * @param {object|object[]} data - Record or array of records.
   * @returns {Promise<any>} Parsed `data` from the server envelope.
   */
  async insert(table, data) {
    const payload = JSON.stringify({
      db: this._db,
      table: table,
      records: data,
    });
    const res = await this.sendRequest("insert", payload);
    return this._processResult(res.payload);
  }

  /**
   * Update records matching `query`.
   * @param {string} table
   * @param {object} data - Fields to update.
   * @param {object|string} query - Match query.
   * @param {object} [opts]
   * @param {string} [opts.protopass="default"]
   * @param {string[]} [opts.ids=[]]
   * @returns {Promise<any>}
   */
  async update(table, data, query, opts = {}) {
    const payload = JSON.stringify({
      db: this._db,
      table: table,
      records: data,
      query: query,
      protopass: opts.protopass || "default",
      ids: opts.ids || [],
    });
    const res = await this.sendRequest("update", payload);
    return this._processResult(res.payload);
  }

  /**
   * Delete records matching `query`.
   * @param {string} table
   * @param {object|string} query
   * @param {object} [opts]
   * @param {string} [opts.protopass="default"]
   * @param {string[]} [opts.ids=[]]
   * @returns {Promise<any>}
   */
  async delete(table, query, opts = {}) {
    const payload = JSON.stringify({
      db: this._db,
      table: table,
      query: query,
      protopass: opts.protopass || "default",
      ids: opts.ids || [],
    });
    const res = await this.sendRequest("delete", payload);
    return this._processResult(res.payload);
  }

  /**
   * Execute a raw ONQL query.
   * @param {string} query
   * @param {object} [opts]
   * @param {string} [opts.protopass="default"]
   * @param {string} [opts.ctxkey=""]
   * @param {string[]} [opts.ctxvalues=[]]
   * @returns {Promise<any>} Parsed `data` from the server envelope.
   */
  async onql(query, opts = {}) {
    const payload = JSON.stringify({
      query: query,
      protopass: opts.protopass || "default",
      ctxkey: opts.ctxkey || "",
      ctxvalues: opts.ctxvalues || [],
    });
    const res = await this.sendRequest("onql", payload);
    return this._processResult(res.payload);
  }

  /**
   * Replace `$1`, `$2`, ... placeholders in `query` with the supplied values.
   * Strings are double-quoted, numbers and booleans are inlined verbatim.
   * @param {string} query
   * @param  {...any} values
   * @returns {string}
   */
  build(query, ...values) {
    values.forEach((value, i) => {
      const placeholder = "$" + (i + 1);
      let replacement;
      if (typeof value === "string") {
        replacement = '"' + value + '"';
      } else if (typeof value === "boolean" || typeof value === "number") {
        replacement = String(value);
      } else {
        replacement = String(value);
      }
      query = query.split(placeholder).join(replacement);
    });
    return query;
  }
}

module.exports = { ONQLClient };
