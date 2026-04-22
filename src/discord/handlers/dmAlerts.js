import { parseDmIntent, helpText } from "../../alerts/parser.js";

function money(n) {
  if (typeof n !== "number" || Number.isNaN(n)) return "?";
  return n.toFixed(2);
}

function formatAlertLine(a) {
  const status = a.status || "unknown";
  const base = `\`${a.id}\`  ${a.symbol} ${a.op} $${money(a.targetPrice)}  (${status})`;
  if (status === "triggered" && a.triggeredAt) return `${base} at ${a.triggeredAt}`;
  return base;
}

async function safeReply(message, content, logger) {
  try {
    await message.reply({ content });
  } catch (err) {
    logger?.error?.("Failed to reply to DM", { err: String(err) });
  }
}

export function registerDmAlertHandlers({
  client,
  logger,
  store,
  engine,
  defaultOp,
  onAlertStoreChanged,
  allowGuildMessages = false,
  allowedGuildChannelId = "",
  // Optional: relay failures / operational notices to a channel.
  relayChannel,
}) {
  client.on("messageCreate", async (message) => {
    try {
      if (!message) return;
      if (message.author?.bot) return;

      const isGuild = Boolean(message.guild);
      if (isGuild) {
        if (!allowGuildMessages) return;
        if (allowedGuildChannelId && message.channel?.id !== allowedGuildChannelId) return;
      }

      const intent = parseDmIntent(message.content, { defaultOp });
      if (intent.type === "ignore") return;

      if (intent.type === "help") {
        await safeReply(message, helpText(), logger);
        return;
      }

      if (intent.type === "list") {
        const alerts = store.listAlerts(message.author.id);
        const active = alerts.filter((a) => a.status === "active");
        if (active.length === 0) {
          await safeReply(message, "No active alerts. Create one with e.g. `AAPL 250`.", logger);
          return;
        }
        const lines = ["**Active alerts**", ...active.map(formatAlertLine)];
        await safeReply(message, lines.join("\n"), logger);
        return;
      }

      if (intent.type === "cancel") {
        const res = await store.cancelAlert(message.author.id, intent.alertId);
        if (!res.ok) {
          const msg =
            res.reason === "not_found"
              ? "Alert not found."
              : res.reason === "forbidden"
                ? "That alert does not belong to you."
                : "Alert is not active.";
          await safeReply(message, msg, logger);
          return;
        }
        await safeReply(message, `Cancelled alert ${formatAlertLine(res.alert)}`, logger);
        try {
          await onAlertStoreChanged?.({ type: "cancelled", alert: res.alert });
        } catch (e) {
          logger?.error?.("onAlertStoreChanged failed", { err: String(e) });
        }
        return;
      }

      if (intent.type === "error") {
        await safeReply(message, intent.message, logger);
        return;
      }

      if (intent.type === "create") {
        const alert = await store.createAlert(message.author.id, intent.symbol, intent.op, intent.targetPrice);
        const latest = engine.getLatest(intent.symbol);
        const lastStr = latest ? ` Last seen: $${money(latest.price)} (${latest.source}).` : "";
        await safeReply(
          message,
          `Created alert ${formatAlertLine(alert)}.${lastStr}\nWhen it triggers, I’ll DM you once.`,
          logger
        );
        try {
          await onAlertStoreChanged?.({ type: "created", alert });
        } catch (e) {
          logger?.error?.("onAlertStoreChanged failed", { err: String(e) });
        }
        return;
      }
    } catch (err) {
      logger?.error?.("DM handler error", { err: String(err) });
      try {
        if (relayChannel) await relayChannel.send(`DM handler error: ${String(err)}`);
      } catch {
        // ignore relay failures
      }
    }
  });

  async function sendTriggerDm({ userId, symbol, op, targetPrice, alertId, lastPrice, ts }) {
    try {
      const user = await client.users.fetch(userId);
      await user.send(
        [
          "**Price alert triggered**",
          `- Symbol: **${symbol}**`,
          `- Alert: \`${alertId}\`  ${symbol} ${op} $${money(targetPrice)}`,
          `- Last price: **$${money(lastPrice)}**`,
          `- Time: ${ts}`,
        ].join("\n")
      );
      return { ok: true };
    } catch (err) {
      logger?.error?.("Failed to send trigger DM", { err: String(err), userId, symbol, alertId });
      try {
        if (relayChannel) {
          await relayChannel.send(
            `Failed to DM user ${userId} for alert \`${alertId}\` (${symbol}). They may have DMs disabled.`
          );
        }
      } catch {
        // ignore
      }
      return { ok: false, err };
    }
  }

  return { sendTriggerDm };
}

