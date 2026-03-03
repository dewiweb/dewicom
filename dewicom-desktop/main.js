const { app, BrowserWindow, ipcMain, session, Menu } = require("electron");
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
let serverWatchdogTimer = null;  // surveille la connexion au serveur externe (docker/dedicated)
let serverWatchdogFailures = 0;

const SERVER_WATCHDOG_INTERVAL_MS = 5000;  // poll toutes les 5s
const SERVER_WATCHDOG_MAX_FAILURES = 2;    // 2 échecs consécutifs → failover (~10s)

// ── Mode --server : bypass élection, démarre directement comme serveur dédié ──
const SERVER_MODE   = process.argv.includes("--server");
const HEADLESS_MODE = process.argv.includes("--headless");

const MCAST_ADDR = "224.0.0.251";
const MCAST_PORT = 9999;
const LISTEN_TIMEOUT_MS = 3000;
const SCAN_TIMEOUT_MS = 600;
const SCAN_TIMEOUT_HTTPS_MS = 1200;
const DEWICOM_PORT = 3001;

let mainWindow = null;
let settingsWindow = null;
let tray = null;
let discoveredServer = null;
let announceSocket = null;
let announceTimer = null;

// ── Liste des interfaces réseau disponibles ──────────────────────────────────
function listNetworkInterfaces() {
  const result = [];
  for (const [name, ifaces] of Object.entries(os.networkInterfaces())) {
    for (const iface of ifaces) {
      if (iface.family !== "IPv4" || iface.internal) continue;
      if (iface.address.startsWith("169.254.")) continue;
      result.push({ name, address: iface.address });
    }
  }
  return result;
}

// ── Création de la fenêtre principale ────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 420,
    height: 760,
    minWidth: 360,
    minHeight: 600,
    title: "DewiCom",
    backgroundColor: "#1a1a2e",
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
    icon: path.join(__dirname, "assets", "icon.png"),
  });
  Menu.setApplicationMenu(null);

  if (app.isPackaged) {
    mainWindow.webContents.on("before-input-event", (event, input) => {
      if (
        input.key === "F12" ||
        (input.control && input.shift && input.key === "I") ||
        (input.control && input.shift && input.key === "J") ||
        (input.control && input.key === "R") ||
        (input.control && input.key === "F5")
      ) {
        event.preventDefault();
      }
    });
  }

  // Charge la page de chargement pendant la découverte
  mainWindow.loadFile(path.join(__dirname, "loading.html"));

  mainWindow.on("closed", () => { mainWindow = null; });
}

// Priorité des modes serveur : docker et dedicated > desktop-local > bully
const SERVER_MODE_PRIORITY = { docker: 3, dedicated: 2, "desktop-local": 1, apk: 0 };

// ── Découverte multicast UDP ─────────────────────────────────────────────
function listenMulticast(ignoreIP = null) {
  return new Promise((resolve) => {
    const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
    let best = null; // meilleur serveur trouvé jusqu'à maintenant

    const timer = setTimeout(() => {
      socket.close();
      resolve(best); // retourne le meilleur même si pas prioritaire
    }, LISTEN_TIMEOUT_MS);

    socket.on("message", (msg) => {
      try {
        const data = JSON.parse(msg.toString("utf8"));
        if (data.service !== "DewiCom" || !data.ip || !data.port) return;
        if (data.mode === "apk") return; // les APK ne servent pas les Desktop
        if (ignoreIP && data.ip === ignoreIP) return; // ignore nos propres annonces

        const priority = SERVER_MODE_PRIORITY[data.mode] ?? 1;
        const bestPriority = SERVER_MODE_PRIORITY[best?.mode] ?? 0;

        if (priority > bestPriority) {
          best = { ip: data.ip, port: data.port, protocol: data.protocol || "http", mode: data.mode };
          console.log(`[multicast] Serveur trouvé: ${data.ip}:${data.port} (mode=${data.mode}, priorité=${priority})`);
        }

        // Serveur dédié/docker : priorité max — résolution immédiate sans attendre la fin du timeout
        if (priority >= 2) {
          clearTimeout(timer);
          socket.close();
          resolve(best);
        }
      } catch (e) { /* ignore parse errors */ }
    });

    socket.on("error", () => { clearTimeout(timer); socket.close(); resolve(best); });

    socket.bind(MCAST_PORT, "0.0.0.0", () => {
      try {
        const localIP = getLocalIP();
        try { socket.addMembership(MCAST_ADDR, localIP); } catch (e) {
          socket.addMembership(MCAST_ADDR);
        }
        console.log(`[multicast] Écoute ${MCAST_ADDR}:${MCAST_PORT} pendant ${LISTEN_TIMEOUT_MS}ms...`);
      } catch (e) {
        console.warn("[multicast] Impossible de rejoindre le groupe:", e.message);
        clearTimeout(timer);
        socket.close();
        resolve(best);
      }
    });
  });
}

// ── Scan HTTP parallèle (fallback) ───────────────────────────────────────────
function getLocalSubnet() {
  const candidates = [];
  for (const [name, ifaces] of Object.entries(os.networkInterfaces())) {
    for (const iface of ifaces) {
      if (iface.family !== "IPv4" || iface.internal) continue;
      if (iface.address.startsWith("169.254.")) continue; // APIPA
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
  if (candidates.length === 0) return { subnet: "192.168.1", lastOctet: 1, ownIP: "127.0.0.1" };
  candidates.sort((a, b) => b.score - a.score);
  const parts = candidates[0].address.split(".");
  return { subnet: parts.slice(0, 3).join("."), lastOctet: parseInt(parts[3]), ownIP: candidates[0].address };
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

// ── Mode serveur dédié (--server) : bypass élection totale ──────────────────
async function startDedicatedServer() {
  console.log("[server-mode] Démarrage en mode serveur dédié (--server)");
  sendToWindow("discovery-status", "Vérification serveur dédié existant...");

  // Écoute 2s : si un autre serveur dédié/docker existe déjà sur le LAN, s'y connecter
  const existing = await listenMulticast(getLocalIP());
  if (existing && existing.mode && SERVER_MODE_PRIORITY[existing.mode] >= 2) {
    console.log(`[server-mode] Serveur dédié existant détecté: ${existing.ip}:${existing.port} (mode=${existing.mode}) — connexion client`);
    sendToWindow("discovery-status", `Serveur dédié trouvé — connexion à ${existing.ip}:${existing.port}`);
    return existing;
  }

  // Aucun serveur dédié → on démarre le nôtre
  sendToWindow("discovery-status", "Démarrage serveur dédié...");
  try {
    const loc = await localServer.start({ mode: "dedicated" });
    localServerRunning = true;
    console.log(`[server-mode] Serveur dédié actif → ${loc.url} (réseau: ${loc.ip}:${loc.port})`);
    sendToWindow("discovery-status", `Serveur dédié actif — ${loc.ip}:${loc.port}`);
    return { ip: "127.0.0.1", port: loc.port, protocol: "http" };
  } catch (e) {
    // Port occupé ou autre erreur — tentative de découverte fallback
    console.warn("[server-mode] Impossible de démarrer le serveur dédié:", e.message, "— fallback découverte LAN");
    sendToWindow("discovery-status", "Port occupé — recherche serveur sur le LAN...");
    const fallback = await listenMulticast(getLocalIP());
    if (fallback) return fallback;
    return null;
  }
}

// ── Découverte via élection de leader ─────────────────────────────────────────
async function discoverServer() {
  sendToWindow("discovery-status", "Élection du serveur en cours...");

  // Élection d'abord — le serveur ne démarre QUE si on gagne
  let resolved = false;
  return new Promise((resolve) => {
    leaderElection = new LeaderElection({
      onBecomeLeader: async (myIP) => {
        console.log(`[election] LEADER élu: ${myIP} — démarrage serveur local`);
        sendToWindow("discovery-status", `Leader élu — démarrage serveur...`);
        // Démarre le serveur uniquement quand on est sûr d'être leader
        if (!localServerRunning) {
          try {
            const loc = await localServer.start();
            localServerRunning = true;
            console.log(`[discovery] Serveur démarré: ${loc.url} (réseau: ${loc.ip}:${loc.port})`);
            sendToWindow("discovery-status", `Leader — serveur actif sur ${myIP}:3001`);
          } catch (e) {
            console.error("[discovery] Impossible de démarrer le serveur:", e.message);
            // Port occupé ? L'autre nœud est peut-être encore leader — on réessaie dans 1s
            await new Promise(r => setTimeout(r, 1000));
            try { await localServer.start(); localServerRunning = true; } catch (e2) {
              console.error("[discovery] Échec définitif serveur:", e2.message);
            }
          }
        }
        const localServer_ = { ip: "127.0.0.1", port: 3001, protocol: "http" };
        if (!resolved) {
          resolved = true;
          resolve(localServer_);
        } else {
          // Ré-élection : reprend le leadership après avoir été follower
          console.log(`[election] RE-LEADER: rechargement WebView sur 127.0.0.1:3001`);
          discoveredServer = localServer_;
          setupMediaPermissions("http://127.0.0.1:3001");
          if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL("http://127.0.0.1:3001");
        }
      },
      onLeaderElected: async (leaderIP) => {
        console.log(`[election] FOLLOWER — leader: ${leaderIP}`);
        sendToWindow("discovery-status", `Follower — leader: ${leaderIP}:3001`);
        // Si on avait démarré un serveur (ré-élection), on l'arrête proprement
        if (localServerRunning) {
          const detected = await checkServer(leaderIP, 3001);
          const protocol = detected?.protocol || "http";
          const url = `${protocol}://${leaderIP}:3001`;
          localServer.notifyRedirect(url);
          await new Promise(r => setTimeout(r, 300));
          localServer.stop();
          localServerRunning = false;
        }
        const detected = await checkServer(leaderIP, 3001);
        const protocol = detected?.protocol || "http";
        const url = `${protocol}://${leaderIP}:3001`;
        const newServer = { ip: leaderIP, port: 3001, protocol };
        if (!resolved) {
          resolved = true;
          if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(url);
          resolve(newServer);
        } else {
          discoveredServer = newServer;
          setupMediaPermissions(url);
          sendToWindow("server-changed", url);
        }
      },
    });
    leaderElection.start();
  });
}

// ── Watchdog connexion serveur externe (docker/dedicated) ────────────────────
// Si le serveur externe disparaît, lance une re-découverte puis élection Bully.
// Chaîne de failover : docker → desktop --server → élection Bully APK/Desktop
function startServerWatchdog(serverIp, serverPort, serverProtocol) {
  stopServerWatchdog();
  serverWatchdogFailures = 0;
  console.log(`[watchdog] Surveillance serveur externe ${serverIp}:${serverPort} (toutes les ${SERVER_WATCHDOG_INTERVAL_MS}ms)`);

  serverWatchdogTimer = setInterval(async () => {
    if (localServerRunning) { stopServerWatchdog(); return; } // on est serveur, pas besoin
    const alive = await checkServer(serverIp, serverPort);
    if (alive) {
      serverWatchdogFailures = 0;
      return;
    }
    serverWatchdogFailures++;
    console.warn(`[watchdog] Serveur ${serverIp}:${serverPort} ne répond pas (${serverWatchdogFailures}/${SERVER_WATCHDOG_MAX_FAILURES})`);

    if (serverWatchdogFailures >= SERVER_WATCHDOG_MAX_FAILURES) {
      stopServerWatchdog();
      console.warn("[watchdog] Serveur externe perdu — lancement failover (re-découverte + élection)");
      sendToWindow("discovery-status", "Serveur perdu — recherche de repli...");

      // 1. Tente d'abord une re-découverte multicast (un autre serveur dédié a peut-être pris le relais)
      const newServer = await listenMulticast(getLocalIP());
      if (newServer) {
        console.log(`[watchdog] Nouveau serveur trouvé: ${newServer.ip}:${newServer.port} (mode=${newServer.mode})`);
        discoveredServer = newServer;
        const url = `${newServer.protocol || "http"}://${newServer.ip}:${newServer.port}`;
        setupMediaPermissions(url);
        sendToWindow("server-changed", url);
        startServerWatchdog(newServer.ip, newServer.port, newServer.protocol || "http");
        return;
      }

      // 2. Aucun serveur trouvé → élection Bully pour désigner un nouveau leader
      console.log("[watchdog] Aucun serveur trouvé — démarrage élection Bully");
      sendToWindow("discovery-status", "Élection du nouveau serveur...");
      if (leaderElection) { leaderElection.stop(); leaderElection = null; }
      discoveredServer = await discoverServer();
      if (discoveredServer) {
        const { ip, port, protocol } = discoveredServer;
        const url = `${protocol}://${ip}:${port}`;
        setupMediaPermissions(url);
        sendToWindow("server-changed", url);
        // Si le nouveau serveur est externe, relancer le watchdog dessus
        if (ip !== "127.0.0.1" && ip !== "localhost") {
          startServerWatchdog(ip, port, protocol);
        }
      }
    }
  }, SERVER_WATCHDOG_INTERVAL_MS);
}

function stopServerWatchdog() {
  if (serverWatchdogTimer) {
    clearInterval(serverWatchdogTimer);
    serverWatchdogTimer = null;
  }
  serverWatchdogFailures = 0;
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

ipcMain.handle("get-network-interfaces", () => listNetworkInterfaces());

ipcMain.handle("get-selected-interface", () => {
  const fs = require("fs");
  const configPath = path.join(app.getPath("userData"), "server-config.json");
  try {
    const saved = JSON.parse(fs.readFileSync(configPath, "utf8"));
    return saved.forcedInterface || null;
  } catch (e) { return null; }
});

ipcMain.handle("set-network-interface", (_, ip) => {
  const fs = require("fs");
  const configPath = path.join(app.getPath("userData"), "server-config.json");
  let config = {};
  try { config = JSON.parse(fs.readFileSync(configPath, "utf8")); } catch (e) {}
  if (ip) config.forcedInterface = ip;
  else delete config.forcedInterface;
  fs.writeFileSync(configPath, JSON.stringify(config), "utf8");
  console.log(`[settings] Interface forcée: ${ip || "auto"}`);
  return true;
});

ipcMain.handle("open-settings", () => {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 460,
    height: 420,
    title: "DewiCom — Paramètres réseau",
    backgroundColor: "#1a1a2e",
    parent: mainWindow,
    modal: false,
    resizable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
    icon: path.join(__dirname, "assets", "icon.png"),
  });
  settingsWindow.loadFile(path.join(__dirname, "settings.html"));
  settingsWindow.on("closed", () => { settingsWindow = null; });
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

  if (HEADLESS_MODE) {
    // Mode --server --headless : pas de fenêtre, serveur seul (daemon)
    console.log("[app] Mode headless actif — pas de fenêtre");
    discoveredServer = await startDedicatedServer();
    return;
  }

  createWindow();

  if (SERVER_MODE) {
    // Mode --server : démarre directement comme serveur dédié, pas d'élection
    discoveredServer = await startDedicatedServer();
  } else {
    // Mode normal : élection Bully
    discoveredServer = await discoverServer();
  }

  if (discoveredServer) {
    const { ip, port, protocol } = discoveredServer;
    const url = `${protocol}://${ip}:${port}`;
    setupMediaPermissions(url);
    console.log(`[app] Chargement: ${url}`);
    // Si on est client d'un serveur externe → surveiller sa disponibilité
    if (!localServerRunning && ip !== "127.0.0.1" && ip !== "localhost") {
      startServerWatchdog(ip, port, protocol);
    }
    if (mainWindow) mainWindow.loadURL(url);
  } else {
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
  stopServerWatchdog();
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
  stopServerWatchdog();
  if (leaderElection) { leaderElection.stop(); leaderElection = null; }
  if (rediscoveryTimer) { clearInterval(rediscoveryTimer); rediscoveryTimer = null; }
  if (localServerRunning) localServer.stop();
});
