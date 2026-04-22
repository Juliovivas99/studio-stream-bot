import { helpText } from "../../alerts/parser.js";

function money(n) {
  if (typeof n !== "number" || Number.isNaN(n)) return "?";
  return n.toFixed(2);
}

function formatAlertLine(a) {
  const status = a.status || "unknown";
  return `\`${a.id}\`  ${a.symbol} ${a.op} $${money(a.targetPrice)}  (${status})`;
}

export function registerSlashCommandHandlers({ client, logger, store, engine, defaultOp, onAlertStoreChanged }) {
  client.on("interactionCreate", async (interaction) => {
    try {
      if (!interaction?.isChatInputCommand?.()) return;

      if (interaction.commandName === "alert") {
        const symbol = String(interaction.options.getString("symbol", true)).trim().toUpperCase();
        const op = interaction.options.getString("op", false) || defaultOp || ">=";
        const price = interaction.options.getNumber("price", true);

        const alert = await store.createAlert(interaction.user.id, symbol, op, price);
        const latest = engine.getLatest(symbol);
        const lastStr = latest ? ` Last seen: $${money(latest.price)} (${latest.source}).` : "";

        await interaction.reply({
          content: `Created alert ${formatAlertLine(alert)}.${lastStr}\nWhen it triggers, I’ll DM you once.`,
          ephemeral: true,
        });

        await onAlertStoreChanged?.({ type: "created", alert });
        return;
      }

      if (interaction.commandName === "alerts") {
        const sub = interaction.options.getSubcommand();
        if (sub === "list") {
          const alerts = store.listAlerts(interaction.user.id).filter((a) => a.status === "active");
          if (alerts.length === 0) {
            await interaction.reply({ content: "No active alerts. Create one with `/alert`.", ephemeral: true });
            return;
          }
          await interaction.reply({
            content: ["**Active alerts**", ...alerts.map(formatAlertLine)].join("\n"),
            ephemeral: true,
          });
          return;
        }

        if (sub === "cancel") {
          const id = interaction.options.getString("id", true);
          const res = await store.cancelAlert(interaction.user.id, id);
          if (!res.ok) {
            const msg =
              res.reason === "not_found"
                ? "Alert not found."
                : res.reason === "forbidden"
                  ? "That alert does not belong to you."
                  : "Alert is not active.";
            await interaction.reply({ content: msg, ephemeral: true });
            return;
          }

          await interaction.reply({ content: `Cancelled alert ${formatAlertLine(res.alert)}`, ephemeral: true });
          await onAlertStoreChanged?.({ type: "cancelled", alert: res.alert });
          return;
        }
      }

      // Fallback
      await interaction.reply({ content: helpText(), ephemeral: true });
    } catch (err) {
      logger?.error?.("Slash command handler error", { err: String(err) });
      try {
        if (interaction?.deferred || interaction?.replied) {
          await interaction.followUp({ content: "Something went wrong. Try again.", ephemeral: true });
        } else {
          await interaction.reply({ content: "Something went wrong. Try again.", ephemeral: true });
        }
      } catch {
        // ignore
      }
    }
  });
}

