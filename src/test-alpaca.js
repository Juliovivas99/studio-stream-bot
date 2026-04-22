import { createLogger } from "./utils/logger.js";
import { config, alpacaStreamUrl } from "./config.js";
import { AlpacaMarketDataSocket } from "./alpaca/socket.js";
import { formatTrade, formatQuote, formatBar } from "./alpaca/formatters.js";

const logger = createLogger({ level: process.env.LOG_LEVEL || "info", name: "alpaca-test" });

function createBatcher({ flushIntervalMs, logger, onFlush }) {
  let timer = null;
  const latest = {
    trades: new Map(),
    quotes: new Map(),
    bars: new Map(),
  };

  function start() {
    if (timer) return;
    timer = setInterval(() => flush(), flushIntervalMs);
    timer.unref?.();
    logger.info("Batcher started", { flushIntervalMs });
  }

  function stop() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
    logger.info("Batcher stopped");
  }

  function pushTrade(t) {
    if (t?.S) latest.trades.set(t.S, t);
  }
  function pushQuote(q) {
    if (q?.S) latest.quotes.set(q.S, q);
  }
  function pushBar(b) {
    if (b?.S) latest.bars.set(b.S, b);
  }

  function flush() {
    const lines = [];
    for (const t of latest.trades.values()) lines.push(formatTrade(t));
    for (const q of latest.quotes.values()) lines.push(formatQuote(q));
    for (const b of latest.bars.values()) lines.push(formatBar(b));

    latest.trades.clear();
    latest.quotes.clear();
    latest.bars.clear();

    if (lines.length === 0) return;
    onFlush(lines);
  }

  return { start, stop, flush, pushTrade, pushQuote, pushBar };
}

async function main() {
  const streamUrl = alpacaStreamUrl({ version: config.alpaca.version, feed: config.alpaca.feed });
  logger.info("Starting Alpaca stream test (no Discord)", {
    alpacaFeed: config.alpaca.feed,
    alpacaUrl: streamUrl,
    symbols: config.alpaca.symbols,
  });

  const batcher = createBatcher({
    flushIntervalMs: config.batching.flushIntervalMs,
    logger,
    onFlush: (lines) => {
      logger.info("Batch flush", { lines: lines.length });
      for (const line of lines) console.log(line);
    },
  });
  batcher.start();

  const alpaca = new AlpacaMarketDataSocket({
    url: streamUrl,
    key: config.alpaca.key,
    secret: config.alpaca.secret,
    symbols: config.alpaca.symbols,
    logger,
  });

  alpaca.on("authenticated", () => logger.info("Alpaca authenticated"));
  alpaca.on("subscribed", () => logger.info("Alpaca subscribed"));
  alpaca.on("alpaca_error", (e) => {
    logger.error("Alpaca stream error", e);
    // For testing, fail fast on connection-limit errors to avoid an endless reconnect loop.
    if (e?.code === 406) {
      logger.error(
        "Alpaca rejected the connection (406). Another Market Data WS session is likely active for this key. Stopping."
      );
      alpaca.close();
      process.exit(1);
    }
  });

  alpaca.on("trade", (t) => batcher.pushTrade(t));
  alpaca.on("quote", (q) => batcher.pushQuote(q));
  alpaca.on("bar", (b) => batcher.pushBar(b));

  alpaca.connect();

  const shutdown = (signal) => {
    logger.warn("Shutting down", { signal });
    batcher.stop();
    batcher.flush();
    alpaca.close();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.error("Fatal error", { err: String(err) });
  process.exit(1);
});

