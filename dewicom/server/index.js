const express = require("express");
const https = require("https");
const fs = require("fs");
const { Server } = require("socket.io");
const QRCode = require("qrcode");
const os = require("os");
const path = require("path");
const dgram = require("dgram");
const { version: APP_VERSION } = require("../package.json");

const app = express();
const sslOptions = {
  key: fs.readFileSync(path.join(__dirname, "../localhost+2-key.pem")),
  cert: fs.readFileSync(path.join(__dirname, "../localhost+2.pem")),
};
const server = https.createServer(sslOptions, app);
const io = new Server(server, {
  cors: { origin: "*" },
  maxHttpBufferSize: 1e6,
});

const PORT = process.env.PORT || 3001;

// Static files (shared/public/ = source unique pour desktop + server)
app.use(express.static(path.join(__dirname, "../../shared/public")));

// Get local IP
function getLocalIP() {
  const candidates = [];
  for (const [name, ifaces] of Object.entries(os.networkInterfaces())) {
    for (const iface of ifaces) {
      if (iface.family !== "IPv4" || iface.internal) continue;
      if (iface.address.startsWith("169.254.")) continue;
      const lname = name.toLowerCase();
      let score = 0;
      if (lname.includes("virtualbox") || lname.includes("vmware") ||
          lname.includes("vbox") || lname.includes("hyper-v") ||
          lname.includes("loopback") || lname.includes("tap") ||
          lname.includes("tun") || lname.includes("docker") ||
          lname.startsWith("virbr") || lname.startsWith("veth") ||
          lname.startsWith("br-") || lname.startsWith("lxc") ||
          lname.startsWith("lxd")) score -= 10;
      if (iface.address.startsWith("192.168.") || iface.address.startsWith("10.") ||
          iface.address.startsWith("172.")) score += 5;
      candidates.push({ address: iface.address, score });
    }
  }
  if (candidates.length === 0) return "localhost";
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].address;
}

// QR code endpoint
app.get("/qr", async (req, res) => {
  const ip = getLocalIP();
  const url = `https://${ip}:${PORT}`;
  try {
    const qr = await QRCode.toDataURL(url, {
      width: 300,
      margin: 2,
      color: { dark: "#ffffff", light: "#000000" },
    });
    res.json({ qr, url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// API découverte serveur LAN
app.get("/api/discover", (req, res) => {
  const serverIP = getLocalIP();
  const serverInfo = {
    server: true,
    name: `DewiCom-${os.hostname()}`,
    ip: serverIP,
    port: PORT,
    https: true,
    channels: Object.keys(channels).length,
    users: Array.from(users.values()).length,
    version: APP_VERSION,
    timestamp: new Date().toISOString(),
    url: `https://${serverIP}:${PORT}`
  };
  
  // Ajouter les détails des canaux
  const channelDetails = Object.entries(channels).map(([id, ch]) => ({
    id,
    name: ch.name,
    color: ch.color,
    userCount: ch.users.size
  }));
  
  // Ajouter les détails des utilisateurs
  const userDetails = Array.from(users.values()).map(u => ({
    id: u.socketId,
    name: u.name,
    channel: u.channel,
    speaking: u.speaking || false,
    directorMode: u.directorMode || false
  }));
  
  res.json({
    ...serverInfo,
    channels: channelDetails,
    users: userDetails,
    network: {
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch()
    }
  });
});

// Health check étendu pour les apps mobiles
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    server: true,
    ip: getLocalIP(),
    port: PORT,
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// State
const channels = {
  general: { name: "Général", color: "#6b7280", users: new Map() },
  foh:     { name: "FOH Son", color: "#3b82f6", users: new Map() },
  plateau: { name: "Plateau", color: "#f97316", users: new Map() },
  lumiere: { name: "Lumière", color: "#a855f7", users: new Map() },
  regie:   { name: "Régie", color: "#22c55e", users: new Map() },
};

const users = new Map(); // socketId → { name, channel, socketId }

function broadcastChannelState() {
  const state = {};
  for (const [id, ch] of Object.entries(channels)) {
    state[id] = {
      ...ch,
      users: Array.from(ch.users.values()).map((u) => ({
        id: u.socketId,
        name: u.name,
      })),
    };
  }
  io.emit("channel-state", state);
}

io.on("connection", (socket) => {
  console.log(`[+] ${socket.id} connecté`);

  // Send initial state
  socket.emit("channels-init", Object.entries(channels).map(([id, ch]) => ({
    id,
    name: ch.name,
    color: ch.color,
  })));

  // User joins with name + channel
  socket.on("join", ({ clientId, name, channel, listenChannels = [], talkChannels = [] }) => {
    // Nettoie toute entrée existante avec le même clientId (reconnexion après redémarrage serveur)
    for (const [oldId, oldUser] of users.entries()) {
      if (oldId !== socket.id && (clientId ? oldUser.clientId === clientId : oldUser.name === name)) {
        const oldCh = channels[oldUser.channel];
        if (oldCh) oldCh.users.delete(oldId);
        users.delete(oldId);
      }
    }
    const ch = channels[channel] || channels.general;
    const user = { clientId, name, channel, listenChannels, talkChannels, id: socket.id };
    users.set(socket.id, user);
    socket.join(channel);
    // Join additional listening channels (avoid duplicates)
    listenChannels.forEach(chId => {
      if (chId !== channel) socket.join(chId);
    });
    broadcastChannelState();
    console.log(`[join] ${name} → ${channel} (listen: ${listenChannels.length ? listenChannels.join(',') : 'none'} || talk: ${talkChannels.length ? talkChannels.join(',') : channel})`);
    io.emit("user-joined", { name, channel });
  });

  // Switch channel
  socket.on("switch-channel", ({ channel }) => {
    const user = users.get(socket.id);
    if (!user) return;
    // Leave old channel
    const oldCh = channels[user.channel];
    if (oldCh) oldCh.users.delete(socket.id);
    socket.leave(user.channel);
    // Join new channel
    const newCh = channels[channel] || channels.general;
    user.channel = channel;
    newCh.users.set(socket.id, user);
    socket.join(channel);
    broadcastChannelState();
  });

  // PTT audio chunk — broadcast to all talk channels (Director mode) or single channel
  socket.on("audio-chunk", (payload) => {
    const user = users.get(socket.id);
    if (!user) return;
    const talkChannels = user.talkChannels?.length ? user.talkChannels : [payload.channel || user.channel];
    const chunk = payload.chunk;
    // Déduplique les destinataires pour éviter envois multiples en director mode
    const seen = new Set();
    talkChannels.forEach(channel => {
      const room = io.sockets.adapter.rooms.get(channel);
      if (!room) return;
      room.forEach(sid => {
        if (sid !== socket.id && !seen.has(sid)) {
          seen.add(sid);
          const dest = io.sockets.sockets.get(sid);
          if (dest) dest.emit("audio-chunk", { from: user.name, fromId: socket.id, channel, chunk });
        }
      });
    });
  });

  // Update listening channels (monitoring)
  socket.on("update-listen-channels", ({ listenChannels = [] }) => {
    const user = users.get(socket.id);
    if (!user) return;
    const oldChannels = user.listenChannels || [];
    // Leave channels that are no longer in the list (except current/talk channels)
    oldChannels.forEach(ch => {
      if (!listenChannels.includes(ch) && ch !== user.channel && !user.talkChannels?.includes(ch)) {
        socket.leave(ch);
      }
    });
    // Join new channels (avoid duplicates)
    listenChannels.forEach(ch => {
      if (!oldChannels.includes(ch) && ch !== user.channel && !user.talkChannels?.includes(ch)) {
        socket.join(ch);
      }
    });
    user.listenChannels = listenChannels;
    console.log(`[listen] ${user.name} → ${listenChannels.length ? listenChannels.join(',') : 'none'}`);
  });

  // Update talk channels (Director mode)
  socket.on("update-talk-channels", ({ talkChannels = [] }) => {
    const user = users.get(socket.id);
    if (!user) return;
    user.talkChannels = talkChannels;
    console.log(`[talk] ${user.name} → ${talkChannels.length ? talkChannels.join(',') : user.channel}`);
  });

  // Call ring — notify all users on a channel
  socket.on("call-ring", ({ channel }) => {
    const user = users.get(socket.id);
    if (!user) return;
    // Canal principal + clients qui écoutent ce canal (mode director)
    const targets = new Set();
    for (const [sid, u] of users) {
      if (sid === socket.id) continue;
      const listens = u.listenChannels || [];
      if (u.channel === channel || listens.includes(channel)) targets.add(sid);
    }
    targets.forEach(sid => {
      const s = io.sockets.sockets.get(sid);
      if (s) s.emit("call-ring", { from: user.name, fromId: socket.id, channel });
    });
    console.log(`[call] ${user.name} → ${channel} (${targets.size} destinataires)`);
  });

  // PTT state (speaking indicator)
  socket.on("ptt-start", ({ channel }) => {
    const user = users.get(socket.id);
    if (!user) return;
    socket.to(channel).emit("ptt-start", { from: user.name, fromId: socket.id });
    io.emit("ptt-state", { fromId: socket.id, from: user.name, channel, speaking: true });
  });

  socket.on("ptt-stop", ({ channel }) => {
    const user = users.get(socket.id);
    if (!user) return;
    socket.to(channel).emit("ptt-stop", { from: user.name, fromId: socket.id });
    io.emit("ptt-state", { fromId: socket.id, from: user.name, channel, speaking: false });
  });

  // Disconnect
  socket.on("disconnect", () => {
    const user = users.get(socket.id);
    if (user) {
      const ch = channels[user.channel];
      if (ch) ch.users.delete(socket.id);
      users.delete(socket.id);
      io.emit("user-left", { name: user.name, channel: user.channel });
      broadcastChannelState();
    }
    console.log(`[-] ${socket.id} déconnecté`);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  const ip = getLocalIP();
  console.log(`\n🎙️  DewiCom démarré`);
  console.log(`   Local    : https://localhost:${PORT}`);
  console.log(`   Local    : https://127.0.0.1:${PORT}`);
  console.log(`   Réseau   : https://${ip}:${PORT}`);
  console.log(`   QR Code  : https://${ip}:${PORT}/qr\n`);

  // Annonce multicast UDP : les clients APK écoutent ce groupe
  // et trouvent le serveur instantanément sans scanner le réseau
  const MCAST_ADDR = "224.0.0.251";
  const MCAST_PORT = 9999;
  const udp = dgram.createSocket({ type: "udp4", reuseAddr: true });

  udp.bind(() => {
    udp.setMulticastTTL(4);
    udp.setMulticastLoopback(false);

    const announce = () => {
      const payload = Buffer.from(JSON.stringify({
        service: "DewiCom",
        version: APP_VERSION,
        ip: ip,
        port: PORT,
        protocol: "https"
      }));
      udp.send(payload, 0, payload.length, MCAST_PORT, MCAST_ADDR, (err) => {
        if (err) console.warn("Multicast announce error:", err.message);
      });
    };

    announce(); // annonce immédiate au démarrage
    const timer = setInterval(announce, 2000);

    // Arrête les annonces proprement si le serveur s'arrête
    process.on("SIGINT", () => { clearInterval(timer); udp.close(); process.exit(); });
    process.on("SIGTERM", () => { clearInterval(timer); udp.close(); process.exit(); });

    console.log(`   Multicast : ${MCAST_ADDR}:${MCAST_PORT} (annonce toutes les 2s)\n`);
  });
});

// API de découverte DewiCom
app.get('/api/dewicom-discovery', (req, res) => {
  res.json({
    service: 'DewiCom',
    version: APP_VERSION,
    timestamp: new Date().toISOString(),
    endpoints: {
      socket: '/socket.io/',
      qr: '/qr',
      web: '/'
    }
  });
});

// Endpoint de test simple
app.get('/api/ping', (req, res) => {
  res.json({ status: 'ok', service: 'DewiCom' });
});
