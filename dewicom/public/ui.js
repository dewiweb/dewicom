// Rendu UI : canaux, activity log, panels, PTT label
const speakingEntries = new Map();

function renderChannelSelect() {
  const channelSelect = document.getElementById("channelSelect");
  channelSelect.innerHTML = "";
  channels.forEach(ch => {
    const btn = document.createElement("div");
    btn.className = "ch-btn" + (ch.id === myChannel ? " selected" : "");
    btn.textContent = ch.name;
    btn.style.setProperty("--ch-color", ch.color);
    btn.onclick = () => { myChannel = ch.id; renderChannelSelect(); };
    if (ch.id === myChannel) btn.style.borderColor = ch.color;
    channelSelect.appendChild(btn);
  });
}

function renderChannelStrip() {
  const strip = document.getElementById("channelStrip");
  strip.innerHTML = "";
  channels.forEach(ch => {
    const pill = document.createElement("div");
    pill.className = "ch-pill" + (ch.id === myChannel ? " active" : "");
    const state = channelState[ch.id];
    const count = state ? state.users.length : 0;
    pill.textContent = ch.name;
    if (count > 0) {
      const badge = document.createElement("div");
      badge.className = "badge";
      badge.textContent = count;
      pill.appendChild(badge);
    }
    pill.onclick = () => switchChannel(ch.id);
    strip.appendChild(pill);
  });
  updatePTTLabel();
}

function renderMonitoringControls() {
  const container = document.getElementById("channelControls");
  container.innerHTML = "";
  channels.forEach(ch => {
    const state = channelStates[ch.id] || { listen: false, talk: false };
    const control = document.createElement("div");
    control.className = "channel-control";
    control.innerHTML = `
      <div class="channel-name">
        <div class="channel-color-dot" style="background: ${ch.color}"></div>
        ${ch.name}
      </div>
      <div class="channel-buttons">
        <button class="channel-btn listen ${state.listen ? 'active' : ''}" data-channel="${ch.id}" data-action="listen">🎧</button>
        <button class="channel-btn talk ${state.talk ? 'active' : ''}" data-channel="${ch.id}" data-action="talk">🎙️</button>
      </div>
    `;
    container.appendChild(control);
  });

  const allListen = channels.every(ch => channelStates[ch.id]?.listen);
  const allTalk = channels.every(ch => channelStates[ch.id]?.talk);
  document.getElementById("directorBtn").className = "monitor-ch-btn" + (allListen && allTalk ? " active" : "");
  document.getElementById("clearBtn").className = "monitor-ch-btn" + (!allListen && !allTalk ? " active" : "");

  container.querySelectorAll('.channel-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      toggleChannelState(e.target.dataset.channel, e.target.dataset.action);
    });
  });
}

function toggleChannelState(channelId, action) {
  if (!channelStates[channelId]) channelStates[channelId] = { listen: false, talk: false };
  if (action === 'talk') {
    if (!channelStates[channelId].talk) {
      channelStates[channelId].talk = true;
      channelStates[channelId].listen = true;
    } else {
      channelStates[channelId].talk = false;
    }
  } else {
    channelStates[channelId].listen = !channelStates[channelId].listen;
  }
  const listenChannels = Object.keys(channelStates).filter(id => channelStates[id].listen);
  const talkChannels = Object.keys(channelStates).filter(id => channelStates[id].talk);
  socket?.emit("update-listen-channels", { listenChannels });
  socket?.emit("update-talk-channels", { talkChannels });
  renderMonitoringControls();
  updatePTTLabel();
}

function updatePTTLabel() {
  if (directorMode) {
    const talkChannels = Object.keys(channelStates).filter(id => channelStates[id]?.talk);
    const channelNames = talkChannels.map(id => channels.find(c => c.id === id)?.name || id);
    document.getElementById("pttLabel").textContent = channelNames.length ? channelNames.join(' + ') : "Aucun canal";
    const dot = document.getElementById("pttChDot");
    if (dot && talkChannels.length === 1) {
      dot.style.background = channels.find(c => c.id === talkChannels[0])?.color || "#22c55e";
    } else if (dot && talkChannels.length > 1) {
      dot.style.background = "linear-gradient(45deg, #22c55e, #3b82f6, #f97316, #a855f7)";
    } else if (dot) {
      dot.style.background = "#ef4444";
    }
  } else {
    const ch = channels.find(c => c.id === myChannel);
    document.getElementById("pttLabel").textContent = ch?.name || myChannel;
    const dot = document.getElementById("pttChDot");
    if (dot) dot.style.background = ch?.color || "#22c55e";
  }
}

function getAllTalkChannels() {
  return Object.keys(channelStates).filter(id => channelStates[id]?.talk);
}

function switchChannel(chId) {
  myChannel = chId;
  if (socket) {
    socket.emit("switch-channel", { channel: chId });
    if (!directorMode) {
      socket.emit("update-listen-channels", { listenChannels: [] });
      socket.emit("update-talk-channels", { talkChannels: [] });
    }
  }
  renderChannelStrip();
  updatePTTLabel();
}

function getChannelName(id) {
  return channels.find(c => c.id === id)?.name || id;
}

function addActivityEntry(text, icon, color) {
  const log = document.getElementById("activity");
  const entry = document.createElement("div");
  entry.className = "activity-entry";
  const time = new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  entry.innerHTML = `
    <div class="entry-initial" style="background:${color}22;color:${color}">${icon}</div>
    <div class="entry-body"><div class="entry-sub">${text}</div></div>
    <div class="entry-time">${time}</div>`;
  log.appendChild(entry);
  log.scrollTop = log.scrollHeight;
  while (log.children.length > 50) log.removeChild(log.firstChild);
}

function updateSpeakingEntry(fromId, from, channel, isSpeaking) {
  const log = document.getElementById("activity");
  if (isSpeaking) {
    const entry = document.createElement("div");
    entry.className = "activity-entry speaking";
    entry.id = "speaking-" + fromId;
    const chColor = channels.find(c => c.id === channel)?.color || "#22c55e";
    const initials = from.slice(0,2).toUpperCase();
    entry.innerHTML = `
      <div class="entry-initial" style="background:${chColor}22;color:${chColor}">${initials}</div>
      <div class="entry-body">
        <div class="entry-name">${from}</div>
        <div class="entry-sub">
          <div class="on-air-dot"></div>
          <span style="color:var(--green);font-weight:700">ON AIR</span>
          <div class="speaking-wave">
            <div class="wave-bar"></div><div class="wave-bar"></div><div class="wave-bar"></div>
          </div>
        </div>
      </div>`;
    log.appendChild(entry);
    log.scrollTop = log.scrollHeight;
    speakingEntries.set(fromId, entry);
  } else {
    const entry = speakingEntries.get(fromId);
    if (entry) {
      entry.classList.remove("speaking");
      entry.querySelector(".entry-sub").innerHTML = `<span style="color:var(--muted)">A terminé</span>`;
      speakingEntries.delete(fromId);
    }
  }
}

function renderUsersList() {
  const list = document.getElementById("usersList");
  list.innerHTML = "";
  channels.forEach(ch => {
    const state = channelState[ch.id];
    const users = state?.users || [];
    if (!users.length) return;
    const group = document.createElement("div");
    group.className = "ch-group";
    group.innerHTML = `<div class="ch-group-header"><div class="ch-group-dot" style="background:${ch.color}"></div>${ch.name} <span style="opacity:.5">(${users.length})</span></div>`;
    users.forEach(u => {
      const row = document.createElement("div");
      row.className = "user-row";
      const initials = u.name.slice(0,2).toUpperCase();
      row.innerHTML = `
        <div class="user-row-avatar" style="background:${ch.color}22;color:${ch.color}">${initials}</div>
        <div class="user-row-name">${u.name}${u.id === socket?.id ? '<span class="user-me">(moi)</span>' : ""}</div>`;
      group.appendChild(row);
    });
    list.appendChild(group);
  });
  if (!list.innerHTML) {
    list.innerHTML = '<div style="color:var(--muted);font-size:.875rem">Aucun participant connecté</div>';
  }
}

function setupCall() {
  const btn = document.getElementById("callBtn");
  btn.addEventListener("click", () => {
    if (!socket) return;
    socket.emit("call-ring", { channel: myChannel });
    btn.classList.add("calling");
    addActivityEntry(`Tu as appelé ${getChannelName(myChannel)}`, "📞", "#f59e0b");
    setTimeout(() => btn.classList.remove("calling"), 2000);
  });
}

function showMicError(msg) {
  let el = document.getElementById("micError");
  if (!el) {
    el = document.createElement("div");
    el.id = "micError";
    el.style.cssText = "width:100%;max-width:380px;background:#ef444422;border:1px solid #ef444466;border-radius:10px;padding:14px 16px;font-size:.82rem;line-height:1.6;color:#fca5a5;text-align:center;";
    document.getElementById("joinBtn").insertAdjacentElement("afterend", el);
  }
  el.innerHTML = "🎙️ " + msg;
}

function setConnected(ok) {
  document.getElementById("connDot").className = "conn-dot" + (ok ? "" : " off");
  document.getElementById("connLabel").textContent = ok ? "En ligne" : "Hors ligne";
  if (!ok) document.getElementById("reconnectBtn").style.display = "inline-block";
  else document.getElementById("reconnectBtn").style.display = "none";
}
