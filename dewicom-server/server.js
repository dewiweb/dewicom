/**
 * DewiCom Server — serveur intercom standalone.
 * Tourne en Node.js pur (pas d'Electron), packagable en Docker ou lancé sur RPi/PC dédié.
 * Compatible avec tous les clients : APK Android, Desktop Electron, navigateur.
 *
 * Variables d'environnement :
 *   PORT          Port HTTPS + WebSocket (défaut : 3001)
 *   BIND_IP       IP d'écoute (défaut : 0.0.0.0)
 *   SERVER_MODE   Mode annoncé aux clients : "docker" | "dedicated" (défaut : "dedicated")
 *   SERVER_NAME   Nom affiché dans les clients (défaut : hostname)
 */

const https      = require("https");
const path       = require("path");
const os         = require("os");
const dgram      = require("dgram");
const fs         = require("fs");
const selfsigned = require("selfsigned");

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

// ── Certificat TLS auto-signé (selfsigned v5 = async) ────────────────────────
// getUserMedia requiert un secure context (HTTPS ou localhost).
// Le cert auto-signé est accepté par Electron (setCertificateVerifyProc)
// et par l'APK Android (SSLConfigurator + onReceivedSslError).
// Pour les navigateurs desktop : acceptation manuelle une seule fois.
const TLS_ATTRS = [{ name: "commonName", value: "DewiCom" }];
const TLS_OPTS  = {
  days: 3650,
  algorithm: "sha256",
  extensions: [
    { name: "subjectAltName", altNames: [
      { type: 2, value: "dewicom.local" },
      { type: 7, ip: "0.0.0.0" },
    ]},
    { name: "basicConstraints", cA: false },
    { name: "keyUsage", keyCertSign: false, digitalSignature: true, keyEncipherment: true },
    { name: "extKeyUsage", serverAuth: true },
  ],
};

// ── Logging centralisé — diffuse vers console ET clients monitor ───────────────
const LOG_BUFFER_MAX = 500;
const logBuffer      = [];       // historique des logs
const monitorClients = new Set(); // socket IDs abonnés au monitoring
let io = null; // déclaré ici pour que serverLog() y ait accès depuis n'importe où

const _origLog   = console.log.bind(console);
const _origWarn  = console.warn.bind(console);
const _origError = console.error.bind(console);

function serverLog(level, msg) {
  const entry = { ts: Date.now(), level, msg };
  logBuffer.push(entry);
  if (logBuffer.length > LOG_BUFFER_MAX) logBuffer.shift();
  // Broadcast aux clients monitor abonnés
  if (io) {
    for (const sid of monitorClients) {
      const s = io.sockets.sockets.get(sid);
      if (s) s.emit("server-log", entry);
    }
  }
}

console.log   = (...a) => { const m = a.map(x => typeof x === "object" ? JSON.stringify(x) : String(x)).join(" "); _origLog(m);   serverLog("info",  m); };
console.warn  = (...a) => { const m = a.map(x => typeof x === "object" ? JSON.stringify(x) : String(x)).join(" "); _origWarn(m);  serverLog("warn",  m); };
console.error = (...a) => { const m = a.map(x => typeof x === "object" ? JSON.stringify(x) : String(x)).join(" "); _origError(m); serverLog("error", m); };

// ── Audio stats (mis à jour par le handler audio-chunk) ───────────────────────
const audioStats = { chunks: 0, bytes: 0, activeSockets: new Set() };
let audioStatsTimer = null;

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
      protocol: "https",           // HTTPS désormais
      mode: SERVER_MODE,
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
      setInterval(send, 1000);
      console.log(`[server] Annonces multicast → ${ip}:${port} (mode=${SERVER_MODE}, proto=https)`);
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

// ── Démarrage asynchrone (selfsigned v5 retourne une Promise) ─────────────────
(async () => {
const tlsPems   = await selfsigned.generate(TLS_ATTRS, TLS_OPTS);
_origLog("[server] Certificat TLS auto-signé généré (valide 10 ans)");

// ── Serveur HTTPS + Socket.io ─────────────────────────────────────────────────

const app         = express();
const httpsServer = https.createServer({ key: tlsPems.private, cert: tlsPems.cert }, app);
io                = new socketIo(httpsServer, { cors: { origin: "*" } });

// ── Routes ────────────────────────────────────────────────────────────────────

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
    name: u.name, channel: u.channel,
  }));
  res.json({
    service: "DewiCom", version: VERSION,
    mode: SERVER_MODE, name: SERVER_NAME,
    uptime: Math.floor(process.uptime()),
    users: connectedUsers,
    channelCount: Object.keys(channels).length,
    userCount: users.size,
  });
});

app.get("/api/logs", (req, res) => {
  const limit = parseInt(req.query.limit || "100", 10);
  res.json(logBuffer.slice(-limit));
});

app.get("/qr", async (req, res) => {
  const ip  = getLocalIP();
  const url = `https://${ip}:${PORT}`;
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
    userCount: users.size,
    protocol: "https",
  };
}

// Démarre le timer broadcast audio stats vers les clients monitor
function startAudioStatsTimer() {
  if (audioStatsTimer) return;
  audioStatsTimer = setInterval(() => {
    if (monitorClients.size === 0) return;
    const snap = {
      chunks: audioStats.chunks,
      bytes:  audioStats.bytes,
      active: audioStats.activeSockets.size,
    };
    audioStats.chunks = 0;
    audioStats.bytes  = 0;
    audioStats.activeSockets.clear();
    for (const sid of monitorClients) {
      const s = io.sockets.sockets.get(sid);
      if (s) s.emit("audio-stats", snap);
    }
  }, 2000);
}

io.on("connection", (socket) => {
  console.log(`[server] + connexion ${socket.id}`);

  socket.on("monitor-subscribe", () => {
    monitorClients.add(socket.id);
    startAudioStatsTimer();
    socket.emit("monitor-state", monitorState());
    // Envoie l'historique des logs au nouvel abonné
    socket.emit("log-history", logBuffer.slice(-200));
    console.log(`[server] monitor-subscribe: ${socket.id} (${monitorClients.size} abonnés)`);
  });

  socket.emit("channels-init", Object.entries(channels).map(([id, ch]) => ({
    id, name: ch.name, color: ch.color,
  })));

  socket.on("join", ({ clientId, name, channel, listenChannels = [], talkChannels = [] }) => {
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
    console.log(`[server] join: ${name} → ${channel} (${users.size} connecté(s))`);
  });

  socket.on("switch-channel", ({ channel }) => {
    const user = users.get(socket.id);
    if (!user) return;
    const oldCh = channels[user.channel];
    if (oldCh) oldCh.users.delete(socket.id);
    socket.leave(user.channel);
    const newCh = channels[channel] || channels.general;
    const prevChannel = user.channel;
    user.channel = channel;
    newCh.users.set(socket.id, user);
    socket.join(channel);
    broadcastChannelState();
    console.log(`[server] switch-channel: ${user.name} ${prevChannel} → ${channel}`);
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
    // Comptabilise les stats audio
    audioStats.chunks++;
    audioStats.bytes += chunk?.byteLength || 0;
    audioStats.activeSockets.add(socket.id);

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
    console.log(`[server] call-ring: ${user.name} → canaux [${ringChannels.join(",")}]`);
  });

  socket.on("ptt-start", ({ channel }) => {
    const user = users.get(socket.id);
    if (!user) return;
    socket.to(channel).emit("ptt-start", { from: user.name, fromId: socket.id });
    io.emit("ptt-state", { fromId: socket.id, from: user.name, channel, speaking: true });
    console.log(`[server] ptt-start: ${user.name} → ${channel}`);
  });

  socket.on("ptt-stop", ({ channel }) => {
    const user = users.get(socket.id);
    if (!user) return;
    socket.to(channel).emit("ptt-stop", { from: user.name, fromId: socket.id });
    io.emit("ptt-state", { fromId: socket.id, from: user.name, channel, speaking: false });
    console.log(`[server] ptt-stop: ${user.name} ← ${channel}`);
  });

  socket.on("disconnect", () => {
    monitorClients.delete(socket.id);
    const user = users.get(socket.id);
    if (user) {
      const ch = channels[user.channel];
      if (ch) ch.users.delete(socket.id);
      users.delete(socket.id);
      io.emit("user-left", { name: user.name, channel: user.channel });
      broadcastChannelState();
      console.log(`[server] - déconnexion: ${user.name} (${users.size} connecté(s) restant(s))`);
    } else {
      console.log(`[server] - déconnexion: ${socket.id}`);
    }
  });
});

// ── Démarrage ─────────────────────────────────────────────────────────────────

httpsServer.listen(PORT, BIND_IP, () => {
  const ip = getLocalIP();
  console.log(`[server] DewiCom Server v${VERSION} (${SERVER_MODE}) — ${SERVER_NAME}`);
  console.log(`[server] HTTPS + WSS → https://${BIND_IP}:${PORT}`);
  console.log(`[server] Réseau      → https://${ip}:${PORT}`);
  console.log(`[server] Monitoring  → https://${ip}:${PORT}/monitor`);
  console.log(`[server] Fichiers    → ${PUBLIC_DIR}`);
  startAnnouncing(ip, PORT);
});

// ── Arrêt propre ──────────────────────────────────────────────────────────────

function shutdown() {
  console.log("[server] Arrêt propre...");
  if (audioStatsTimer) { clearInterval(audioStatsTimer); audioStatsTimer = null; }
  httpsServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT",  shutdown);

})().catch(e => { console.error("[server] Erreur fatale au démarrage:", e.message); process.exit(1); });
