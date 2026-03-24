const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const axios = require("axios");
const { DateTime } = require("luxon");

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const TOKEN = process.env.TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;

const TIME_ZONE = "America/Los_Angeles";
const UPDATE_INTERVAL_MS = 30_000;

const servers = [
  {
    key: "vista",
    name: "The Vista",
    code: "66j376",

    // Vista resets around 10 AM / 10 PM PST
    restartType: "dailyTimes",
    restartHours: [10, 22],

    statusMessageId: null,
    online: null,
    alertFlags: {
      restart30: false,
      restart10: false,
      restart5: false
    }
  },
  {
    key: "windy",
    name: "Windy City",
    code: "bpvp3b",

    // Windy runs on a 12 hour cycle.
    // Set this to the LAST KNOWN restart time in Los Angeles time.
    // Example format: "2026-03-24T15:00:00"
    restartType: "interval",
    intervalHours: 12,
    anchorLocal: "2026-03-24T15:00:00",

    statusMessageId: null,
    online: null,
    alertFlags: {
      restart30: false,
      restart10: false,
      restart5: false
    }
  }
];

function formatCountdown(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function getVistaNextRestart(server) {
  const now = DateTime.now().setZone(TIME_ZONE);
  const today = now.startOf("day");

  const candidates = [];

  for (const hour of server.restartHours) {
    const todayCandidate = today.plus({ hours: hour });
    const tomorrowCandidate = today.plus({ days: 1, hours: hour });

    if (todayCandidate > now) candidates.push(todayCandidate);
    candidates.push(tomorrowCandidate);
  }

  candidates.sort((a, b) => a.toMillis() - b.toMillis());
  return candidates[0];
}

function getIntervalNextRestart(server) {
  const now = DateTime.now().setZone(TIME_ZONE);
  const anchor = DateTime.fromISO(server.anchorLocal, { zone: TIME_ZONE });

  if (!anchor.isValid) {
    throw new Error(`Invalid anchorLocal for ${server.name}`);
  }

  const intervalMs = server.intervalHours * 60 * 60 * 1000;

  if (now <= anchor) return anchor;

  const elapsedMs = now.toMillis() - anchor.toMillis();
  const cyclesPassed = Math.floor(elapsedMs / intervalMs);
  let nextRestart = anchor.plus({ milliseconds: (cyclesPassed + 1) * intervalMs });

  if (nextRestart <= now) {
    nextRestart = nextRestart.plus({ milliseconds: intervalMs });
  }

  return nextRestart;
}

function getNextRestart(server) {
  if (server.restartType === "dailyTimes") {
    return getVistaNextRestart(server);
  }

  if (server.restartType === "interval") {
    return getIntervalNextRestart(server);
  }

  throw new Error(`Unknown restart type for ${server.name}`);
}

async function getServerData(server) {
  try {
    const response = await axios.get(
      `https://servers-frontend.fivem.net/api/servers/single/${server.code}`,
      {
        timeout: 10000,
        headers: {
          "User-Agent": "Mozilla/5.0"
        }
      }
    );

    const data = response.data?.Data;

    if (!data) {
      throw new Error("Missing FiveM server data");
    }

    const iconUrl = data.icon
      ? `https://servers-frontend.fivem.net/api/servers/icon/${server.code}`
      : null;

    return {
      online: true,
      players: typeof data.clients === "number" ? data.clients : 0,
      maxPlayers: data.sv_maxclients ?? 0,
      hostname: data.hostname || server.name,
      iconUrl
    };
  } catch (error) {
    return {
      online: false,
      players: 0,
      maxPlayers: 0,
      hostname: server.name,
      iconUrl: null
    };
  }
}

async function sendStateChangeAlert(channel, server, isOnline) {
  const text = isOnline
    ? `🟢 **${server.name} is back online**`
    : `🔴 **${server.name} went offline**`;

  await channel.send({ content: text });
}

async function sendRestartAlert(channel, server, minutes) {
  await channel.send({
    content: `⚠️ **${server.name} restart in about ${minutes} minute${minutes === 1 ? "" : "s"}**`
  });
}

function resetRestartFlags(server) {
  server.alertFlags.restart30 = false;
  server.alertFlags.restart10 = false;
  server.alertFlags.restart5 = false;
}

function maybeTriggerRestartAlerts(channel, server, msUntilRestart) {
  const minutes = msUntilRestart / 60000;

  const alerts = [];

  if (minutes <= 30 && !server.alertFlags.restart30) {
    server.alertFlags.restart30 = true;
    alerts.push(30);
  }

  if (minutes <= 10 && !server.alertFlags.restart10) {
    server.alertFlags.restart10 = true;
    alerts.push(10);
  }

  if (minutes <= 5 && !server.alertFlags.restart5) {
    server.alertFlags.restart5 = true;
    alerts.push(5);
  }

  if (minutes > 30) {
    resetRestartFlags(server);
  }

  return alerts.map((m) => sendRestartAlert(channel, server, m));
}

function buildEmbed(server, liveData, nextRestart) {
  const now = DateTime.now().setZone(TIME_ZONE);
  const msUntilRestart = Math.max(0, nextRestart.toMillis() - now.toMillis());
  const statusText = liveData.online ? "🟢 Online" : "🔴 Offline";
  const color = liveData.online ? 0x22c55e : 0xef4444;

  const embed = new EmbedBuilder()
    .setTitle(server.name)
    .setColor(color)
    .addFields(
      {
        name: "Status",
        value: statusText,
        inline: true
      },
      {
        name: "Players",
        value: liveData.online
          ? `${liveData.players} / ${liveData.maxPlayers}`
          : "0 / 0",
        inline: true
      },
      {
        name: "Restart In",
        value: formatCountdown(msUntilRestart),
        inline: true
      },
      {
        name: "Next Restart",
        value: nextRestart.toFormat("ccc, LLL d • h:mm a ZZZZ"),
        inline: false
      }
    )
    .setFooter({
      text: "Live FiveM monitor"
    })
    .setTimestamp();

  if (liveData.iconUrl) {
    embed.setThumbnail(liveData.iconUrl);
  }

  return embed;
}

async function findOrCreateStatusMessage(channel, serverName) {
  const recentMessages = await channel.messages.fetch({ limit: 20 });

  const existing = recentMessages.find((msg) => {
    if (msg.author.id !== client.user.id) return false;
    if (!msg.embeds.length) return false;
    return msg.embeds[0]?.title === serverName;
  });

  if (existing) return existing;

  return channel.send({
    content: `Loading ${serverName}...`
  });
}

async function bootstrapStatusMessages(channel) {
  for (const server of servers) {
    const message = await findOrCreateStatusMessage(channel, server.name);
    server.statusMessageId = message.id;
  }
}

async function updateServerStatus(channel, server) {
  const liveData = await getServerData(server);
  const nextRestart = getNextRestart(server);
  const now = DateTime.now().setZone(TIME_ZONE);
  const msUntilRestart = Math.max(0, nextRestart.toMillis() - now.toMillis());

  if (server.online === null) {
    server.online = liveData.online;
  } else if (server.online !== liveData.online) {
    server.online = liveData.online;
    await sendStateChangeAlert(channel, server, liveData.online);
  }

  await Promise.all(maybeTriggerRestartAlerts(channel, server, msUntilRestart));

  const embed = buildEmbed(server, liveData, nextRestart);
  const message = await channel.messages.fetch(server.statusMessageId);

  await message.edit({
    content: "",
    embeds: [embed]
  });
}

async function updateAllStatuses() {
  const channel = await client.channels.fetch(CHANNEL_ID);

  for (const server of servers) {
    try {
      await updateServerStatus(channel, server);
    } catch (error) {
      console.error(`Failed updating ${server.name}:`, error.message);
    }
  }
}

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  const channel = await client.channels.fetch(CHANNEL_ID);
  await bootstrapStatusMessages(channel);
  await updateAllStatuses();

  setInterval(async () => {
    await updateAllStatuses();
  }, UPDATE_INTERVAL_MS);
});

client.login(TOKEN);
