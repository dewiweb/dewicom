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
