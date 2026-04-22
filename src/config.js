import "dotenv/config";

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function optional(name, fallback) {
  const v = process.env[name];
  return v == null || v === "" ? fallback : v;
}

function parseSymbols(raw) {
  if (!raw) return ["AAPL", "TSLA", "NVDA"];
  return raw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

export const config = {
  discord: {
    // Optional here so `src/test-alpaca.js` can run without Discord env vars.
    // `src/index.js` will validate these at runtime before using Discord.
    token: process.env.DISCORD_BOT_TOKEN || "",
    channelId: process.env.DISCORD_CHANNEL_ID || "",
    guildId: process.env.DISCORD_GUILD_ID || "",
  },
  alerts: {
    dbPath: optional("ALERTS_DB_PATH", "data/alerts.json"),
    defaultOp: optional("ALERT_DEFAULT_OP", ">="),
    allowGuildMessages: optional("ALERTS_ALLOW_GUILD_MESSAGES", "false") === "true",
  },
  alpaca: {
    key: required("ALPACA_API_KEY"),
    secret: required("ALPACA_API_SECRET"),
    version: "v2",
    feed: optional("ALPACA_FEED", "iex"),
    symbols: parseSymbols(process.env.SYMBOLS),
  },
  batching: {
    // Discord-friendly throttle: one message every ~7s by default.
    flushIntervalMs: Number(optional("BATCH_FLUSH_INTERVAL_MS", "7000")),
    // Safety: don't let a single message exceed Discord 2000 char limit.
    maxDiscordMessageChars: 1900,
  },
};

export function requireDiscordConfig() {
  return {
    token: required("DISCORD_BOT_TOKEN"),
    // Channel relay is optional; leave empty to disable.
    channelId: process.env.DISCORD_CHANNEL_ID || "",
  };
}

export function alpacaStreamUrl({ version, feed }) {
  return `wss://stream.data.alpaca.markets/${version}/${feed}`;
}

