const { app, BrowserWindow, ipcMain, session } = require("electron");
const dgram = require("dgram");
const path = require("path");
const os = require("os");

// Évite le crash EPIPE quand stdout/stderr est un pipe cassé (AppImage lancée sans terminal)
process.stdout.on("error", (e) => { if (e.code === "EPIPE") process.exit(0); });
process.stderr.on("error", (e) => { if (e.code === "EPIPE") process.exit(0); });
process.on("uncaughtException", (e) => { if (e.code === "EPIPE") return; throw e; });

const localServer = require("./local-server");
const { LeaderElection, getLocalIP } = require("./leader-election");
const { version: APP_VERSION } = require("./package.json");

let localServerRunning = false;
let rediscoveryTimer = null;
let leaderElection = null;

const MCAST_ADDR = "224.0.0.251";
const MCAST_PORT = 9999;
const LISTEN_TIMEOUT_MS = 3000;
const SCAN_TIMEOUT_MS = 600;
const SCAN_TIMEOUT_HTTPS_MS = 1200;
const DEWICOM_PORT = 3001;

let mainWindow = null;
let tray = null;
let discoveredServer = null;
let announceSocket = null;
let announceTimer = null;

// ── Création de la fenêtre principale ────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 420,
    height: 760,
    minWidth: 360,
    minHeight: 600,
    title: "DewiCom",
    backgroundColor: "#1a1a2e",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
    icon: path.join(__dirname, "assets", "icon.png"),
  });

  // Charge la page de chargement pendant la découverte
  mainWindow.loadFile(path.join(__dirname, "loading.html"));

  mainWindow.on("closed", () => { mainWindow = null; });
}

// ── Découverte multicast UDP ─────────────────────────────────────────────────
function listenMulticast(ignoreIP = null) {
  return new Promise((resolve) => {
    const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });

    const timer = setTimeout(() => {
      socket.close();
      resolve(null);
    }, LISTEN_TIMEOUT_MS);

    socket.on("message", (msg) => {
      try {
        const data = JSON.parse(msg.toString("utf8"));
        if (data.service === "DewiCom" && data.ip && data.port && data.mode !== "apk") {
          if (ignoreIP && data.ip === ignoreIP) return; // ignore nos propres annonces
          clearTimeout(timer);
          socket.close();
          console.log(`[multicast] Serveur trouvé: ${data.ip}:${data.port}`);
          resolve({ ip: data.ip, port: data.port, protocol: data.protocol || "http" });
        }
      } catch (e) { /* ignore parse errors */ }
    });

    socket.on("error", () => { clearTimeout(timer); socket.close(); resolve(null); });

    socket.bind(MCAST_PORT, () => {
      try {
        socket.addMembership(MCAST_ADDR);
        console.log(`[multicast] Écoute ${MCAST_ADDR}:${MCAST_PORT} pendant ${LISTEN_TIMEOUT_MS}ms...`);
      } catch (e) {
        console.warn("[multicast] Impossible de rejoindre le groupe:", e.message);
        clearTimeout(timer);
        socket.close();
        resolve(null);
      }
    });
  });
}

// ── Scan HTTP parallèle (fallback) ───────────────────────────────────────────
function getLocalSubnet() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces) {
      if (iface.family === "IPv4" && !iface.internal) {
        const parts = iface.address.split(".");
        return { subnet: parts.slice(0, 3).join("."), lastOctet: parseInt(parts[3]), ownIP: iface.address };
      }
    }
  }
  return { subnet: "192.168.1", lastOctet: 1, ownIP: "127.0.0.1" };
}

function checkServer(ip, port) {
  // Essaie HTTP puis HTTPS (cert auto-signé accepté)
  return new Promise((resolve) => {
    const tryProto = (useHttps) => {
      const mod = useHttps ? require("https") : require("http");
      const opts = {
        hostname: ip, port,
        path: "/api/dewicom-discovery",
        timeout: useHttps ? SCAN_TIMEOUT_HTTPS_MS : SCAN_TIMEOUT_MS,
        rejectUnauthorized: false, // accepte les certs auto-signés
      };
      const req = mod.get(opts, (res) => {
        let body = "";
        res.on("data", (d) => body += d);
        res.on("end", () => {
          try {
            const data = JSON.parse(body);
            // Ignore les serveurs APK — le desktop ne peut pas s'y connecter via Socket.io
            if (data.service === "DewiCom" && data.mode !== "apk") {
              resolve({ ip, protocol: useHttps ? "https" : "http" });
              return;
            }
          } catch (e) {}
          if (!useHttps) tryProto(true); else resolve(null);
        });
      });
      req.on("error", () => { if (!useHttps) tryProto(true); else resolve(null); });
      req.on("timeout", () => { req.destroy(); if (!useHttps) tryProto(true); else resolve(null); });
    };
    tryProto(false);
  });
}

function buildPriorityList(subnet, lastOctet) {
  const added = new Set();
  const list = [];

  // IPs proches du device (±10)
  for (let d = -10; d <= 10; d++) {
    const i = lastOctet + d;
    if (i >= 1 && i <= 254 && i !== lastOctet) { list.push(i); added.add(i); }
  }
  // IPs communes
  for (const i of [1, 2, 3, 10, 20, 50, 100, 150, 200, 254, 253]) {
    if (!added.has(i)) { list.push(i); added.add(i); }
  }
  // Reste
  for (let i = 1; i <= 254; i++) {
    if (!added.has(i) && i !== lastOctet) list.push(i);
  }
  return list.map((i) => `${subnet}.${i}`);
}

async function scanSubnet(port) {
  const { subnet, lastOctet } = getLocalSubnet();
  const candidates = buildPriorityList(subnet, lastOctet);
  console.log(`[scan] Scan de ${candidates.length} IPs sur ${subnet}.x...`);

  const BATCH = 50;
  for (let i = 0; i < candidates.length; i += BATCH) {
    const batch = candidates.slice(i, i + BATCH);
    const results = await Promise.all(batch.map((ip) => checkServer(ip, port)));
    const found = results.find((r) => r !== null);
    if (found) {
      console.log(`[scan] Serveur trouvé: ${found.ip} (${found.protocol})`);
      return { ip: found.ip, port, protocol: found.protocol };
    }
  }
  return null;
}

// ── Découverte via élection de leader ─────────────────────────────────────────
async function discoverServer() {
  sendToWindow("discovery-status", "Démarrage serveur local...");

  // Démarre toujours le serveur local (le leader prend le relais via l'élection)
  try {
    const loc = await localServer.start();
    localServerRunning = true;
    console.log(`[discovery] Serveur local démarré: ${loc.url} (réseau: ${loc.ip}:${loc.port})`);
    sendToWindow("discovery-status", `Serveur local démarré — ${loc.ip}:${loc.port}`);
  } catch (e) {
    console.error("[discovery] Impossible de démarrer le serveur local:", e.message);
    sendToWindow("discovery-status", "Erreur serveur local: " + e.message);
    return null;
  }

  // Lance l'élection — résolu asynchroniquement via les callbacks
  return new Promise((resolve) => {
    leaderElection = new LeaderElection({
      onBecomeLeader: (myIP) => {
        console.log(`[election] LEADER élu: ${myIP} — serveur local actif`);
        sendToWindow("discovery-status", `Leader — serveur actif sur ${myIP}:3001`);
        resolve({ ip: "127.0.0.1", port: 3001, protocol: "http" });
      },
      onLeaderElected: async (leaderIP) => {
        console.log(`[election] FOLLOWER — leader: ${leaderIP}`);
        sendToWindow("discovery-status", `Follower — leader: ${leaderIP}:3001`);
        localServer.stop();
        localServerRunning = false;
        // Détecte le protocole réel du leader (HTTP local ou HTTPS standalone)
        const detected = await checkServer(leaderIP, 3001);
        const protocol = detected?.protocol || "http";
        const url = `${protocol}://${leaderIP}:3001`;
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(url);
        resolve({ ip: leaderIP, port: 3001, protocol });
      },
    });
    leaderElection.start();
  });
}

// ── Annonce multicast (si l'app desktop héberge un serveur) ──────────────────
function startAnnouncing(ip, port) {
  announceSocket = dgram.createSocket({ type: "udp4" });
  const payload = Buffer.from(JSON.stringify({
    service: "DewiCom", version: APP_VERSION,
    ip, port, protocol: "http"
  }));

  const send = () => {
    announceSocket.send(payload, 0, payload.length, MCAST_PORT, MCAST_ADDR);
  };

  announceSocket.bind(() => {
    announceSocket.setMulticastTTL(4);
    send();
    announceTimer = setInterval(send, 2000);
    console.log(`[announce] Annonces multicast démarrées: ${ip}:${port}`);
  });
}

function stopAnnouncing() {
  if (announceTimer) { clearInterval(announceTimer); announceTimer = null; }
  if (announceSocket) { try { announceSocket.close(); } catch (e) {} announceSocket = null; }
}

// ── IPC helpers ───────────────────────────────────────────────────────────────
function sendToWindow(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

// ── IPC handlers (depuis le preload/renderer) ─────────────────────────────────
ipcMain.handle("get-server-url", () => {
  if (!discoveredServer) return null;
  const { ip, port, protocol } = discoveredServer;
  return `${protocol}://${ip}:${port}`;
});

ipcMain.handle("rediscover", async () => {
  discoveredServer = await discoverServer();
  if (discoveredServer && mainWindow) {
    const { ip, port, protocol } = discoveredServer;
    setTimeout(() => mainWindow.loadURL(`${protocol}://${ip}:${port}`), 500);
  }
  return discoveredServer;
});

// ── Lifecycle ─────────────────────────────────────────────────────────────────

// Avant app.whenReady : lit la dernière origine connue et l'autorise comme secure context.
// Cela permet à getUserMedia de fonctionner sur http://192.168.x.y:3001 dès le 2ème lancement.
// Au premier lancement, seul localhost est autorisé (suffisant si serveur = même machine).
{
  const fs = require("fs");
  const configPath = path.join(app.getPath("userData"), "server-config.json");
  let origins = ["http://127.0.0.1:3001", "http://127.0.0.1:3002"];
  try {
    const saved = JSON.parse(fs.readFileSync(configPath, "utf8"));
    if (saved.origin) origins.push(saved.origin);
  } catch (e) { /* premier lancement */ }
  app.commandLine.appendSwitch("unsafely-treat-insecure-origin-as-secure", origins.join(","));
  console.log("[startup] Origines sécurisées:", origins.join(", "));
}

app.on("certificate-error", (event, webContents, url, error, certificate, callback) => {
  event.preventDefault();
  callback(true);
});

app.whenReady().then(async () => {
  const { session: ses } = require("electron");

  // Bypass SSL pour certs auto-signés et mkcert
  ses.defaultSession.setCertificateVerifyProc((request, callback) => {
    callback(0);
  });

  createWindow();

  // Découverte en arrière-plan pendant que la fenêtre de chargement s'affiche
  discoveredServer = await discoverServer();

  if (discoveredServer) {
    const { ip, port, protocol } = discoveredServer;
    const url = `${protocol}://${ip}:${port}`;
    const origin = `${protocol}://${ip}:${port}`;

    setupMediaPermissions(origin);
    console.log(`[app] Chargement: ${url}`);
    if (mainWindow) mainWindow.loadURL(url);
  } else {
    // Aucun serveur → charge la page d'erreur avec option de relancer
    if (mainWindow) mainWindow.loadFile(path.join(__dirname, "no-server.html"));
  }
});

/**
 * Configure les permissions de la session pour autoriser micro/caméra
 * sur l'origine du serveur DewiCom, même en HTTP.
 */
function setupMediaPermissions(origin) {
  // Relaunch avec le bon switch si l'origine est HTTP
  // (commandLine doit être set avant app.ready, donc on le fait au prochain lancement
  //  mais on force aussi via permissionRequestHandler pour la session courante)
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const url = webContents.getURL();
    if (permission === "media" || permission === "microphone" || permission === "camera") {
      // Autorise si c'est notre serveur DewiCom ou localhost
      const allowed = url.startsWith(origin)
        || url.includes("127.0.0.1")
        || url.includes("localhost")
        || url.startsWith("file://");
      console.log(`[permissions] ${permission} sur ${url} → ${allowed ? "autorisé" : "refusé"}`);
      callback(allowed);
    } else {
      callback(true);
    }
  });

  // Persiste l'origine pour le prochain démarrage via un fichier de config
  const fs = require("fs");
  const configPath = path.join(app.getPath("userData"), "server-config.json");
  try {
    fs.writeFileSync(configPath, JSON.stringify({ origin }), "utf8");
  } catch (e) {}
}

app.on("window-all-closed", () => {
  stopAnnouncing();
  if (leaderElection) { leaderElection.stop(); leaderElection = null; }
  if (rediscoveryTimer) { clearInterval(rediscoveryTimer); rediscoveryTimer = null; }
  if (localServerRunning) localServer.stop();
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on("quit", () => {
  stopAnnouncing();
  if (leaderElection) { leaderElection.stop(); leaderElection = null; }
  if (rediscoveryTimer) { clearInterval(rediscoveryTimer); rediscoveryTimer = null; }
  if (localServerRunning) localServer.stop();
});
