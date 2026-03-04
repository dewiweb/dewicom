/* DewiCom Monitor — logique client */

let channelDefs   = {};
let channelState  = {};
let speakingUsers = new Set();
let pttCount = 0, eventCount = 0;
let startTime = null, uptimeTimer = null;

// ── Logs console ──────────────────────────────────────────────────────────────
const LOG_MAX      = 1000;
const logEntries   = [];
let   logFilter    = "all";
let   logAutoScroll = true;
let   logErrorCount = 0, logWarnCount = 0;

// ── Audio stats ───────────────────────────────────────────────────────────────
let audioChunksLast = 0, audioBytesLast = 0, audioActiveLast = 0;

// ── Socket.io ─────────────────────────────────────────────────────────────────
const socket = io({ reconnectionDelay: 1000, reconnectionDelayMax: 3000 });

socket.on("connect", () => {
  setConnected(true);
  addEvent("info", "Connecté au serveur");
  socket.emit("monitor-subscribe");
});
socket.on("disconnect", () => {
  setConnected(false);
  addEvent("info", "Déconnecté du serveur");
});

socket.on("channels-init", (list) => {
  channelDefs = {};
  list.forEach(ch => { channelDefs[ch.id] = { name: ch.name, color: ch.color }; });
  renderChannels();
});

socket.on("channel-state", (state) => {
  channelState = state;
  renderChannels();
  renderMatrix();
  updateStats();
});

socket.on("monitor-state", (data) => {
  document.getElementById("serverName").textContent    = data.name    || "—";
  document.getElementById("serverMode").textContent    = data.mode    || "—";
  document.getElementById("serverVersion").textContent = data.version || "—";
  document.getElementById("serverProto").textContent   = (data.protocol || "http").toUpperCase();
  startTime = Date.now() - (data.uptime * 1000);
  updateUptime();
  if (uptimeTimer) clearInterval(uptimeTimer);
  uptimeTimer = setInterval(updateUptime, 1000);
});

socket.on("user-joined", ({ name, channel }) => {
  eventCount++;
  addEvent("join", `<em>${name}</em> a rejoint ${chanName(channel)}`);
  updateStats();
});
socket.on("user-left", ({ name, channel }) => {
  eventCount++;
  addEvent("leave", `<em>${name}</em> a quitté ${chanName(channel)}`);
  updateStats();
});

socket.on("ptt-state", ({ from, channel, speaking }) => {
  if (speaking) {
    speakingUsers.add(from);
    pttCount++;
    addEvent("ptt", `<em>${from}</em> parle → ${chanName(channel)}`);
  } else {
    speakingUsers.delete(from);
  }
  renderChannels();
  renderMatrix();
  updateStats();
});

// ── Logs serveur ──────────────────────────────────────────────────────────────
socket.on("log-history", (entries) => {
  entries.forEach(e => addLogEntry(e, false));
  scrollLogsIfNeeded();
  updateLogBadge();
});

socket.on("server-log", (entry) => {
  addLogEntry(entry, true);
  updateLogBadge();
});

// ── Audio stats ───────────────────────────────────────────────────────────────
socket.on("audio-stats", ({ chunks, bytes, active }) => {
  audioChunksLast = chunks;
  audioBytesLast  = bytes;
  audioActiveLast = active;
  updateAudioStats();
  if (chunks > 0) {
    addLogEntry({
      ts: Date.now(),
      level: "audio",
      msg: `[audio] ${chunks} chunks/2s — ${(bytes / 1024).toFixed(1)} KB/2s — ${active} émetteur(s)`,
    }, true);
    updateLogBadge();
  }
});

// ── Matrice utilisateurs / canaux ─────────────────────────────────────────────
function renderMatrix() {
  const head = document.getElementById("matrixHead");
  const body = document.getElementById("matrixBody");
  if (!head || !body) return;

  const chanIds = Object.keys(channelDefs).length ? Object.keys(channelDefs) : Object.keys(channelState);
  if (!chanIds.length) { head.innerHTML = ""; body.innerHTML = ""; return; }

  // Collecte tous les utilisateurs depuis channelState
  const userMap = {}; // name → { channels: Set, talkChannels: Set }
  for (const cid of chanIds) {
    const st = channelState[cid] || {};
    for (const u of (st.users || [])) {
      if (!userMap[u.name]) userMap[u.name] = { channels: new Set(), listenChannels: new Set() };
      userMap[u.name].channels.add(cid);
    }
  }

  const userNames = Object.keys(userMap).sort();
  if (!userNames.length) {
    head.innerHTML = "";
    body.innerHTML = `<tr><td colspan="${chanIds.length + 1}" class="matrix-empty">Aucun utilisateur connecté</td></tr>`;
    return;
  }

  // En-tête : une colonne par canal
  head.innerHTML = `<tr>
    <th class="matrix-th-user"></th>
    ${chanIds.map(cid => {
      const def = channelDefs[cid] || {};
      return `<th class="matrix-th-chan" style="--ch-color:${def.color || "#6b7280"}">
        <div class="matrix-ch-dot"></div>
        <div class="matrix-ch-label">${def.name || cid}</div>
      </th>`;
    }).join("")}
  </tr>`;

  // Corps : une ligne par utilisateur
  body.innerHTML = userNames.map(name => {
    const speaking = speakingUsers.has(name);
    const cells = chanIds.map(cid => {
      const inChan = (userMap[name] && userMap[name].channels.has(cid));
      const def = channelDefs[cid] || {};
      if (!inChan) return `<td class="matrix-cell matrix-cell-empty"></td>`;
      if (speaking) return `<td class="matrix-cell matrix-cell-speaking" style="--ch-color:${def.color || "#22c55e"}" title="${name} parle sur ${def.name || cid}">🎙</td>`;
      return `<td class="matrix-cell matrix-cell-active" style="--ch-color:${def.color || "#6b7280"}" title="${name} → ${def.name || cid}">●</td>`;
    }).join("");
    return `<tr class="${speaking ? "matrix-row-speaking" : ""}">
      <td class="matrix-td-user">
        <div class="matrix-user-avatar ${speaking ? "speaking" : ""}">${(name||"?")[0].toUpperCase()}</div>
        <span class="matrix-user-name">${name}</span>
        ${speaking ? "<span class=\"matrix-ptt-badge\">PTT</span>" : ""}
      </td>
      ${cells}
    </tr>`;
  }).join("");
}

// ── Rendu canaux ──────────────────────────────────────────────────────────────
function chanName(id) {
  return (channelDefs[id] && channelDefs[id].name) || id;
}

function renderChannels() {
  const grid = document.getElementById("channelsGrid");
  const ids = Object.keys(channelDefs).length ? Object.keys(channelDefs) : Object.keys(channelState);
  if (!ids.length) return;

  grid.innerHTML = ids.map(id => {
    const def   = channelDefs[id]  || {};
    const state = channelState[id] || {};
    const users = state.users || [];
    const color = def.color || "#6b7280";
    const count = users.length;
    const hasSpeaker = users.some(u => speakingUsers.has(u.name));

    const usersHtml = count === 0
      ? `<div class="empty-channel">— vide —</div>`
      : users.map(u => {
          const speaking = speakingUsers.has(u.name);
          return `<div class="user-row ${speaking ? "speaking" : ""}" style="--ch-color:${color}">
            <div class="user-avatar">${(u.name||"?")[0].toUpperCase()}</div>
            <div class="user-name">${u.name}</div>
            <div class="audio-bars">
              <div class="audio-bar" style="height:3px"></div>
              <div class="audio-bar" style="height:5px"></div>
              <div class="audio-bar" style="height:8px"></div>
              <div class="audio-bar" style="height:5px"></div>
              <div class="audio-bar" style="height:3px"></div>
            </div>
          </div>`;
        }).join("");

    return `<div class="channel-card ${hasSpeaker ? "has-speaker" : ""}" style="--ch-color:${color}">
      <div class="channel-top">
        <div class="channel-color-bar"></div>
        <div class="channel-name">${def.name || id}</div>
        <div class="channel-badge ${count > 0 ? "active" : ""}">${count}</div>
      </div>
      <div class="channel-ptt-bar"><div class="channel-ptt-fill"></div></div>
      <div class="user-list">${usersHtml}</div>
    </div>`;
  }).join("");
}

// ── Stats ─────────────────────────────────────────────────────────────────────
function updateStats() {
  let totalUsers = 0, activeChannels = 0;
  for (const id in channelState) {
    const u = (channelState[id].users || []).length;
    totalUsers += u;
    if (u > 0) activeChannels++;
  }
  setStatAnimated("statUsers", totalUsers);
  setStatAnimated("statActiveChannels", activeChannels);
  setStatAnimated("statSpeaking", speakingUsers.size);
  document.getElementById("statPtt").textContent    = pttCount;
  document.getElementById("statEvents").textContent = eventCount;
}

function updateAudioStats() {
  const el = document.getElementById("statAudioChunks");
  if (!el) return;
  el.textContent = audioChunksLast;
  el.className   = "stat-value" + (audioChunksLast > 0 ? " audio-active" : "");
  const kb = document.getElementById("statAudioKB");
  if (kb) kb.textContent = (audioBytesLast / 1024).toFixed(1) + " KB";
}

function setStatAnimated(id, val) {
  const el = document.getElementById(id);
  if (el && el.textContent !== String(val)) {
    el.textContent = val;
    el.classList.remove("pulse-anim");
    void el.offsetWidth;
    el.classList.add("pulse-anim");
  }
}

function updateUptime() {
  if (!startTime) return;
  const s = Math.floor((Date.now() - startTime) / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const el = document.getElementById("serverUptime");
  if (el) el.textContent = h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

// ── Journal ───────────────────────────────────────────────────────────────────
function addEvent(type, text) {
  const list = document.getElementById("eventsList");
  if (!list) return;
  const time = new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const li = document.createElement("li");
  li.className = `event-row event-${type}`;
  li.innerHTML = `<span class="event-dot">●</span><span class="event-time">${time}</span><span class="event-text">${text}</span>`;
  list.prepend(li);
  while (list.children.length > 150) list.removeChild(list.lastChild);
}

function clearEvents() {
  const list = document.getElementById("eventsList");
  if (list) list.innerHTML = "";
  eventCount = 0;
  const el = document.getElementById("statEvents");
  if (el) el.textContent = "0";
}

// ── Console logs ──────────────────────────────────────────────────────────────
function addLogEntry(entry, scroll) {
  logEntries.push(entry);
  if (logEntries.length > LOG_MAX) logEntries.shift();
  if (entry.level === "error") logErrorCount++;
  if (entry.level === "warn")  logWarnCount++;
  if (logFilter === "all" || logFilter === entry.level) {
    appendLogRow(entry);
    if (scroll && logAutoScroll) scrollLogsIfNeeded();
  }
}

function appendLogRow(entry) {
  const list = document.getElementById("logsList");
  if (!list) return;
  const time = new Date(entry.ts).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const div = document.createElement("div");
  div.className = `log-row log-${entry.level}`;
  div.innerHTML = `<span class="log-time">${time}</span><span class="log-level">${entry.level.toUpperCase()}</span><span class="log-msg">${escapeHtml(entry.msg)}</span>`;
  list.appendChild(div);
  while (list.children.length > LOG_MAX) list.removeChild(list.firstChild);
}

function scrollLogsIfNeeded() {
  if (!logAutoScroll) return;
  const list = document.getElementById("logsList");
  if (list) list.scrollTop = list.scrollHeight;
}

function renderLogs() {
  const list = document.getElementById("logsList");
  if (!list) return;
  list.innerHTML = "";
  const filtered = logFilter === "all" ? logEntries : logEntries.filter(e => e.level === logFilter);
  filtered.forEach(e => appendLogRow(e));
  scrollLogsIfNeeded();
}

function setLogFilter(level) {
  logFilter = level;
  document.querySelectorAll(".filter-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.level === level);
  });
  renderLogs();
}

function updateLogBadge() {
  const badge = document.getElementById("logBadge");
  if (!badge) return;
  if (logErrorCount > 0) {
    badge.textContent = logErrorCount;
    badge.className = "tab-badge has-error";
  } else if (logWarnCount > 0) {
    badge.textContent = logWarnCount;
    badge.className = "tab-badge has-warn";
  } else {
    badge.textContent = logEntries.length;
    badge.className = "tab-badge";
  }
}

function clearLogs() {
  logEntries.length = 0;
  logErrorCount = 0;
  logWarnCount  = 0;
  const list = document.getElementById("logsList");
  if (list) list.innerHTML = "";
  updateLogBadge();
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === name));
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.toggle("active", p.id === "tab-" + name));
  if (name === "logs") scrollLogsIfNeeded();
}

// ── Connexion UI ──────────────────────────────────────────────────────────────
function setConnected(ok) {
  const dot   = document.getElementById("connDot");
  const label = document.getElementById("connLabel");
  const noConn = document.getElementById("noConn");
  if (dot)   dot.className   = `status-dot ${ok ? "connected" : "disconnected"}`;
  if (label) label.textContent = ok ? "Connecté" : "Déconnecté";
  if (noConn) noConn.classList.toggle("visible", !ok);
}
