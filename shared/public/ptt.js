// Gestion PTT (Push-To-Talk) : bouton, clavier, kit filaire
function pttStart() {
  if (speaking) return;
  speaking = true;
  const currentBtn = document.getElementById("pttBtn");
  if (currentBtn) currentBtn.classList.add("pressed");
  if (!socket) return;
  if (directorMode) {
    const activeTalkChannels = getAllTalkChannels();
    if (activeTalkChannels.length > 0) {
      activeTalkChannels.forEach(channelId => socket.emit("ptt-start", { channel: channelId }));
    }
  } else {
    socket.emit("ptt-start", { channel: myChannel });
  }
}

function pttStop() {
  if (!speaking) return;
  speaking = false;
  const currentBtn = document.getElementById("pttBtn");
  if (currentBtn) currentBtn.classList.remove("pressed");
  if (directorMode) {
    const activeTalkChannels = getAllTalkChannels();
    if (activeTalkChannels.length > 0) {
      activeTalkChannels.forEach(channelId => socket.emit("ptt-stop", { channel: channelId }));
    }
  } else {
    socket.emit("ptt-stop", { channel: myChannel });
  }
}

function pttToggle() {
  if (speaking) pttStop(); else pttStart();
}

function setupPTT() {
  setupAudioProcessor();
  const btn = document.getElementById("pttBtn");
  if (!btn) {
    console.warn("PTT button not found, retrying...");
    setTimeout(setupPTT, 50);
    return;
  }

  function setupPTTListeners() {
    const currentBtn = document.getElementById("pttBtn");
    if (!currentBtn || !currentBtn.parentNode) {
      console.warn("PTT button not found for mode change, retrying...");
      setTimeout(setupPTTListeners, 50);
      return;
    }
    const newBtn = currentBtn.cloneNode(true);
    currentBtn.parentNode.replaceChild(newBtn, currentBtn);
    if (pttMode) {
      newBtn.addEventListener("mousedown", pttStart);
      newBtn.addEventListener("touchstart", (e) => { e.preventDefault(); pttStart(); }, { passive: false });
      newBtn.addEventListener("mouseup", pttStop);
      newBtn.addEventListener("touchend", (e) => { e.preventDefault(); pttStop(); }, { passive: false });
      newBtn.addEventListener("mouseleave", pttStop);
    } else {
      newBtn.addEventListener("click", pttToggle);
      newBtn.addEventListener("touchstart", (e) => { e.preventDefault(); pttToggle(); }, { passive: false });
    }
    setupKeyboardListeners();
  }

  setupPTTListeners();
  window.updatePTTMode = setupPTTListeners;
}

function setupKeyboardListeners() {
  const oldKeyDownHandler = window.pttKeyDownHandler;
  const oldKeyUpHandler = window.pttKeyUpHandler;
  if (oldKeyDownHandler) document.removeEventListener("keydown", oldKeyDownHandler);
  if (oldKeyUpHandler) document.removeEventListener("keyup", oldKeyUpHandler);

  const pttKeys = ["Space", "Enter", "KeyZ", "KeyX"];
  const mediaKeys = ["MediaPlayPause", "MediaTrackNext", "MediaTrackPrevious", "MediaStop"];

  if (pttMode) {
    window.pttKeyDownHandler = (e) => {
      if (e.code === "MediaPlayPause") {
        if (!mediaKeyState[e.code]) {
          mediaKeyState[e.code] = true;
          e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
          pttStart();
          addActivityEntry(`Kit filaire (MediaPlayPause) - PTT activé`, "🎧", "#3b82f6");
        }
        return;
      }
      const isMediaKey = mediaKeys.includes(e.code);
      const isPttKey = allPttKeys.includes(e.code) || isMediaKey;
      if (isMediaKey) {
        if (mediaKeyState[e.code]) return;
        mediaKeyState[e.code] = true;
      }
      if (isPttKey && !e.repeat) {
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        pttStart();
        addActivityEntry(`${isMediaKey ? "Kit filaire" : "Kit main libre"} (${e.code}) - PTT activé`, "🎧", "#3b82f6");
      }
    };
    window.pttKeyUpHandler = (e) => {
      if (e.code === "MediaPlayPause") {
        mediaKeyState[e.code] = false;
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        pttStop();
        addActivityEntry(`Kit filaire (MediaPlayPause) - PTT désactivé`, "🎧", "#6b7280");
        return;
      }
      const isMediaKey = mediaKeys.includes(e.code);
      const isPttKey = allPttKeys.includes(e.code) || isMediaKey;
      if (isMediaKey) mediaKeyState[e.code] = false;
      if (isPttKey) {
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        pttStop();
        addActivityEntry(`${isMediaKey ? "Kit filaire" : "Kit main libre"} (${e.code}) - PTT désactivé`, "🎧", "#6b7280");
      }
    };
  } else {
    window.pttKeyDownHandler = (e) => {
      if (e.code === "MediaPlayPause") {
        if (!mediaKeyState[e.code]) {
          mediaKeyState[e.code] = true;
          e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
          pttToggle();
          addActivityEntry(`Kit filaire (MediaPlayPause) - Toggle`, "🎧", "#3b82f6");
        }
        return;
      }
      const isMediaKey = mediaKeys.includes(e.code);
      const isPttKey = allPttKeys.includes(e.code) || isMediaKey;
      if (isMediaKey) {
        if (mediaKeyState[e.code]) return;
        mediaKeyState[e.code] = true;
      }
      if (isPttKey && !e.repeat) {
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        pttToggle();
        addActivityEntry(`${isMediaKey ? "Kit filaire" : "Kit main libre"} (${e.code}) - Toggle`, "🎧", "#3b82f6");
      }
    };
    window.pttKeyUpHandler = (e) => {
      if (e.code === "MediaPlayPause") {
        mediaKeyState[e.code] = false;
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        addActivityEntry(`Kit filaire (MediaPlayPause) - Toggle complété`, "🎧", "#3b82f6");
        return;
      }
      const isMediaKey = mediaKeys.includes(e.code);
      if (isMediaKey) mediaKeyState[e.code] = false;
    };
  }

  document.addEventListener("keydown", window.pttKeyDownHandler);
  if (window.pttKeyUpHandler) document.addEventListener("keyup", window.pttKeyUpHandler);
}
