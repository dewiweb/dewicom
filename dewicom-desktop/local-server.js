/**
 * Serveur local embarqué dans l'app desktop.
 * Toujours HTTPS (cert auto-signé) : getUserMedia requiert un secure context,
 * y compris pour les clients LAN qui se connectent via l'IP réseau.
 */

const http       = require("http");
const https      = require("https");
const path       = require("path");
const os         = require("os");
const dgram      = require("dgram");
const fs         = require("fs");
const selfsigned = require("selfsigned");

const { version: APP_VERSION } = require("./package.json");
const QRCode = require("qrcode");

const MCAST_ADDR = "224.0.0.251";
const MCAST_PORT = 9999;
const LOCAL_PORT = 3001;

// Public dir : process.resourcesPath/public (AppImage packagée), sinon ../shared/public (dev)
const PUBLIC_DIR = (() => {
  const candidates = [
    process.resourcesPath && path.join(process.resourcesPath, "public"),
    path.join(__dirname, "../shared/public"),
    path.join(__dirname, "public"),
  ].filter(Boolean);
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return path.join(__dirname, "../shared/public");
})();

let expressApp     = null;
let netServer      = null;  // http.Server ou https.Server selon le mode
let io             = null;
let announceSocket = null;
let announceTimer  = null;

// ── Logging centralisé — diffuse vers console ET clients monitor ───────────────
const LOG_BUFFER_MAX = 300;
const logBuffer      = [];
const monitorClients = new Set();

const _origLog   = console.log.bind(console);
const _origWarn  = console.warn.bind(console);
const _origError = console.error.bind(console);

function serverLog(level, msg) {
  const entry = { ts: Date.now(), level, msg };
  logBuffer.push(entry);
  if (logBuffer.length > LOG_BUFFER_MAX) logBuffer.shift();
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

// ── Audio stats ────────────────────────────────────────────────────────────────
const audioStats    = { chunks: 0, bytes: 0, activeSockets: new Set() };
let audioStatsTimer = null;

function getForcedInterface() {
  try {
    const { app } = require("electron");
    const configPath = path.join(app.getPath("userData"), "server-config.json");
    const saved = JSON.parse(fs.readFileSync(configPath, "utf8"));
    return saved.forcedInterface || null;
  } catch (e) { return null; }
}

function getLocalIP() {
  const forced = getForcedInterface();
  if (forced) return forced;
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
  if (candidates.length === 0) return "127.0.0.1";
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].address;
}

function startAnnouncing(ip, port, mode, protocol) {
  try {
    announceSocket = dgram.createSocket({ type: "udp4" });
    const payload = Buffer.from(JSON.stringify({
      service: "DewiCom", version: APP_VERSION,
      ip, port, protocol,
      mode,
    }));
    const send = () => {
      announceSocket.send(payload, 0, payload.length, MCAST_PORT, MCAST_ADDR, (err) => {
        if (err) console.warn("[local-server] Multicast error:", err.message);
      });
    };
    announceSocket.bind(() => {
      announceSocket.setMulticastTTL(4);
      send();
      announceTimer = setInterval(send, 1000);
      console.log(`[local-server] Annonces multicast → ${ip}:${port} (mode=${mode}, proto=${protocol})`);
    });
  } catch (e) {
    console.warn("[local-server] Impossible de démarrer les annonces multicast:", e.message);
  }
}

function stopAnnouncing() {
  if (announceTimer) { clearInterval(announceTimer); announceTimer = null; }
  if (announceSocket) { try { announceSocket.close(); } catch (e) {} announceSocket = null; }
}

/**
 * Démarre le serveur local embarqué.
 * Retourne une Promise<{url, ip, port, protocol}> quand le serveur est prêt.
 */
async function start(options = {}) {
    const modulesPath = path.join(__dirname, "node_modules");
    let express, socketIo;
    try {
      express  = require(path.join(modulesPath, "express"));
      socketIo = require(path.join(modulesPath, "socket.io")).Server;
    } catch (e) {
      try {
        express  = require("express");
        socketIo = require("socket.io").Server;
      } catch (e2) {
        throw new Error("express/socket.io non trouvés: " + e2.message);
      }
    }

    const mode     = options.mode || "desktop-local";
    let   protocol = "https";
    let   tlsCreds = null;

    try {
      let selfSigned;
      try { selfSigned = require(path.join(modulesPath, "selfsigned")); } catch (_) {}
      if (!selfSigned) selfSigned = require("selfsigned");
      // selfsigned v5 est async
      tlsCreds = await selfSigned.generate(
        [{ name: "commonName", value: "DewiCom-Desktop" }],
        {
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
        }
      );
      console.log("[local-server] Certificat TLS auto-signé généré");
    } catch (e) {
      console.warn("[local-server] selfsigned indisponible, repli sur HTTP:", e.message);
      protocol = "http";
    }

    expressApp = express();
    netServer  = tlsCreds
      ? https.createServer({ key: tlsCreds.private, cert: tlsCreds.cert }, expressApp)
      : http.createServer(expressApp);
    io = new socketIo(netServer, { cors: { origin: "*" } });

    // ── Routes ───────────────────────────────────────────────────────────────────
    expressApp.get("/api/dewicom-discovery", (req, res) => {
      res.json({ service: "DewiCom", version: APP_VERSION, mode, protocol });
    });

    expressApp.get("/monitor", (req, res) => {
      res.sendFile(path.join(PUBLIC_DIR, "monitor.html"));
    });

    expressApp.get("/api/status", (req, res) => {
      const connectedUsers = Array.from(users.values()).map(u => ({ name: u.name, channel: u.channel }));
      res.json({
        service: "DewiCom", version: APP_VERSION,
        mode, protocol,
        uptime: Math.floor(process.uptime()),
        users: connectedUsers, userCount: users.size,
      });
    });

    expressApp.get("/api/logs", (req, res) => {
      const limit = parseInt(req.query.limit || "100", 10);
      res.json(logBuffer.slice(-limit));
    });

    expressApp.get("/qr", async (req, res) => {
      const ip  = getLocalIP();
      const url = `${protocol}://${ip}:${LOCAL_PORT}`;
      try {
        const qr = await QRCode.toDataURL(url, { width: 300, margin: 2 });
        res.json({ qr, url });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    expressApp.use(express.static(PUBLIC_DIR));

    // ── État ─────────────────────────────────────────────────────────────────────
    const channels = {
      general: { name: "Général",  color: "#6b7280", users: new Map() },
      foh:     { name: "FOH Son",  color: "#3b82f6", users: new Map() },
      plateau: { name: "Plateau",  color: "#f97316", users: new Map() },
      lumiere: { name: "Lumière",  color: "#a855f7", users: new Map() },
      regie:   { name: "Régie",    color: "#22c55e", users: new Map() },
    };
    const users = new Map();

    function broadcastChannelState() {
      const state = {};
      for (const [id, ch] of Object.entries(channels)) {
        state[id] = { ...ch, users: Array.from(ch.users.values()).map(u => ({ id: u.socketId, name: u.name })) };
      }
      io.emit("channel-state", state);
    }

    function monitorState() {
      return {
        name: "Desktop",
        mode, version: APP_VERSION,
        uptime: Math.floor(process.uptime()),
        userCount: users.size, protocol,
      };
    }

    function startAudioStatsTimerLocal() {
      if (audioStatsTimer) return;
      audioStatsTimer = setInterval(() => {
        if (monitorClients.size === 0) return;
        const snap = { chunks: audioStats.chunks, bytes: audioStats.bytes, active: audioStats.activeSockets.size };
        audioStats.chunks = 0; audioStats.bytes = 0; audioStats.activeSockets.clear();
        for (const sid of monitorClients) {
          const s = io.sockets.sockets.get(sid);
          if (s) s.emit("audio-stats", snap);
        }
      }, 2000);
    }

    // ── Socket.io ────────────────────────────────────────────────────────────────
    io.on("connection", (socket) => {
      console.log(`[local-server] + connexion ${socket.id}`);

      socket.on("monitor-subscribe", () => {
        monitorClients.add(socket.id);
        startAudioStatsTimerLocal();
        socket.emit("monitor-state", monitorState());
        socket.emit("log-history", logBuffer.slice(-200));
        console.log(`[local-server] monitor-subscribe: ${socket.id}`);
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
        const ch = channels[channel] || channels.general;
        const user = { clientId, name, channel, listenChannels, talkChannels, socketId: socket.id };
        users.set(socket.id, user);
        ch.users.set(socket.id, user);
        socket.join(channel);
        listenChannels.forEach(chId => { if (chId !== channel) socket.join(chId); });
        broadcastChannelState();
        io.emit("user-joined", { name, channel });
        console.log(`[local-server] join: ${name} → ${channel} (${users.size} connecté(s))`);
      });

      socket.on("switch-channel", ({ channel }) => {
        const user = users.get(socket.id);
        if (!user) return;
        const oldCh = channels[user.channel];
        if (oldCh) oldCh.users.delete(socket.id);
        socket.leave(user.channel);
        const prevChannel = user.channel;
        const newCh = channels[channel] || channels.general;
        user.channel = channel;
        newCh.users.set(socket.id, user);
        socket.join(channel);
        broadcastChannelState();
        console.log(`[local-server] switch-channel: ${user.name} ${prevChannel} → ${channel}`);
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
        console.log(`[local-server] call-ring: ${user.name} → canaux [${ringChannels.join(",")}]`);
      });

      socket.on("ptt-start", ({ channel }) => {
        const user = users.get(socket.id);
        if (!user) return;
        socket.to(channel).emit("ptt-start", { from: user.name, fromId: socket.id });
        io.emit("ptt-state", { fromId: socket.id, from: user.name, channel, speaking: true });
        console.log(`[local-server] ptt-start: ${user.name} → ${channel}`);
      });

      socket.on("ptt-stop", ({ channel }) => {
        const user = users.get(socket.id);
        if (!user) return;
        socket.to(channel).emit("ptt-stop", { from: user.name, fromId: socket.id });
        io.emit("ptt-state", { fromId: socket.id, from: user.name, channel, speaking: false });
        console.log(`[local-server] ptt-stop: ${user.name} ← ${channel}`);
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
          console.log(`[local-server] - déconnexion: ${user.name} (${users.size} restant(s))`);
        } else {
          console.log(`[local-server] - déconnexion: ${socket.id}`);
        }
      });
    });

    // ── Démarrage ────────────────────────────────────────────────────────────────
    return new Promise((resolve, reject) => {
      netServer.listen(LOCAL_PORT, "0.0.0.0", () => {
        const ip         = getLocalIP();
        const localUrl   = `${protocol}://127.0.0.1:${LOCAL_PORT}`;
        const networkUrl = `${protocol}://${ip}:${LOCAL_PORT}`;
        console.log(`[local-server] Démarré (${protocol.toUpperCase()}) → ${localUrl}`);
        console.log(`[local-server] Réseau     → ${networkUrl}`);
        console.log(`[local-server] Monitoring → ${networkUrl}/monitor`);
        console.log(`[local-server] Fichiers   → ${PUBLIC_DIR}`);
        startAnnouncing(ip, LOCAL_PORT, mode, protocol);
        resolve({ url: localUrl, ip, port: LOCAL_PORT, protocol });
      });
      netServer.on("error", reject);
    });
}

function notifyRedirect(newUrl) {
  if (io) io.emit("server-redirect", newUrl);
}

function stop() {
  stopAnnouncing();
  if (audioStatsTimer) { clearInterval(audioStatsTimer); audioStatsTimer = null; }
  if (netServer) { netServer.close(); netServer = null; }
  if (io) { io.close(); io = null; }
}

module.exports = { start, stop, notifyRedirect };
