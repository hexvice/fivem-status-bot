const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const axios = require("axios");
const { DateTime } = require("luxon");

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const TOKEN = process.env.TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;

const TIME_ZONE = "America/Los_Angeles";
const UPDATE_INTERVAL_MS = 15000;

// Custom emojis
const EMOJIS = {
  online: "<:status_online:1486096471521493113>",
  idle: "<:status_idle:1486096579579609130>",
  dnd: "<:status_dnd:1486096639734054992>",
  restart: "<:serverrestart_IDS:1486096687826211017>"
};

// Server config
const servers = [
  {
    key: "vista",
    name: "The Vista",
    code: "66j376",
    icon: "https://frontend.cfx-services.net/api/servers/icon/66j376/-1608708883.png",

    // Vista usually around 10 AM / 10 PM PT
    restartType: "dailyTimes",
    restartHours: [10, 22],

    messageId: null
  },
  {
    key: "windy",
    name: "Windy City",
    code: "bpvp3b",
    icon: "https://frontend.cfx-services.net/api/servers/icon/bpvp3b/-530489038.png",

    // Windy = 12 hour cycle
    // Change this to the LAST REAL restart time in PT when needed
    restartType: "interval",
    intervalHours: 12,
    anchorLocal: "2026-03-24T03:32:00",

    messageId: null
  }
];

let isUpdating = false;

function formatCountdown(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function getNextRestart(server) {
  const now = DateTime.now().setZone(TIME_ZONE);

  if (server.restartType === "dailyTimes") {
    const dayStart = now.startOf("day");
    const candidates = [];

    for (const hour of server.restartHours) {
      const today = dayStart.plus({ hours: hour });
      const tomorrow = dayStart.plus({ days: 1, hours: hour });

      if (today > now) candidates.push(today);
      candidates.push(tomorrow);
    }

    candidates.sort((a, b) => a.toMillis() - b.toMillis());
    return candidates[0];
  }

  if (server.restartType === "interval") {
    const anchor = DateTime.fromISO(server.anchorLocal, { zone: TIME_ZONE });
    const intervalMs = server.intervalHours * 60 * 60 * 1000;

    if (!anchor.isValid) {
      return now.plus({ hours: 12 });
    }

    if (now <= anchor) {
      return anchor;
    }

    const elapsedMs = now.toMillis() - anchor.toMillis();
    const cyclesPassed = Math.floor(elapsedMs / intervalMs);
    return anchor.plus({ milliseconds: (cyclesPassed + 1) * intervalMs });
  }

  return now.plus({ hours: 12 });
}

function getPopulationLabel(players, maxPlayers) {
  if (!maxPlayers || maxPlayers <= 0) return "Unknown";

  const ratio = players / maxPlayers;

  if (ratio >= 0.8) return "High Pop";
  if (ratio >= 0.4) return "Medium Pop";
  return "Low Pop";
}

function getVisualState(liveData, msUntilRestart) {
  const minutes = msUntilRestart / 60000;

  if (!liveData.online) {
    return {
      color: 0xef4444,
      emoji: EMOJIS.dnd,
      statusText: "Offline",
      alertText: `${EMOJIS.dnd} Server is currently offline`
    };
  }

  if (minutes <= 5) {
    return {
      color: 0xef4444,
      emoji: EMOJIS.idle,
      statusText: "Restarting Very Soon",
      alertText: `${EMOJIS.restart} Restart in ~5 minutes`
    };
  }

  if (minutes <= 10) {
    return {
      color: 0xf97316,
      emoji: EMOJIS.idle,
      statusText: "Restarting Soon",
      alertText: `${EMOJIS.restart} Restart in ~10 minutes`
    };
  }

  if (minutes <= 30) {
    return {
      color: 0xeab308,
      emoji: EMOJIS.idle,
      statusText: "Restart Approaching",
      alertText: `${EMOJIS.restart} Restart in ~30 minutes`
    };
  }

  return {
    color: 0x22c55e,
    emoji: EMOJIS.online,
    statusText: "Online",
    alertText: null
  };
}

async function fetchServerData(server, attempt = 1) {
  try {
    const response = await axios.get(
      `https://servers-frontend.fivem.net/api/servers/single/${server.code}`,
      {
        timeout: 10000,
        headers: {
          "User-Agent": "Mozilla/5.0",
          "Cache-Control": "no-cache",
          Pragma: "no-cache"
        }
      }
    );

    const data = response.data?.Data;

    if (!data) {
      throw new Error("Missing API data");
    }

    return {
      online: true,
      players: typeof data.clients === "number" ? data.clients : 0,
      maxPlayers: typeof data.sv_maxclients === "number" ? data.sv_maxclients : 0
    };
  } catch (error) {
    if (attempt < 2) {
      return fetchServerData(server, attempt + 1);
    }

    return {
      online: false,
      players: 0,
      maxPlayers: 0
    };
  }
}

function buildEmbed(server, liveData) {
  const now = DateTime.now().setZone(TIME_ZONE);
  const nextRestart = getNextRestart(server);
  const msUntilRestart = Math.max(0, nextRestart.toMillis() - now.toMillis());
  const visual = getVisualState(liveData, msUntilRestart);
  const popLabel = getPopulationLabel(liveData.players, liveData.maxPlayers);

  const embed = new EmbedBuilder()
    .setTitle(server.name)
    .setColor(visual.color)
    .setThumbnail(server.icon)
    .addFields(
      {
        name: "Status",
        value: `${visual.emoji} ${visual.statusText}`,
        inline: true
      },
      {
        name: "Players",
        value: `${liveData.players} / ${liveData.maxPlayers}`,
        inline: true
      },
      {
        name: "Restart In",
        value: formatCountdown(msUntilRestart),
        inline: true
      },
      {
        name: "Population",
        value: popLabel,
        inline: true
      },
      {
        name: "Next Restart",
        value: nextRestart.toFormat("ccc, LLL d • h:mm a"),
        inline: true
      },
      {
        name: "Time Zone",
        value: "PT",
        inline: true
      }
    )
    .setFooter({ text: "Live FiveM Status" })
    .setTimestamp();

  if (visual.alertText) {
    embed.addFields({
      name: "Alerts",
      value: visual.alertText,
      inline: false
    });
  }

  return embed;
}

async function findExistingStatusMessage(channel, serverName) {
  const messages = await channel.messages.fetch({ limit: 25 });

  return (
    messages.find((msg) => {
      if (msg.author.id !== client.user.id) return false;
      if (!msg.embeds?.length) return false;
      return msg.embeds[0]?.title === serverName;
    }) || null
  );
}

async function ensureMessage(channel, server) {
  if (server.messageId) {
    try {
      return await channel.messages.fetch(server.messageId);
    } catch {
      server.messageId = null;
    }
  }

  const existing = await findExistingStatusMessage(channel, server.name);
  if (existing) {
    server.messageId = existing.id;
    return existing;
  }

  const created = await channel.send({ content: `Loading ${server.name}...` });
  server.messageId = created.id;
  return created;
}

async function updateServer(channel, server) {
  const liveData = await fetchServerData(server);
  const embed = buildEmbed(server, liveData);
  const message = await ensureMessage(channel, server);

  await message.edit({
    content: "",
    embeds: [embed]
  });
}

async function updateAllServers() {
  if (isUpdating) return;
  isUpdating = true;

  try {
    const channel = await client.channels.fetch(CHANNEL_ID);

    if (!channel) {
      throw new Error("Channel not found");
    }

    for (const server of servers) {
      try {
        await updateServer(channel, server);
      } catch (error) {
        console.error(`Failed to update ${server.name}:`, error.message);
      }
    }
  } finally {
    isUpdating = false;
  }
}

client.once("clientReady", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  if (!TOKEN) {
    console.error("Missing TOKEN variable.");
    return;
  }

  if (!CHANNEL_ID) {
    console.error("Missing CHANNEL_ID variable.");
    return;
  }

  await updateAllServers();

  setInterval(async () => {
    await updateAllServers();
  }, UPDATE_INTERVAL_MS);
});

client.login(TOKEN);
