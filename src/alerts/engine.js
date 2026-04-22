function nowIso() {
  return new Date().toISOString();
}

function normalizeSymbol(symbol) {
  return String(symbol || "")
    .trim()
    .toUpperCase();
}

function safeNumber(n) {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return null;
  return v;
}

function evalOp(op, last, target) {
  if (op === ">=") return last >= target;
  if (op === "<=") return last <= target;
  if (op === ">") return last > target;
  if (op === "<") return last < target;
  if (op === "=") return last === target;
  return false;
}

/**
 * AlertEngine
 * - Keeps latest price (trade preferred; else quote mid when both bid/ask present)
 * - Evaluates active alerts and returns those that should trigger
 */
export class AlertEngine {
  constructor({ logger }) {
    this.logger = logger;

    /** @type {Map<string, { price: number, ts: string, source: 'trade'|'quote_mid' }>} */
    this.latestBySymbol = new Map();
  }

  /**
   * Update latest from an Alpaca trade message (`T='t'`).
   * Trade shape: { S: 'AAPL', p: 212.44, t: '...' }
   */
  updateFromTrade(t) {
    const symbol = normalizeSymbol(t?.S);
    const price = safeNumber(t?.p);
    if (!symbol || price == null) return null;

    const ts = typeof t?.t === "string" && t.t ? t.t : nowIso();
    const next = { price, ts, source: "trade" };
    this.latestBySymbol.set(symbol, next);
    return { symbol, ...next };
  }

  /**
   * Update latest from an Alpaca quote message (`T='q'`).
   * Quote shape: { S: 'AAPL', bp: 100.1, ap: 100.2, t: '...' }
   */
  updateFromQuote(q) {
    const symbol = normalizeSymbol(q?.S);
    const bid = safeNumber(q?.bp);
    const ask = safeNumber(q?.ap);
    if (!symbol || bid == null || ask == null) return null;

    const mid = (bid + ask) / 2;
    const ts = typeof q?.t === "string" && q.t ? q.t : nowIso();

    // Do not overwrite a trade that arrived after this quote.
    const prev = this.latestBySymbol.get(symbol);
    if (prev?.source === "trade") return null;

    const next = { price: mid, ts, source: "quote_mid" };
    this.latestBySymbol.set(symbol, next);
    return { symbol, ...next };
  }

  getLatest(symbol) {
    return this.latestBySymbol.get(normalizeSymbol(symbol)) || null;
  }

  /**
   * Evaluate active alerts for a symbol based on latest price.
   * Returns array of { alert, lastPrice, lastTs } that are newly satisfied.
   */
  evaluateSymbol(symbol, activeAlertsForSymbol) {
    const sym = normalizeSymbol(symbol);
    const latest = this.latestBySymbol.get(sym);
    if (!latest) return [];

    const triggered = [];
    for (const alert of activeAlertsForSymbol) {
      if (!alert || alert.status !== "active") continue;
      if (normalizeSymbol(alert.symbol) !== sym) continue;
      const target = safeNumber(alert.targetPrice);
      if (target == null) continue;

      if (evalOp(alert.op, latest.price, target)) {
        triggered.push({
          alert,
          lastPrice: latest.price,
          lastTs: latest.ts,
          source: latest.source,
        });
      }
    }
    return triggered;
  }
}

