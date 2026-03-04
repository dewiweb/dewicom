// Initialisation de l'application : restauration localStorage, panels, auto-rejoin
const nameInput = document.getElementById("nameInput");
const joinBtn   = document.getElementById("joinBtn");

const savedName    = localStorage.getItem("dewicom-name");
const savedChannel = localStorage.getItem("dewicom-channel");

if (savedName) {
  nameInput.value = savedName;
  joinBtn.disabled = false;
}
if (savedChannel) {
  myChannel = savedChannel;
}
renderChannelSelect();

nameInput.addEventListener("input", () => {
  joinBtn.disabled = nameInput.value.trim().length < 1;
});

joinBtn.addEventListener("click", startSession);

// Panels : participants
document.getElementById("usersBtn").onclick = () => {
  renderUsersList();
  document.getElementById("usersPanel").classList.remove("hidden");
};
document.getElementById("closeUsers").onclick = () => {
  document.getElementById("usersPanel").classList.add("hidden");
};
document.getElementById("usersPanel").addEventListener("click", (e) => {
  if (e.target === document.getElementById("usersPanel"))
    document.getElementById("usersPanel").classList.add("hidden");
});

// Panel QR Code
document.getElementById("qrBtn").onclick = async () => {
  document.getElementById("qrPanel").classList.remove("hidden");
  try {
    const res = await fetch("/qr");
    const data = await res.json();
    document.getElementById("qrImage").src = data.qr;
    document.getElementById("qrUrl").textContent = data.url;
  } catch(e) {
    document.getElementById("qrUrl").textContent = window.location.href;
  }
};
document.getElementById("closeQr").onclick = () => {
  document.getElementById("qrPanel").classList.add("hidden");
};
document.getElementById("qrPanel").addEventListener("click", (e) => {
  if (e.target === document.getElementById("qrPanel"))
    document.getElementById("qrPanel").classList.add("hidden");
});

// ── Panel paramètres audio ────────────────────────────────────────────────────

async function openAudioSettings() {
  const panel = document.getElementById("audioPanel");
  panel.classList.remove("hidden");

  const inputSel  = document.getElementById("inputDeviceSelect");
  const outputSel = document.getElementById("outputDeviceSelect");
  const status    = document.getElementById("audioStatus");
  status.textContent = "Chargement des périphériques…";
  status.className   = "audio-status";

  const { inputs, outputs } = await enumerateAudioDevices();

  // Remplir les selects (garder l'option "Par défaut" en premier)
  inputSel.innerHTML  = `<option value="">Par défaut du système</option>`;
  outputSel.innerHTML = `<option value="">Par défaut du système</option>`;

  inputs.forEach(d => {
    const opt = document.createElement("option");
    opt.value = d.deviceId;
    opt.textContent = d.label || `Microphone (${d.deviceId.slice(0,8)}…)`;
    if (d.deviceId === selectedInputId) opt.selected = true;
    inputSel.appendChild(opt);
  });

  outputs.forEach(d => {
    const opt = document.createElement("option");
    opt.value = d.deviceId;
    opt.textContent = d.label || `Sortie audio (${d.deviceId.slice(0,8)}…)`;
    if (d.deviceId === selectedOutputId) opt.selected = true;
    outputSel.appendChild(opt);
  });

  if (!outputs.length) {
    outputSel.innerHTML = `<option value="">Non supporté sur ce navigateur</option>`;
    outputSel.disabled = true;
  }

  status.textContent = inputs.length
    ? `${inputs.length} entrée(s) · ${outputs.length} sortie(s) détectée(s)`
    : "Aucun périphérique détecté — vérifiez les permissions microphone";
  status.className = inputs.length ? "audio-status ok" : "audio-status err";
}

document.getElementById("audioSettingsBtn").onclick = openAudioSettings;
document.getElementById("closeAudio").onclick = () =>
  document.getElementById("audioPanel").classList.add("hidden");
document.getElementById("audioPanel").addEventListener("click", (e) => {
  if (e.target === document.getElementById("audioPanel"))
    document.getElementById("audioPanel").classList.add("hidden");
});

document.getElementById("applyAudioBtn").onclick = async () => {
  const inputId  = document.getElementById("inputDeviceSelect").value;
  const outputId = document.getElementById("outputDeviceSelect").value;
  const status   = document.getElementById("audioStatus");
  const btn      = document.getElementById("applyAudioBtn");

  btn.disabled   = true;
  btn.textContent = "Application…";
  status.textContent = "";
  status.className   = "audio-status";

  try {
    await applyAudioDevices(inputId, outputId);
    status.textContent = "✓ Périphériques appliqués";
    status.className   = "audio-status ok";
    setTimeout(() => document.getElementById("audioPanel").classList.add("hidden"), 900);
  } catch(e) {
    status.textContent = "Erreur : " + (e.message || e);
    status.className   = "audio-status err";
  } finally {
    btn.disabled    = false;
    btn.textContent = "Appliquer";
  }
};

// Bouton paramètres réseau — visible uniquement sous Electron
function openNetworkSettings() {
  if (window.DewiComDesktop) window.DewiComDesktop.openSettings();
}
if (window.DewiComDesktop && typeof window.DewiComDesktop.openSettings === "function") {
  const btn = document.getElementById("networkSettingsBtn");
  if (btn) btn.style.display = "flex";
}

// Auto-rejoin automatique si credentials sauvegardés — pas de formulaire
window.addEventListener("load", () => {
  if (savedName && savedChannel) {
    // Rejoindre automatiquement après 300ms (laisse le DOM se stabiliser)
    setTimeout(() => startSession(), 300);
  }
});
