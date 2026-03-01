// Gestion connexion Socket.io : session, reconnexion, handlers événements
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
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.isSecureContext) {
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
    pttMode = !e.target.checked;
    document.querySelector(".ptt-mode-label").textContent = pttMode ? "PTT" : "Toggle";
    document.querySelector(".ptt-text").textContent = pttMode ? "Maintenir pour parler" : "Cliquer pour parler";
    if (window.updatePTTMode) window.updatePTTMode();
    addActivityEntry(pttMode ? "Mode PTT activé" : "Mode Toggle activé", "🎙️", "#3b82f6");
  });
}
