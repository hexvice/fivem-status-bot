const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const axios = require("axios");
const { DateTime } = require("luxon");

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const TOKEN = process.env.TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;

const TIME_ZONE = "America/Los_Angeles";
const UPDATE_INTERVAL = 30000;

// 🔥 YOUR SERVERS
const servers = [
  {
    name: "The Vista",
    code: "66j376",
    icon: "https://frontend.cfx-services.net/api/servers/icon/66j376/-1608708883.png",

    restartType: "daily",
    restartHours: [10, 22], // 10AM / 10PM PST

    online: null,
    messageId: null,
    alerts: {}
  },
  {
    name: "Windy City",
    code: "bpvp3b",
    icon: "https://frontend.cfx-services.net/api/servers/icon/bpvp3b/-530489038.png",

    restartType: "interval",
    intervalHours: 12,
    anchor: "2026-03-24T15:00:00", // CHANGE if needed

    online: null,
    messageId: null,
    alerts: {}
  }
];

// 📡 FETCH DATA
async function getServer(server) {
  try {
    const res = await axios.get(
      `https://servers-frontend.fivem.net/api/servers/single/${server.code}`
    );

    const data = res.data.Data;

    return {
      online: true,
      players: data.clients,
      max: data.sv_maxclients
    };
  } catch {
    return {
      online: false,
      players: 0,
      max: 0
    };
  }
}

// ⏳ TIME FORMAT
function format(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// 🧠 RESTART CALC
function getRestart(server) {
  const now = DateTime.now().setZone(TIME_ZONE);

  if (server.restartType === "daily") {
    const today = now.startOf("day");

    const times = server.restartHours.map(h =>
      today.plus({ hours: h })
    );

    const future = times.filter(t => t > now);
    if (future.length) return future[0];

    return today.plus({ days: 1, hours: server.restartHours[0] });
  }

  if (server.restartType === "interval") {
    const anchor = DateTime.fromISO(server.anchor, { zone: TIME_ZONE });
    const diff = now.toMillis() - anchor.toMillis();
    const cycle = server.intervalHours * 3600000;

    const next = anchor.plus({
      milliseconds: Math.ceil(diff / cycle) * cycle
    });

    return next;
  }
}

// 🚨 ALERT SYSTEM
async function alerts(channel, server, ms) {
  const min = ms / 60000;

  if (min <= 30 && !server.alerts["30"]) {
    server.alerts["30"] = true;
    await channel.send(`⚠️ ${server.name} restart in ~30 min`);
  }

  if (min <= 10 && !server.alerts["10"]) {
    server.alerts["10"] = true;
    await channel.send(`⚠️ ${server.name} restart in ~10 min`);
  }

  if (min <= 5 && !server.alerts["5"]) {
    server.alerts["5"] = true;
    await channel.send(`⚠️ ${server.name} restart in ~5 min`);
  }

  if (min > 30) server.alerts = {};
}

// 🧾 EMBED
function makeEmbed(server, data, next) {
  const now = DateTime.now().setZone(TIME_ZONE);
  const ms = next.toMillis() - now.toMillis();

  return new EmbedBuilder()
    .setTitle(server.name)
    .setColor(data.online ? 0x22c55e : 0xef4444)
    .setThumbnail(server.icon)
    .addFields(
      { name: "Status", value: data.online ? "🟢 Online" : "🔴 Offline", inline: true },
      { name: "Players", value: `${data.players} / ${data.max}`, inline: true },
      { name: "Restart In", value: format(ms), inline: true }
    )
    .setFooter({ text: "Live FiveM Status" })
    .setTimestamp();
}

// 🔄 UPDATE LOOP
async function update() {
  const channel = await client.channels.fetch(CHANNEL_ID);

  for (const server of servers) {
    const data = await getServer(server);
    const next = getRestart(server);
    const ms = next.toMillis() - DateTime.now().setZone(TIME_ZONE).toMillis();

    // ONLINE / OFFLINE ALERT
    if (server.online !== null && server.online !== data.online) {
      await channel.send(
        data.online
          ? `🟢 ${server.name} is back online`
          : `🔴 ${server.name} went offline`
      );
    }

    server.online = data.online;

    // RESTART ALERTS
    await alerts(channel, server, ms);

    const embed = makeEmbed(server, data, next);

    // CREATE / UPDATE MESSAGE
    if (!server.messageId) {
      const msg = await channel.send({ embeds: [embed] });
      server.messageId = msg.id;
    } else {
      const msg = await channel.messages.fetch(server.messageId);
      await msg.edit({ embeds: [embed] });
    }
  }
}

// 🚀 START
client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await update();
  setInterval(update, UPDATE_INTERVAL);
});

client.login(TOKEN);
