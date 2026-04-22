import { REST, Routes, SlashCommandBuilder } from "discord.js";

function buildCommands() {
  const alert = new SlashCommandBuilder()
    .setName("alert")
    .setDescription("Create a one-time price alert")
    .addStringOption((opt) =>
      opt.setName("symbol").setDescription("Ticker symbol (e.g. AAPL)").setRequired(true)
    )
    .addNumberOption((opt) => opt.setName("price").setDescription("Target price").setRequired(true))
    .addStringOption((opt) =>
      opt
        .setName("op")
        .setDescription("Operator")
        .setRequired(false)
        .addChoices(
          { name: ">=", value: ">=" },
          { name: "<=", value: "<=" },
          { name: ">", value: ">" },
          { name: "<", value: "<" },
          { name: "=", value: "=" }
        )
    )
    ;

  const alerts = new SlashCommandBuilder()
    .setName("alerts")
    .setDescription("List or cancel alerts")
    .addSubcommand((sub) => sub.setName("list").setDescription("List your active alerts"))
    .addSubcommand((sub) =>
      sub
        .setName("cancel")
        .setDescription("Cancel an alert by id")
        .addStringOption((opt) => opt.setName("id").setDescription("Alert id").setRequired(true))
    );

  return [alert, alerts].map((c) => c.toJSON());
}

export async function registerSlashCommands({ token, appId, guildId, logger }) {
  const rest = new REST({ version: "10" }).setToken(token);
  const commands = buildCommands();

  const route = guildId ? Routes.applicationGuildCommands(appId, guildId) : Routes.applicationCommands(appId);
  const scope = guildId ? "guild" : "global";

  logger?.info?.("Registering slash commands", { scope, guildId: guildId || null });
  await rest.put(route, { body: commands });
  logger?.info?.("Slash commands registered", { scope, count: commands.length });
}

