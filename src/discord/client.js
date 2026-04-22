import { Client, GatewayIntentBits, Partials } from "discord.js";

export function createDiscordClient({ logger }) {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel, Partials.Message],
  });

  client.on("ready", () => {
    logger.info("Discord client ready", {
      userTag: client.user?.tag,
      userId: client.user?.id,
    });
  });

  client.on("error", (err) => {
    logger.error("Discord client error", { err: String(err) });
  });

  return client;
}

export async function fetchChannel({ client, channelId, logger }) {
  logger.info("Fetching Discord channel", { channelId });
  const channel = await client.channels.fetch(channelId).catch((err) => {
    throw new Error(`Failed to fetch channel ${channelId}: ${String(err)}`);
  });

  if (!channel) throw new Error(`Channel not found: ${channelId}`);
  if (!("send" in channel)) throw new Error(`Channel is not sendable: ${channelId}`);

  logger.info("Discord channel ready", {
    channelId,
    channelName: channel.name,
    guildId: channel.guild?.id,
  });

  return channel;
}

