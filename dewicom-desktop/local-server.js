/**
 * Serveur local embarqué dans l'app desktop.
 * Lance un serveur HTTP + Socket.io sur localhost:3001 quand aucun
 * serveur DewiCom n'est trouvé sur le LAN.
 * Pas de SSL → localhost est toujours un secure context → micro fonctionne.
 */

const http = require("http");
const path = require("path");
const os = require("os");
const dgram = require("dgram");
const fs = require("fs");

const MCAST_ADDR = "224.0.0.251";
const MCAST_PORT = 9999;
const LOCAL_PORT = 3001;

// Public dir : shared/public/ (source unique), fallback public/ local (AppImage embarqué)
const PUBLIC_DIR = (() => {
  const candidates = [
    path.join(__dirname, "../shared/public"),
    path.join(__dirname, "public"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return path.join(__dirname, "../shared/public");
})();

let expressApp = null;
let httpServer = null;
let io = null;
let announceSocket = null;
let announceTimer = null;

function getLocalIP() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces) {
      if (iface.family === "IPv4" && !iface.internal) return iface.address;
    }
  }
  return "127.0.0.1";
}

function startAnnouncing(ip, port) {
  try {
    announceSocket = dgram.createSocket({ type: "udp4" });
    const payload = Buffer.from(JSON.stringify({
      service: "DewiCom", version: "1.0.0",
      ip, port, protocol: "http",
    }));
    const send = () => {
      announceSocket.send(payload, 0, payload.length, MCAST_PORT, MCAST_ADDR, (err) => {
        if (err) console.warn("[local-server] Multicast error:", err.message);
      });
    };
    announceSocket.bind(() => {
      announceSocket.setMulticastTTL(4);
      send();
      announceTimer = setInterval(send, 2000);
      console.log(`[local-server] Annonces multicast → ${ip}:${port}`);
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
 * Retourne une Promise<{url, ip, port}> quand le serveur est prêt.
 */
function start() {
  return new Promise((resolve, reject) => {
    // Charge express et socket.io depuis le dossier dewicom existant
    const dewicomModules = path.join(__dirname, "../dewicom/node_modules");
    const localModules = path.join(__dirname, "node_modules");
    const modulesPath = fs.existsSync(dewicomModules) ? dewicomModules : localModules;

    let express, socketIo;
    try {
      express = require(path.join(modulesPath, "express"));
      socketIo = require(path.join(modulesPath, "socket.io")).Server;
    } catch (e) {
      // Fallback: essaie require direct
      try {
        express = require("express");
        socketIo = require("socket.io").Server;
      } catch (e2) {
        return reject(new Error("express/socket.io non trouvés: " + e2.message));
      }
    }

    expressApp = express();
    httpServer = http.createServer(expressApp);
    io = new socketIo(httpServer, { cors: { origin: "*" } });

    // ── Routes ──────────────────────────────────────────────────────────────
    expressApp.get("/api/dewicom-discovery", (req, res) => {
      res.json({ service: "DewiCom", version: "1.0.0", mode: "desktop-local" });
    });

    expressApp.use(express.static(PUBLIC_DIR));

    // ── State (identique au vrai serveur index.js) ───────────────────────────
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

    // ── Socket.io (événements identiques au vrai serveur) ────────────────────
    io.on("connection", (socket) => {
      console.log(`[local-server] + ${socket.id}`);

      socket.emit("channels-init", Object.entries(channels).map(([id, ch]) => ({
        id, name: ch.name, color: ch.color,
      })));

      socket.on("join", ({ name, channel, listenChannels = [], talkChannels = [] }) => {
        const ch = channels[channel] || channels.general;
        const user = { name, channel, listenChannels, talkChannels, socketId: socket.id };
        users.set(socket.id, user);
        ch.users.set(socket.id, user);
        socket.join(channel);
        listenChannels.forEach(chId => { if (chId !== channel) socket.join(chId); });
        broadcastChannelState();
        io.emit("user-joined", { name, channel });
        console.log(`[local-server] join: ${name} → ${channel}`);
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
        const talkChs = user.talkChannels?.length ? user.talkChannels : [payload.channel || user.channel];
        let chunk = payload.chunk;
        if (chunk && Buffer.isBuffer(chunk)) {
          chunk = chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength);
        }
        talkChs.forEach(ch => {
          const room = io.sockets.adapter.rooms.get(ch);
          const recipients = room ? room.size - 1 : 0;
          if (recipients === 0) console.log(`[audio-chunk] ${user.name} → ${ch}: AUCUN destinataire (rooms: ${[...io.sockets.adapter.rooms.keys()].join(',')})`);
          socket.to(ch).emit("audio-chunk", { from: user.name, fromId: socket.id, channel: ch, chunk });
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

      socket.on("call-ring", ({ channel }) => {
        const user = users.get(socket.id);
        if (!user) return;
        // Envoie au canal de l'appelant + tous les clients qui écoutent ce canal (listenChannels)
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
        console.log(`[local-server] - ${socket.id}`);
      });
    });

    // ── Démarrage ────────────────────────────────────────────────────────────
    httpServer.listen(LOCAL_PORT, "0.0.0.0", () => {
      const ip = getLocalIP();
      console.log(`[local-server] Démarré → http://127.0.0.1:${LOCAL_PORT} (réseau: http://${ip}:${LOCAL_PORT})`);
      console.log(`[local-server] Fichiers publics: ${PUBLIC_DIR}`);

      startAnnouncing(ip, LOCAL_PORT);

      resolve({ url: `http://127.0.0.1:${LOCAL_PORT}`, ip, port: LOCAL_PORT, protocol: "http" });
    });

    httpServer.on("error", reject);
  });
}

function stop() {
  stopAnnouncing();
  if (httpServer) { httpServer.close(); httpServer = null; }
  if (io) { io.close(); io = null; }
}

module.exports = { start, stop };
