// Gestion connexion socket mobile : WS natif (APK Java), Socket.io (nodejs), reconnexion leader

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

function updateLeaderFooter(ip, mode) {
  const isLocal = (ip === "127.0.0.1" || ip === "localhost");
  let serverType = isLocal ? "Android local" : "Serveur distant";
  if (mode === "apk")        serverType = "Android";
  else if (mode === "local") serverType = "Android local";
  else if (mode === "nodejs") serverType = "Serveur Node.js";
  else if (mode === "desktop-local") serverType = "Desktop local";
  _leaderBaseText = `${serverType} — ${ip}:3001`;
  _leaderDotClass = "leader-dot " + (isLocal ? "local" : (mode === "apk" ? "apk" : "remote"));
  updateLeaderUserCount();
}

function _emitJoin(sock) {
  if (!myName || !myChannel) return;
  const listenChannels = Object.keys(channelStates || {}).filter(id => channelStates[id]?.listen);
  const talkChannels   = Object.keys(channelStates || {}).filter(id => channelStates[id]?.talk);
  sock.emit("join", { clientId, name: myName, channel: myChannel, listenChannels, talkChannels });
}

function _registerSocketHandlers(sock, ip, mode) {
  sock.on("connect", () => {
    setConnected(true);
    updateLeaderFooter(ip, mode);
    document.getElementById("connBadge")?.classList.add("live");
    document.getElementById("reconnectBtn").style.display = "none";
    _emitJoin(sock);
  });
  sock.on("disconnect", () => {
    setConnected(false);
    document.getElementById("connBadge")?.classList.remove("live");
    document.getElementById("reconnectBtn").style.display = "inline-block";
  });
  sock.on("audio-chunk", ({ from, chunk }) => {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    playChunk(chunk);
  });
  sock.on("call-ring", ({ from, channel }) => {
    showRingAlert(from, channel);
    addActivityEntry(`${from} appelle — ${getChannelName(channel)}`, "📞", "#f59e0b");
  });
  sock.on("ptt-state", ({ from, fromId, channel, speaking: isSpeaking }) => {
    if (fromId !== sock.id) updateSpeakingEntry(fromId, from, channel, isSpeaking);
  });
  sock.on("channel-state", (state) => {
    channelState = state;
    renderChannelStrip();
    updateLeaderUserCount();
    if (!document.getElementById("usersPanel").classList.contains("hidden")) renderUsersList();
  });
  sock.on("channels-init", (chs) => {
    channels = chs;
    renderChannelStrip();
    renderMonitoringControls();
    renderChannelSelect();
  });
  sock.on("user-joined", ({ name, channel }) => addActivityEntry(`${name} a rejoint ${getChannelName(channel)}`, "🟢", "#22c55e"));
  sock.on("user-left",   ({ name, channel }) => addActivityEntry(`${name} a quitté ${getChannelName(channel)}`, "🔴", "#ef4444"));
}

function makeNativeSocket(ip) {
  const wsUrl = "ws://" + ip + ":3002";
  console.log("[socket] Connexion WebSocket natif →", wsUrl);
  const ws = new WebSocket(wsUrl);
  const sock = {
    _ws: ws,
    _handlers: {},
    id: null,
    on(event, fn) { (this._handlers[event] = this._handlers[event] || []).push(fn); return this; },
    emit(event, data, opts) {
      if (this._ws.readyState !== WebSocket.OPEN) return;
      if (data && data.chunk instanceof ArrayBuffer) {
        const b64 = btoa(String.fromCharCode(...new Uint8Array(data.chunk)));
        this._ws.send("42" + JSON.stringify([event, { ...data, chunk: b64, _b64: true }]));
      } else {
        this._ws.send("42" + JSON.stringify([event, data]));
      }
    },
    disconnect() { try { this._ws.close(); } catch(e) {} },
    _trigger(event, ...args) { (this._handlers[event] || []).forEach(fn => fn(...args)); }
  };
  ws.onopen  = () => sock._trigger("connect");
  ws.onclose = () => sock._trigger("disconnect");
  ws.onerror = (e) => console.error("[WS] error", e);
  ws.onmessage = (msg) => {
    const text = msg.data;
    if (text === "2") { ws.send("3"); return; }
    if (!text.startsWith("42")) return;
    try {
      const arr = JSON.parse(text.substring(2));
      if (Array.isArray(arr) && arr.length >= 1) {
        let payload = arr[1];
        if (payload && payload._b64 && payload.chunk) {
          const bin = atob(payload.chunk);
          const buf = new ArrayBuffer(bin.length);
          const view = new Uint8Array(buf);
          for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
          payload = { ...payload, chunk: buf };
        }
        sock._trigger(arr[0], payload);
      }
    } catch(e) { console.error("[WS] parse error", e); }
  };
  return sock;
}

// Reconnexion transparente vers un nouveau leader (sans rechargement de page)
function reconnectToServer(ip, mode) {
  if (!myName) return;
  if (ip !== null) window.dewicomServerIP = ip;
  if (mode) window.dewicomServerMode = mode;
  const targetIP   = window.dewicomServerIP || "127.0.0.1";
  const targetMode = window.dewicomServerMode || (targetIP === "127.0.0.1" ? "local" : "nodejs");
  // WS natif uniquement si la page est servie par la WebView interne (127.0.0.1)
  const useWS = (targetIP === "127.0.0.1" && (targetMode === "apk" || targetMode === "local"));

  console.log("[leader] Basculement →", targetIP, "mode:", targetMode, "ws:", useWS);
  addActivityEntry("Basculement vers le nouveau serveur leader…", "🔄", "#f59e0b");

  try {
    if (socket && socket._ws) socket._ws.close();
    else if (socket && socket.disconnect) { socket.off(); socket.disconnect(); }
  } catch(e) {}
  socket = null;

  if (useWS) {
    socket = makeNativeSocket(targetIP);
  } else {
    socket = io("http://" + targetIP + ":3001", { transports: ["websocket"] });
  }
  _registerSocketHandlers(socket, targetIP, targetMode);
  // Si déjà connecté (WS déjà OPEN), force le join immédiatement
  const isNativeOpen = useWS && socket._ws && socket._ws.readyState === WebSocket.OPEN;
  const isIoConnected = !useWS && socket.connected;
  if (isNativeOpen || isIoConnected) {
    updateLeaderFooter(targetIP, targetMode);
    _emitJoin(socket);
  }
}

// Appelée par MainActivity.java via evaluateJavascript
window.reconnectSocket = function(newLeaderIP, newMode) {
  reconnectToServer(newLeaderIP, newMode || window.dewicomServerMode);
};

function manualReconnect() {
  const btn = document.getElementById("reconnectBtn");
  btn.textContent = "…";
  btn.disabled = true;
  if (window.DewiComAndroid?.requestRediscovery) {
    window.DewiComAndroid.requestRediscovery();
  } else {
    reconnectToServer(null, null);
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
        echoCancellation: true, noiseSuppression: true, sampleRate: 16000,
      }});
    }
  } catch(e) {
    console.warn("[Micro]", e.name, e.message);
    if (e.name === "NotAllowedError" || e.name === "PermissionDeniedError") {
      showMicError("Permission micro refusée.<br><strong>Vérifie les permissions micro de l'app dans Paramètres Android.</strong>");
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

  // Détermine le mode de connexion (WS natif APK vs Socket.io)
  if (typeof window.DewiComAndroid !== "undefined" && !window.dewicomServerIP) {
    window.dewicomServerIP = window.DewiComAndroid.getServerIP() || "127.0.0.1";
  }
  // Si la page est chargée depuis une IP LAN (navigateur externe), utiliser l'IP du serveur hôte
  if (!window.dewicomServerIP) {
    const hostIP = window.location.hostname;
    const isLAN = hostIP && hostIP !== "127.0.0.1" && hostIP !== "localhost" && /^\d+\.\d+\.\d+\.\d+$/.test(hostIP);
    if (isLAN) window.dewicomServerIP = hostIP;
  }
  const serverIP = window.dewicomServerIP || "127.0.0.1";

  // Interroge /api/dewicom-discovery pour connaître le mode réel du serveur hôte
  if (!window.dewicomServerMode) {
    try {
      const res = await fetch(`http://${serverIP}:3001/api/dewicom-discovery`, { signal: AbortSignal.timeout(1500) });
      const data = await res.json();
      window.dewicomServerMode = data.mode || "apk";
    } catch { window.dewicomServerMode = "apk"; }
  }
  const serverMode = window.dewicomServerMode;
  // WS natif pour APK (local ou distant) ; Socket.io pour desktop-local et nodejs
  const useNativeWS = (serverMode === "apk" || serverMode === "local");

  if (useNativeWS) {
    socket = makeNativeSocket(serverIP);
  } else {
    const socketUrl = "http://" + serverIP + ":3001";
    console.log("[socket] Connexion Socket.io →", socketUrl);
    socket = io(socketUrl, { transports: ["websocket"] });
  }

  _registerSocketHandlers(socket, serverIP, serverMode);

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
    const actions  = document.getElementById("directorActions");
    const hint     = document.getElementById("directorHint");
    if (directorMode) {
      controls.style.display = "flex"; actions.style.display = "flex"; hint.style.display = "block";
      addActivityEntry("Mode Director activé", "🎧", "#3b82f6");
    } else {
      controls.style.display = "none"; actions.style.display = "none"; hint.style.display = "none";
      channelStates = {};
      socket?.emit("update-listen-channels", { listenChannels: [] });
      socket?.emit("update-talk-channels",   { talkChannels: [] });
      socket?.emit("switch-channel", { channel: myChannel });
      updatePTTLabel();
      addActivityEntry("Mode Director désactivé", "🔇", "#ef4444");
    }
  });

  document.getElementById("directorBtn").addEventListener("click", () => {
    const ids = channels.map(ch => ch.id);
    ids.forEach(id => { channelStates[id] = { listen: true, talk: true }; });
    socket?.emit("update-listen-channels", { listenChannels: ids });
    socket?.emit("update-talk-channels",   { talkChannels: ids });
    renderMonitoringControls(); updatePTTLabel();
    addActivityEntry("Mode Director complet — écoute et parle sur tous les canaux", "🎧", "#22c55e");
  });

  document.getElementById("clearBtn").addEventListener("click", () => {
    channels.map(ch => ch.id).forEach(id => { channelStates[id] = { listen: false, talk: false }; });
    socket?.emit("update-listen-channels", { listenChannels: [] });
    socket?.emit("update-talk-channels",   { talkChannels: [] });
    renderMonitoringControls(); updatePTTLabel();
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
