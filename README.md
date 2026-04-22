# Alpaca Market Data → Discord DM Alert Bot

Production-ready Discord bot (Node.js + ES modules) that connects to Alpaca’s stock Market Data WebSocket stream and lets users create **price alerts by DM** (ticker + price).

## Features
- Discord.js v14 client
- Raw WebSocket client (`ws`) to Alpaca Market Data stream
- Auth + subscribe (trades / quotes / bars)
- Exponential backoff reconnect (re-auth + re-subscribe after reconnect)
- **DM alerts**: users DM `AAPL 250`, `TSLA >= 400`, `NVDA <= 180`
- **Alert persistence**: survives restarts via JSON file with atomic writes
- Dynamic Alpaca watchlist driven by active alerts (subscribe/unsubscribe; reconnect-safe)
- Optional channel relay: batched posting every ~7 seconds

## File structure
- `src/index.js`: app wiring (Discord + Alpaca + alerts + optional relay)
- `src/config.js`: env config + stream URL builder
- `src/discord/client.js`: Discord login + channel fetch
- `src/discord/handlers/dmAlerts.js`: DM message handler (create/list/cancel/help) + DM sender
- `src/alpaca/socket.js`: Alpaca WebSocket client with reconnect/auth/subscribe
- `src/alpaca/formatters.js`: trade/quote/bar formatters
- `src/alerts/store.js`: JSON persistence store (swap-friendly interface)
- `src/alerts/parser.js`: DM text parser → intent
- `src/alerts/engine.js`: latest price cache + trigger evaluation
- `src/utils/logger.js`: structured JSON logger

## Setup (exact commands)

```bash
cd /Users/juliovivas/exitLiquidity3
npm install
cp .env.example .env
```

Edit `.env` and set:
- `DISCORD_BOT_TOKEN`
- `ALPACA_API_KEY`
- `ALPACA_API_SECRET`
- `ALPACA_FEED` (default `iex`)

Optional:
- `DISCORD_CHANNEL_ID` (enables the legacy “relay ticks to channel” feature)
- `SYMBOLS=AAPL,TSLA,NVDA`
- `BATCH_FLUSH_INTERVAL_MS=7000`
- `ALERTS_DB_PATH=data/alerts.json`
- `ALERT_DEFAULT_OP=>=`
- `LOG_LEVEL=info`

## Run (exact command)

```bash
npm start
```

## DM usage
DM the bot:
- Create alert:
  - `AAPL 250` (defaults to `>=`)
  - `TSLA >= 400`
  - `NVDA <= 180`
- Manage:
  - `list`
  - `cancel <id>`
  - `help`

When an alert triggers, you’ll receive a **single** DM with the symbol, trigger price, last price, and timestamp.

## Optional: use a dedicated server channel for commands
By default, the bot listens **only in DMs**. To also accept `help`, `list`, `cancel <id>`, and alert creation messages in your dedicated server channel:
- Set `DISCORD_CHANNEL_ID` to that channel’s ID
- Set `ALERTS_ALLOW_GUILD_MESSAGES=true`

Operational note: if the bot cannot DM a user (privacy settings), it logs a clear error. If `DISCORD_CHANNEL_ID` is set, it will also post a short notice in that channel.

## Slash commands (type `/` to see the menu)
To enable slash commands, invite the bot with the `applications.commands` scope (recommended) and optionally set:
- `DISCORD_GUILD_ID` for **instant** registration in one server (dev)

Commands:
- `/alert symbol:AAPL op:>= price:250`
- `/alerts list`
- `/alerts cancel id:abcdef12`

## How it works (short)
- On startup, the bot logs into Discord (required for DM alerts). If `DISCORD_CHANNEL_ID` is set, it also fetches that channel for optional relay messages.
- It opens a WebSocket to `wss://stream.data.alpaca.markets/v2/<feed>`, authenticates with `{"action":"auth","key":"...","secret":"..."}`.
- Active alerts determine the **watchlist** (unique set of symbols). The bot subscribes only to that list.\n+- Incoming ticks update the latest price per symbol (trade preferred; else quote mid) and the engine checks active alerts.\n+- If the socket drops, the bot reconnects with exponential backoff and re-authenticates and re-syncs subscriptions automatically.

## Next steps
- **Slash commands**: move `parseDmIntent()` logic into a shared command handler; add `src/discord/commands/*` and register on startup.\n+- **`/watch SYMBOL` migration**: store per-user watchlists and reuse the same dynamic `setDesiredSymbols()/syncSubscriptions()` flow.\n+- **Storage upgrade**: implement the same store interface backed by Redis/Postgres (drop-in replacement for `JsonFileAlertStore`).

