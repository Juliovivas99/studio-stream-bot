import { createLogger } from "./utils/logger.js";
import { config, alpacaStreamUrl, requireDiscordConfig } from "./config.js";
import { createDiscordClient, fetchChannel } from "./discord/client.js";
import { AlpacaMarketDataSocket } from "./alpaca/socket.js";
import { formatTrade, formatQuote, formatBar } from "./alpaca/formatters.js";
import { JsonFileAlertStore } from "./alerts/store.js";
import { AlertEngine } from "./alerts/engine.js";
import { registerDmAlertHandlers } from "./discord/handlers/dmAlerts.js";
import { registerSlashCommandHandlers } from "./discord/handlers/slashCommands.js";
import { registerSlashCommands } from "./discord/commands/register.js";

const logger = createLogger({ level: process.env.LOG_LEVEL || "info", name: "bot" });

function normalizeSymbol(symbol) {
  return String(symbol || "")
    .trim()
    .toUpperCase();
}

function chunkDiscordMessages(lines, maxChars) {
  const chunks = [];
  let current = "";
  for (const line of lines) {
    const next = current ? `${current}\n${line}` : line;
    if (next.length > maxChars) {
      if (current) chunks.push(current);
      // If a single line is too long, hard-truncate it.
      current = line.length > maxChars ? `${line.slice(0, maxChars - 1)}…` : line;
      continue;
    }
    current = next;
  }
  if (current) chunks.push(current);
  return chunks;
}

function createBatcher({ flushIntervalMs, logger, onFlush }) {
  let timer = null;
  const latest = {
    trades: new Map(), // symbol -> trade
    quotes: new Map(), // symbol -> quote
    bars: new Map(), // symbol -> bar
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
  logger.info("Starting bot", {
    alpacaFeed: config.alpaca.feed,
    alpacaUrl: streamUrl,
    symbols: config.alpaca.symbols,
    alertsDbPath: config.alerts.dbPath,
  });

  const discordClient = createDiscordClient({ logger });
  const discordCfg = requireDiscordConfig();
  // Login is required for the DM bot.
  logger.info("Logging into Discord");
  await discordClient.login(discordCfg.token);

  // Register slash commands (guild-scoped if DISCORD_GUILD_ID is set for instant availability).
  // Requires applications.commands scope on the invite URL.
  const appId = discordClient.application?.id || discordClient.user?.id;
  if (appId) {
    await registerSlashCommands({
      token: discordCfg.token,
      appId,
      guildId: config.discord.guildId || "",
      logger,
    });
  } else {
    logger.warn("Could not determine Discord application id; skipping slash command registration");
  }

  // Optional channel relay feature.
  let relayChannel = null;
  if (discordCfg.channelId) {
    relayChannel = await fetchChannel({
      client: discordClient,
      channelId: discordCfg.channelId,
      logger,
    });
  } else {
    logger.info("Discord channel relay disabled (DISCORD_CHANNEL_ID not set)");
  }

  const batcher = createBatcher({
    flushIntervalMs: config.batching.flushIntervalMs,
    logger,
    onFlush: async (lines) => {
      if (!relayChannel) return;
      const chunks = chunkDiscordMessages(lines, config.batching.maxDiscordMessageChars);
      for (const content of chunks) {
        try {
          await relayChannel.send(content);
        } catch (err) {
          logger.error("Failed to send Discord message", { err: String(err) });
        }
      }
    },
  });
  if (relayChannel) batcher.start();

  const store = new JsonFileAlertStore({ filePath: config.alerts.dbPath, logger });
  await store.init();

  const engine = new AlertEngine({ logger });

  const { sendTriggerDm } = registerDmAlertHandlers({
    client: discordClient,
    logger,
    store,
    engine,
    defaultOp: config.alerts.defaultOp,
    allowGuildMessages: config.alerts.allowGuildMessages,
    allowedGuildChannelId: discordCfg.channelId || "",
    onAlertStoreChanged: async () => {
      const symbols = recomputeWatchlist();
      logger.info("Updated watchlist from DM change", { symbols });
    },
    relayChannel,
  });

  registerSlashCommandHandlers({
    client: discordClient,
    logger,
    store,
    engine,
    defaultOp: config.alerts.defaultOp,
    onAlertStoreChanged: async () => {
      const symbols = recomputeWatchlist();
      logger.info("Updated watchlist from slash command change", { symbols });
    },
  });

  const alpaca = new AlpacaMarketDataSocket({
    url: streamUrl,
    key: config.alpaca.key,
    secret: config.alpaca.secret,
    symbols: config.alpaca.symbols,
    logger,
  });

  alpaca.on("connected", () => logger.info("Alpaca connected"));
  alpaca.on("authenticated", () => {
    logger.info("Alpaca authenticated");
    alpaca.syncSubscriptions();
  });
  alpaca.on("subscribed", () => logger.info("Alpaca subscribed"));
  alpaca.on("alpaca_error", (e) => logger.error("Alpaca stream error", e));
  // Important: AlpacaMarketDataSocket emits an `error` event; without a listener, Node will crash.
  alpaca.on("error", (err) => logger.error("Alpaca socket error event", { err: String(err) }));

  function recomputeWatchlist() {
    const active = store.getAllActiveAlerts();
    const symbols = Array.from(new Set(active.map((a) => normalizeSymbol(a.symbol)).filter(Boolean)));
    alpaca.setDesiredSymbols(symbols);
    alpaca.syncSubscriptions();
    return symbols;
  }

  // Initial watchlist comes from persisted alerts.
  const initialWatch = recomputeWatchlist();
  logger.info("Initial alert watchlist", { symbols: initialWatch });

  async function evaluateAndTrigger(symbol) {
    const sym = normalizeSymbol(symbol);
    if (!sym) return;
    const active = store.getAllActiveAlerts().filter((a) => normalizeSymbol(a.symbol) === sym);
    if (active.length === 0) return;

    const triggered = engine.evaluateSymbol(sym, active);
    for (const t of triggered) {
      const a = t.alert;
      // Mark triggered first to avoid any chance of double-send in fast tick bursts.
      const marked = await store.markTriggered(a.id, t.lastTs, t.lastPrice);
      if (!marked.ok) continue;

      await sendTriggerDm({
        userId: a.userId,
        symbol: a.symbol,
        op: a.op,
        targetPrice: a.targetPrice,
        alertId: a.id,
        lastPrice: t.lastPrice,
        ts: t.lastTs,
      });
    }

    if (triggered.length > 0) {
      const symbols = recomputeWatchlist();
      logger.info("Updated watchlist after triggers", { symbols });
    }
  }

  alpaca.on("trade", async (t) => {
    if (relayChannel) batcher.pushTrade(t);
    const upd = engine.updateFromTrade(t);
    if (upd?.symbol) await evaluateAndTrigger(upd.symbol);
  });
  alpaca.on("quote", async (q) => {
    if (relayChannel) batcher.pushQuote(q);
    const upd = engine.updateFromQuote(q);
    if (upd?.symbol) await evaluateAndTrigger(upd.symbol);
  });
  alpaca.on("bar", (b) => {
    if (relayChannel) batcher.pushBar(b);
  });

  alpaca.connect();

  // Graceful shutdown
  const shutdown = async (signal) => {
    logger.warn("Shutting down", { signal });
    batcher.stop();
    batcher.flush();
    alpaca.close();
    try {
      await discordClient.destroy();
    } catch (e) {
      // ignore
    }
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.error("Fatal error", { err: String(err) });
  process.exit(1);
});

