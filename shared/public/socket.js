// Gestion connexion Socket.io : session, reconnexion, handlers événements

let _leaderBaseText = "—";
let _leaderDotClass = "leader-dot";

function _renderLeaderFooter(userCount) {
  const label = document.getElementById("leaderLabel");
  const dot   = document.getElementById("leaderDot");
  if (!label || !dot) return;
  const countStr = userCount > 0 ? ` · ${userCount} connecté${userCount > 1 ? "s" : ""}` : "";
  label.textContent = _leaderBaseText + countStr;
  dot.className = _leaderDotClass;
}

function updateLeaderUserCount() {
  const total = Object.values(channelState).reduce((acc, s) => acc + (s?.users?.length || 0), 0);
  _renderLeaderFooter(total);
}

async function updateLeaderFooter(url) {
  const label = document.getElementById("leaderLabel");
  const dot   = document.getElementById("leaderDot");
  if (!label || !dot) return;
  try {
    const u = new URL(url);
    const isLocal = u.hostname === "127.0.0.1" || u.hostname === "localhost";
    // Récupère le mode depuis l'API de découverte
    let serverType = isLocal ? "desktop local" : "serveur distant";
    try {
      const res = await fetch(`${u.protocol}//${u.host}/api/dewicom-discovery`, { signal: AbortSignal.timeout(2000) });
      const data = await res.json();
      if (data.mode === "desktop-local")   serverType = "Desktop local";
      else if (data.mode === "apk")        serverType = "Android";
      else if (data.mode === "nodejs")     serverType = "Serveur Node.js";
      else if (data.mode)                  serverType = data.mode;
    } catch { /* garde la valeur par défaut */ }
    _leaderBaseText = `${serverType} — ${u.hostname}:${u.port}`;
    _leaderDotClass = "leader-dot " + (isLocal ? "local" : (serverType === "Android" ? "apk" : "remote"));
  } catch {
    _leaderBaseText = url;
    _leaderDotClass = "leader-dot";
  }
  updateLeaderUserCount();
}

// Auto-redécouverte pour navigateur pur (pas d'Electron/APK) après disconnect
let _rediscoverTimer = null;

async function _checkDewiComServer(url) {
  try {
    const res = await fetch(`${url}/api/dewicom-discovery`, { signal: AbortSignal.timeout(1500) });
    if (res.ok) return url;
  } catch { /* pas de serveur ici */ }
  return null;
}

async function _browserRediscover() {
  if (window.DewiComDesktop) return; // Electron gère lui-même
  if (!myName) return;               // pas encore en session

  // 1. Tente l'URL courante en premier (serveur redémarré sur même IP)
  const currentUrl = window.location.origin;
  if (await _checkDewiComServer(currentUrl)) {
    reconnectToServer(currentUrl);
    return;
  }

  // 2. Scan du subnet local — extrait l'IP courante depuis l'URL
  const match = window.location.hostname.match(/^(\d+\.\d+\.\d+)\.(\d+)$/);
  if (!match) return; // pas une IP LAN, impossible de scanner
  const subnet = match[1];
  const currentOctet = parseInt(match[2]);
  const port = window.location.port || "3001";
  const protocol = window.location.protocol;

  // Priorité : IPs proches ±15, puis IPs communes
  const candidates = [];
  for (let d = -15; d <= 15; d++) {
    const i = currentOctet + d;
    if (i >= 1 && i <= 254 && i !== currentOctet) candidates.push(i);
  }
  for (const i of [1, 2, 10, 20, 50, 100, 200, 254]) {
    if (!candidates.includes(i) && i !== currentOctet) candidates.push(i);
  }

  // Scan par batch de 10 avec timeout court
  const BATCH = 10;
  for (let i = 0; i < candidates.length; i += BATCH) {
    const batch = candidates.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map(octet => _checkDewiComServer(`${protocol}//${subnet}.${octet}:${port}`))
    );
    const found = results.find(r => r !== null);
    if (found) {
      console.log("[rediscover] Nouveau leader trouvé:", found);
      reconnectToServer(found);
      return;
    }
  }
  console.log("[rediscover] Aucun serveur DewiCom trouvé sur le subnet");
}

// Reconnexion transparente vers un nouveau serveur (sans rechargement de page)
function reconnectToServer(newUrl) {
  if (!myName) return; // pas encore connecté, rien à faire
  // Annule la redécouverte auto si server-redirect est arrivé
  if (_rediscoverTimer) { clearTimeout(_rediscoverTimer); _rediscoverTimer = null; }
  console.log("[socket] Basculement vers nouveau leader:", newUrl);
  addActivityEntry("Basculement vers le nouveau serveur leader…", "🔄", "#f59e0b");
  if (socket) {
    socket.off(); // retire tous les listeners pour éviter les doublons
    socket.disconnect();
    socket = null;
  }
  // Reconnecte sur la nouvelle URL en conservant nom/canal
  socket = io(newUrl, { transports: ["websocket"] });

  socket.on("connect", () => {
    setConnected(true);
    updateLeaderFooter(newUrl);
    document.getElementById("connBadge")?.classList.add("live");
    document.getElementById("reconnectBtn").style.display = "none";
    if (directorMode) {
      const listenChannels = Object.keys(channelStates).filter(id => channelStates[id]?.listen);
      const talkChannels   = Object.keys(channelStates).filter(id => channelStates[id]?.talk);
      socket.emit("join", { clientId, name: myName, channel: myChannel, listenChannels, talkChannels });
    } else {
      socket.emit("join", { clientId, name: myName, channel: myChannel });
    }
    addActivityEntry("Reconnecté au nouveau leader", "✅", "#22c55e");
  });

  socket.on("disconnect", () => {
    setConnected(false);
    document.getElementById("connBadge")?.classList.remove("live");
    document.getElementById("reconnectBtn").style.display = "inline-block";
    if (!window.DewiComDesktop) {
      if (_rediscoverTimer) clearTimeout(_rediscoverTimer);
      _rediscoverTimer = setTimeout(() => { _rediscoverTimer = null; _browserRediscover(); }, 2000);
    }
  });

  socket.on("channels-init", (chs) => {
    channels = chs;
    renderChannelStrip();
    renderMonitoringControls();
    renderChannelSelect();
  });

  socket.on("channel-state", (state) => {
    channelState = state;
    renderChannelStrip();
    updateLeaderUserCount();
    if (!document.getElementById("usersPanel").classList.contains("hidden")) {
      renderUsersList();
    }
  });

  socket.on("audio-chunk", ({ from, chunk }) => {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    playChunk(chunk);
  });

  socket.on("ptt-state", ({ from, fromId, channel, speaking: isSpeaking }) => {
    if (fromId === socket.id) return;
    updateSpeakingEntry(fromId, from, channel, isSpeaking);
  });

  socket.on("user-joined", ({ name, channel }) => {
    addActivityEntry(`${name} a rejoint ${getChannelName(channel)}`, "🟢", "#22c55e");
  });

  socket.on("user-left", ({ name, channel }) => {
    addActivityEntry(`${name} a quitté ${getChannelName(channel)}`, "🔴", "#ef4444");
  });

  socket.on("call-ring", ({ from, channel }) => {
    showRingAlert(from, channel);
    addActivityEntry(`${from} appelle — ${getChannelName(channel)}`, "📞", "#f59e0b");
  });

  socket.on("server-redirect", (newUrl) => {
    reconnectToServer(newUrl);
  });
}

// Écoute le changement de leader depuis Electron (sans rechargement de page)
if (window.DewiComDesktop?.onServerChanged) {
  window.DewiComDesktop.onServerChanged((url) => reconnectToServer(url));
}

// Alias global appelé par MainActivity.java via evaluateJavascript sur APK Android
window.reconnectSocket = function(ip) {
  const protocol = window.location.protocol || "http:";
  const port = window.location.port || "3001";
  reconnectToServer(`${protocol}//${ip}:${port}`);
};

function manualReconnect() {
  const btn = document.getElementById("reconnectBtn");
  btn.textContent = "…";
  btn.disabled = true;
  if (window.DewiComDesktop?.rediscover) {
    window.DewiComDesktop.rediscover().then((srv) => {
      if (srv) {
        window.location.href = srv.protocol + "://" + srv.ip + ":" + srv.port;
      } else {
        if (socket) { socket.disconnect(); socket.connect(); }
      }
    }).catch(() => {
      if (socket) { socket.disconnect(); socket.connect(); }
    });
  } else if (socket) {
    socket.disconnect();
    socket.connect();
  } else {
    startSession();
    return;
  }
  setTimeout(() => {
    btn.textContent = "↺ Reconnecter";
    btn.disabled = false;
  }, 5000);
}

async function startSession() {
  myName = document.getElementById("nameInput").value.trim();
  if (!myName) return;
  localStorage.setItem("dewicom-name", myName);
  localStorage.setItem("dewicom-channel", myChannel);

  let listenOnly = false;
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      listenOnly = true;
    } else {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: {
        echoCancellation: true,
        noiseSuppression: true,
        sampleRate: 16000,
      }});
    }
  } catch(e) {
    console.warn("[Micro]", e.name, e.message);
    if (e.name === "NotAllowedError" || e.name === "PermissionDeniedError") {
      showMicError("Permission micro refusée par le navigateur.<br><strong>Clique sur l'icône 🔒 dans la barre d'adresse → Autoriser le microphone → Recharger.</strong>");
      return;
    }
    listenOnly = true;
  }
  if (listenOnly) {
    console.warn("[Micro] Pas de micro détecté — mode écoute seule");
    const banner = document.getElementById("micError");
    if (banner) {
      banner.innerHTML = "🔇 Aucun micro — mode <strong>écoute seule</strong>";
      banner.style.display = "block";
      banner.style.background = "#5a3e00";
      banner.style.color = "#ffd580";
    }
  }

  socket = io({ transports: ["websocket"] });

  socket.on("connect", () => {
    setConnected(true);
    updateLeaderFooter(window.location.href);
    document.getElementById("connBadge")?.classList.add("live");
    document.getElementById("reconnectBtn").style.display = "none";
    if (directorMode) {
      const listenChannels = Object.keys(channelStates).filter(id => channelStates[id]?.listen);
      const talkChannels = Object.keys(channelStates).filter(id => channelStates[id]?.talk);
      socket.emit("join", { clientId, name: myName, channel: myChannel, listenChannels, talkChannels });
    } else {
      socket.emit("join", { clientId, name: myName, channel: myChannel });
    }
  });

  socket.on("disconnect", () => {
    setConnected(false);
    document.getElementById("connBadge")?.classList.remove("live");
    document.getElementById("reconnectBtn").style.display = "inline-block";
    if (!window.DewiComDesktop) {
      if (_rediscoverTimer) clearTimeout(_rediscoverTimer);
      _rediscoverTimer = setTimeout(() => { _rediscoverTimer = null; _browserRediscover(); }, 2000);
    }
  });

  socket.on("channels-init", (chs) => {
    channels = chs;
    renderChannelStrip();
    renderMonitoringControls();
    renderChannelSelect();
  });

  socket.on("channel-state", (state) => {
    channelState = state;
    renderChannelStrip();
    updateLeaderUserCount();
    if (!document.getElementById("usersPanel").classList.contains("hidden")) {
      renderUsersList();
    }
  });

  socket.on("audio-chunk", ({ from, chunk }) => {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    playChunk(chunk);
  });

  socket.on("ptt-state", ({ from, fromId, channel, speaking: isSpeaking }) => {
    if (fromId === socket.id) return;
    updateSpeakingEntry(fromId, from, channel, isSpeaking);
  });

  socket.on("user-joined", ({ name, channel }) => {
    addActivityEntry(`${name} a rejoint ${getChannelName(channel)}`, "🟢", "#22c55e");
  });

  socket.on("user-left", ({ name, channel }) => {
    addActivityEntry(`${name} a quitté ${getChannelName(channel)}`, "🔴", "#ef4444");
  });

  socket.on("call-ring", ({ from, channel }) => {
    showRingAlert(from, channel);
    addActivityEntry(`${from} appelle — ${getChannelName(channel)}`, "📞", "#f59e0b");
  });

  socket.on("server-redirect", (newUrl) => {
    reconnectToServer(newUrl);
  });

  // Afficher l'écran principal
  document.getElementById("joinScreen").classList.add("hidden");
  document.getElementById("mainScreen").classList.remove("hidden");
  document.getElementById("topUserName").textContent = myName;
  renderChannelStrip();
  renderMonitoringControls();
  setupCall();
  requestAnimationFrame(() => setupPTT());

  // Director mode toggle
  document.getElementById("directorModeToggle").addEventListener("change", (e) => {
    directorMode = e.target.checked;
    const controls = document.getElementById("channelControls");
    const actions = document.getElementById("directorActions");
    const hint = document.getElementById("directorHint");
    if (directorMode) {
      controls.style.display = "flex";
      actions.style.display = "flex";
      hint.style.display = "block";
      addActivityEntry("Mode Director activé", "🎧", "#3b82f6");
    } else {
      controls.style.display = "none";
      actions.style.display = "none";
      hint.style.display = "none";
      channelStates = {};
      socket?.emit("update-listen-channels", { listenChannels: [] });
      socket?.emit("update-talk-channels", { talkChannels: [] });
      socket?.emit("switch-channel", { channel: myChannel });
      updatePTTLabel();
      addActivityEntry("Mode Director désactivé", "🔇", "#ef4444");
    }
  });

  document.getElementById("directorBtn").addEventListener("click", () => {
    const allChannelIds = channels.map(ch => ch.id);
    allChannelIds.forEach(id => { channelStates[id] = { listen: true, talk: true }; });
    socket?.emit("update-listen-channels", { listenChannels: allChannelIds });
    socket?.emit("update-talk-channels", { talkChannels: allChannelIds });
    renderMonitoringControls();
    updatePTTLabel();
    addActivityEntry("Mode Director complet — écoute et parle sur tous les canaux", "🎧", "#22c55e");
  });

  document.getElementById("clearBtn").addEventListener("click", () => {
    const allChannelIds = channels.map(ch => ch.id);
    allChannelIds.forEach(id => { channelStates[id] = { listen: false, talk: false }; });
    socket?.emit("update-listen-channels", { listenChannels: [] });
    socket?.emit("update-talk-channels", { talkChannels: [] });
    renderMonitoringControls();
    updatePTTLabel();
    addActivityEntry("Tous les canaux désactivés", "🔇", "#ef4444");
  });

  document.getElementById("ringSoundToggle").addEventListener("change", (e) => {
    ringSoundEnabled = e.target.checked;
    addActivityEntry(ringSoundEnabled ? "Sonnerie activée" : "Sonnerie désactivée", "🔔", "#f59e0b");
  });

  document.getElementById("pttModeToggle").addEventListener("change", (e) => {
    pttMode = e.target.checked;
    document.querySelector(".ptt-mode-label").textContent = pttMode ? "PTT" : "Toggle";
    if (window.updatePTTMode) window.updatePTTMode();
    addActivityEntry(pttMode ? "Mode PTT activé" : "Mode Toggle activé", "🎙️", "#3b82f6");
  });
}
