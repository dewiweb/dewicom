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

// Auto-rejoin si credentials sauvegardés
window.addEventListener("load", () => {
  if (savedName && savedChannel) {
    const hint = document.createElement("div");
    hint.style.cssText = "font-size:.75rem;color:var(--muted);text-align:center;";
    hint.innerHTML = `Bienvenue <strong style='color:var(--text)'>${savedName}</strong> — <span style='color:var(--green);cursor:pointer;text-decoration:underline' onclick='document.getElementById("joinBtn").click()'>Rejoindre directement →</span>`;
    document.getElementById("joinBtn").insertAdjacentElement("beforebegin", hint);
  }
});
