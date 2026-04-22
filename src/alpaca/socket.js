import { EventEmitter } from "node:events";
import WebSocket from "ws";

function normalizeSymbol(symbol) {
  return String(symbol || "")
    .trim()
    .toUpperCase();
}

export class AlpacaMarketDataSocket extends EventEmitter {
  constructor({
    url,
    key,
    secret,
    symbols,
    logger,
    backoff = { minMs: 1000, maxMs: 30000, factor: 2, jitter: 0.2 },
  }) {
    super();
    this.url = url;
    this.key = key;
    this.secret = secret;
    this.symbols = symbols;
    this.logger = logger;
    this.backoff = backoff;

    this.ws = null;
    this._manualClose = false;
    this._reconnectAttempt = 0;
    this._reconnectTimer = null;

    this._authenticated = false;
    this._subscribed = false;

    this._lastAlpacaErrorCode = null;

    // Dynamic subscription state
    this._desiredSymbols = new Set((symbols || []).map(normalizeSymbol).filter(Boolean));
    this._subscribedSymbols = new Set();
  }

  connect() {
    this._manualClose = false;
    this._clearReconnectTimer();

    // Avoid duplicate sockets.
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this._authenticated = false;
    this._subscribed = false;
    this._subscribedSymbols.clear();

    this.logger.info("Connecting to Alpaca WebSocket", { url: this.url });
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.on("open", () => {
      this.logger.info("Alpaca WebSocket connected");
      this._sendAuth();
      this.emit("connected");
    });

    ws.on("message", (data) => this._handleMessage(data));

    ws.on("close", (code, reason) => {
      const reasonStr = reason ? reason.toString() : "";
      this.logger.warn("Alpaca WebSocket closed", { code, reason: reasonStr });
      this.emit("disconnected", { code, reason: reasonStr });
      this.ws = null;
      this._authenticated = false;
      this._subscribed = false;
      if (!this._manualClose) this._scheduleReconnect();
    });

    ws.on("error", (err) => {
      // 'error' often precedes 'close'; log and let reconnect happen on close.
      this.logger.error("Alpaca WebSocket error", { err: String(err) });
      this.emit("error", err);
    });
  }

  close() {
    this._manualClose = true;
    this._clearReconnectTimer();
    if (this.ws) {
      try {
        this.ws.close();
      } catch (e) {
        // Ignore; we're shutting down.
      }
    }
    this.ws = null;
  }

  _sendJson(obj) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    try {
      this.ws.send(JSON.stringify(obj));
      return true;
    } catch (err) {
      this.logger.error("Failed to send websocket message", { err: String(err) });
      return false;
    }
  }

  _sendAuth() {
    this.logger.info("Authenticating with Alpaca");
    this._sendJson({ action: "auth", key: this.key, secret: this.secret });
  }

  setDesiredSymbols(symbols) {
    const next = new Set((symbols || []).map(normalizeSymbol).filter(Boolean));
    this._desiredSymbols = next;
  }

  getDesiredSymbols() {
    return Array.from(this._desiredSymbols.values());
  }

  syncSubscriptions() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (!this._authenticated) return;

    const desired = this._desiredSymbols;
    const subscribed = this._subscribedSymbols;

    const toSub = [];
    const toUnsub = [];

    for (const sym of desired) {
      if (!subscribed.has(sym)) toSub.push(sym);
    }
    for (const sym of subscribed) {
      if (!desired.has(sym)) toUnsub.push(sym);
    }

    if (toSub.length === 0 && toUnsub.length === 0) return;

    if (toSub.length > 0) {
      this.logger.info("Subscribing to Alpaca streams", { symbols: toSub });
      const ok = this._sendJson({
        action: "subscribe",
        trades: toSub,
        quotes: toSub,
        bars: toSub,
      });
      if (ok) for (const s of toSub) subscribed.add(s);
    }

    if (toUnsub.length > 0) {
      this.logger.info("Unsubscribing from Alpaca streams", { symbols: toUnsub });
      const ok = this._sendJson({
        action: "unsubscribe",
        trades: toUnsub,
        quotes: toUnsub,
        bars: toUnsub,
      });
      if (ok) for (const s of toUnsub) subscribed.delete(s);
    }
  }

  _sendSubscribe() {
    if (this._subscribed) return;
    // Backwards-compatible initial subscribe; now uses desiredSymbols and diffs.
    this.syncSubscriptions();
    this._subscribed = true;
  }

  _handleMessage(data) {
    const raw = Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      this.logger.warn("Malformed JSON from Alpaca", { raw: raw.slice(0, 500) });
      return;
    }

    const messages = Array.isArray(parsed) ? parsed : [parsed];
    for (const msg of messages) this._handleOne(msg);
  }

  _handleOne(msg) {
    if (!msg || typeof msg !== "object") return;

    // Lifecycle / status messages
    if (msg.T === "success") {
      const m = msg.msg || "";
      this.logger.info("Alpaca success", { msg: m });
      if (m === "authenticated") {
        // Only reset reconnect backoff once we've truly established a valid session.
        this._reconnectAttempt = 0;
        this._lastAlpacaErrorCode = null;
        this._authenticated = true;
        this.emit("authenticated");
        // On reconnect, always resubscribe from desired list (without duplicates).
        this._subscribedSymbols.clear();
        this._sendSubscribe();
      }
      if (m === "connected") {
        // On some connections Alpaca sends "connected" first; auth will follow.
      }
      if (m.startsWith("subscribed")) {
        this.emit("subscribed", msg);
      }
      return;
    }

    if (msg.T === "error") {
      this.logger.error("Alpaca error", { code: msg.code, msg: msg.msg });
      this._lastAlpacaErrorCode = msg.code ?? null;
      this.emit("alpaca_error", msg);

      // If Alpaca says we're over the connection limit, backing off aggressively
      // is better than hammering reconnects.
      if (msg.code === 406 && this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.close();
        } catch {
          // ignore
        }
      }
      return;
    }

    // Market data
    // Trades: T='t', Quotes: T='q', Bars: T='b' (stocks)
    if (msg.T === "t") this.emit("trade", msg);
    else if (msg.T === "q") this.emit("quote", msg);
    else if (msg.T === "b") this.emit("bar", msg);
    else {
      // Unknown message type; keep this at debug to avoid noise.
      this.logger.debug("Unhandled Alpaca message type", { T: msg.T });
    }
  }

  _scheduleReconnect() {
    this._clearReconnectTimer();

    const { minMs, maxMs, factor, jitter } = this.backoff;
    const attempt = this._reconnectAttempt++;
    let base = Math.min(maxMs, minMs * Math.pow(factor, attempt));

    // Connection limit exceeded: wait longer so the previous session can clear.
    if (this._lastAlpacaErrorCode === 406) {
      base = Math.min(maxMs, Math.max(base, 15000));
    }
    const rand = 1 + (Math.random() * 2 - 1) * jitter; // +/- jitter
    const delay = Math.max(minMs, Math.floor(base * rand));

    this.logger.warn("Reconnecting to Alpaca WebSocket", { attempt: attempt + 1, delayMs: delay });
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this.connect();
    }, delay);
  }

  _clearReconnectTimer() {
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    this._reconnectTimer = null;
  }
}

