/**
 * DewiCom Server — serveur intercom standalone.
 * Tourne en Node.js pur (pas d'Electron), packagable en Docker ou lancé sur RPi/PC dédié.
 * Compatible avec tous les clients : APK Android, Desktop Electron, navigateur.
 *
 * Variables d'environnement :
 *   PORT          Port HTTP + WebSocket (défaut : 3001)
 *   BIND_IP       IP d'écoute (défaut : 0.0.0.0)
 *   SERVER_MODE   Mode annoncé aux clients : "docker" | "dedicated" (défaut : "dedicated")
 *   SERVER_NAME   Nom affiché dans les clients (défaut : hostname)
 */

const http   = require("http");
const path   = require("path");
const os     = require("os");
const dgram  = require("dgram");
const fs     = require("fs");

const express  = require("express");
const socketIo = require("socket.io").Server;
const QRCode   = require("qrcode");

const PORT        = parseInt(process.env.PORT || "3001", 10);
const BIND_IP     = process.env.BIND_IP || "0.0.0.0";
const SERVER_MODE = process.env.SERVER_MODE || "dedicated";
const SERVER_NAME = process.env.SERVER_NAME || os.hostname();
const VERSION     = require("./package.json").version;

const MCAST_ADDR = "224.0.0.251";
const MCAST_PORT = 9999;

// Public dir : ../shared/public (développement ou Docker avec volume monté)
const PUBLIC_DIR = (() => {
  const candidates = [
    path.join(__dirname, "../shared/public"),
    path.join(__dirname, "public"),
    "/public",
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return path.join(__dirname, "../shared/public");
})();

// ── Détection IP réseau ───────────────────────────────────────────────────────

function getLocalIP() {
  const candidates = [];
  for (const [name, ifaces] of Object.entries(os.networkInterfaces())) {
    for (const iface of ifaces) {
      if (iface.family !== "IPv4" || iface.internal) continue;
      if (iface.address.startsWith("169.254.")) continue;
      const lname = name.toLowerCase();
      let score = 0;
      if (lname.includes("docker") || lname.startsWith("br-") ||
          lname.startsWith("veth") || lname.startsWith("virbr")) score -= 5;
      if (iface.address.startsWith("192.168.") || iface.address.startsWith("10.") ||
          iface.address.startsWith("172.")) score += 5;
      candidates.push({ address: iface.address, score });
    }
  }
  if (candidates.length === 0) return "127.0.0.1";
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].address;
}

// ── Annonces multicast ────────────────────────────────────────────────────────

function startAnnouncing(ip, port) {
  let sock;
  try {
    sock = dgram.createSocket({ type: "udp4" });
    const payload = Buffer.from(JSON.stringify({
      service: "DewiCom",
      version: VERSION,
      ip, port,
      protocol: "http",
      mode: SERVER_MODE,   // "docker" ou "dedicated" → priorité haute dans la découverte client
      name: SERVER_NAME,
    }));
    const send = () => {
      sock.send(payload, 0, payload.length, MCAST_PORT, MCAST_ADDR, (err) => {
        if (err) console.warn("[server] Multicast error:", err.message);
      });
    };
    sock.bind(() => {
      sock.setMulticastTTL(4);
      send();
      setInterval(send, 1000);  // 1s pour réduire le délai de découverte
      console.log(`[server] Annonces multicast → ${ip}:${port} (mode=${SERVER_MODE})`);
    });
    sock.on("error", (e) => console.warn("[server] Multicast socket error:", e.message));
  } catch (e) {
    console.warn("[server] Impossible de démarrer les annonces multicast:", e.message);
  }
  return sock;
}

// ── État serveur ──────────────────────────────────────────────────────────────

const channels = {
  general: { name: "Général",  color: "#6b7280", users: new Map() },
  foh:     { name: "FOH Son",  color: "#3b82f6", users: new Map() },
  plateau: { name: "Plateau",  color: "#f97316", users: new Map() },
  lumiere: { name: "Lumière",  color: "#a855f7", users: new Map() },
  regie:   { name: "Régie",    color: "#22c55e", users: new Map() },
};
const users = new Map();

// ── Serveur HTTP + Socket.io ──────────────────────────────────────────────────

const app        = express();
const httpServer = http.createServer(app);
const io         = new socketIo(httpServer, { cors: { origin: "*" } });

// ── Routes HTTP ───────────────────────────────────────────────────────────────

app.get("/api/dewicom-discovery", (req, res) => {
  res.json({
    service: "DewiCom",
    version: VERSION,
    mode: SERVER_MODE,
    name: SERVER_NAME,
    uptime: Math.floor(process.uptime()),
  });
});

app.get("/monitor", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "monitor.html"));
});

app.get("/api/status", (req, res) => {
  const connectedUsers = Array.from(users.values()).map(u => ({
    name: u.name,
    channel: u.channel,
  }));
  res.json({
    service: "DewiCom",
    version: VERSION,
    mode: SERVER_MODE,
    name: SERVER_NAME,
    uptime: Math.floor(process.uptime()),
    users: connectedUsers,
    channelCount: Object.keys(channels).length,
    userCount: users.size,
  });
});

app.get("/qr", async (req, res) => {
  const ip  = getLocalIP();
  const url = `http://${ip}:${PORT}`;
  try {
    const qr = await QRCode.toDataURL(url, { width: 300, margin: 2 });
    res.json({ qr, url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.use(express.static(PUBLIC_DIR));

// ── Socket.io — logique intercom ─────────────────────────────────────────────

function broadcastChannelState() {
  const state = {};
  for (const [id, ch] of Object.entries(channels)) {
    state[id] = {
      ...ch,
      users: Array.from(ch.users.values()).map(u => ({ id: u.socketId, name: u.name })),
    };
  }
  io.emit("channel-state", state);
}

function monitorState() {
  return {
    name: SERVER_NAME,
    mode: SERVER_MODE,
    version: VERSION,
    uptime: Math.floor(process.uptime()),
  };
}

io.on("connection", (socket) => {
  console.log(`[server] + ${socket.id}`);

  socket.on("monitor-subscribe", () => {
    socket.emit("monitor-state", monitorState());
  });

  socket.emit("channels-init", Object.entries(channels).map(([id, ch]) => ({
    id, name: ch.name, color: ch.color,
  })));

  socket.on("join", ({ clientId, name, channel, listenChannels = [], talkChannels = [] }) => {
    // Nettoie toute entrée existante avec le même clientId (reconnexion après coupure)
    for (const [oldId, oldUser] of users.entries()) {
      if (oldId !== socket.id && (clientId ? oldUser.clientId === clientId : oldUser.name === name)) {
        const oldCh = channels[oldUser.channel];
        if (oldCh) oldCh.users.delete(oldId);
        users.delete(oldId);
      }
    }
    const ch   = channels[channel] || channels.general;
    const user = { clientId, name, channel, listenChannels, talkChannels, socketId: socket.id };
    users.set(socket.id, user);
    ch.users.set(socket.id, user);
    socket.join(channel);
    listenChannels.forEach(chId => { if (chId !== channel) socket.join(chId); });
    broadcastChannelState();
    io.emit("user-joined", { name, channel });
    console.log(`[server] join: ${name} → ${channel}`);
  });

  socket.on("switch-channel", ({ channel }) => {
    const user = users.get(socket.id);
    if (!user) return;
    const oldCh = channels[user.channel];
    if (oldCh) oldCh.users.delete(socket.id);
    socket.leave(user.channel);
    const newCh = channels[channel] || channels.general;
    user.channel = channel;
    newCh.users.set(socket.id, user);
    socket.join(channel);
    broadcastChannelState();
  });

  socket.on("audio-chunk", (payload) => {
    const user = users.get(socket.id);
    if (!user) return;
    const talkChs = payload.talkChannels?.length ? payload.talkChannels
                  : user.talkChannels?.length    ? user.talkChannels
                  : [payload.channel || user.channel];
    let chunk = payload.chunk;
    if (chunk && Buffer.isBuffer(chunk)) {
      chunk = chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength);
    }
    const seen = new Set();
    talkChs.forEach(ch => {
      const room = io.sockets.adapter.rooms.get(ch);
      if (!room) return;
      room.forEach(sid => {
        if (sid !== socket.id && !seen.has(sid)) {
          seen.add(sid);
          const dest = io.sockets.sockets.get(sid);
          if (dest) dest.emit("audio-chunk", { from: user.name, fromId: socket.id, channel: ch, chunk });
        }
      });
    });
  });

  socket.on("update-listen-channels", ({ listenChannels = [] }) => {
    const user = users.get(socket.id);
    if (!user) return;
    const old = user.listenChannels || [];
    old.forEach(ch => { if (!listenChannels.includes(ch) && ch !== user.channel) socket.leave(ch); });
    listenChannels.forEach(ch => { if (!old.includes(ch) && ch !== user.channel) socket.join(ch); });
    user.listenChannels = listenChannels;
  });

  socket.on("update-talk-channels", ({ talkChannels = [] }) => {
    const user = users.get(socket.id);
    if (user) user.talkChannels = talkChannels;
  });

  socket.on("call-ring", ({ channel, talkChannels }) => {
    const user = users.get(socket.id);
    if (!user) return;
    const ringChannels = talkChannels?.length ? talkChannels : [channel || user.channel];
    const targets = new Set();
    for (const [sid, u] of users) {
      if (sid === socket.id) continue;
      const listens = u.listenChannels || [];
      for (const ch of ringChannels) {
        if (u.channel === ch || listens.includes(ch)) { targets.add(sid); break; }
      }
    }
    targets.forEach(sid => {
      const s = io.sockets.sockets.get(sid);
      if (s) s.emit("call-ring", { from: user.name, fromId: socket.id, channel: ringChannels[0] });
    });
  });

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

  socket.on("disconnect", () => {
    const user = users.get(socket.id);
    if (user) {
      const ch = channels[user.channel];
      if (ch) ch.users.delete(socket.id);
      users.delete(socket.id);
      io.emit("user-left", { name: user.name, channel: user.channel });
      broadcastChannelState();
    }
    console.log(`[server] - ${socket.id}`);
  });
});

// ── Démarrage ─────────────────────────────────────────────────────────────────

httpServer.listen(PORT, BIND_IP, () => {
  const ip = getLocalIP();
  console.log(`[server] DewiCom Server v${VERSION} (${SERVER_MODE}) — ${SERVER_NAME}`);
  console.log(`[server] HTTP + WS → http://${BIND_IP}:${PORT}`);
  console.log(`[server] Réseau    → http://${ip}:${PORT}`);
  console.log(`[server] Fichiers  → ${PUBLIC_DIR}`);
  startAnnouncing(ip, PORT);
});

// ── Arrêt propre ──────────────────────────────────────────────────────────────

function shutdown() {
  console.log("[server] Arrêt propre...");
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT",  shutdown);
