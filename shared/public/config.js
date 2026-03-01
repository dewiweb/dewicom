// Constantes et état global partagé de l'application DewiCom
const CHANNELS_DEFAULT = [
  { id: "general", name: "Général",   color: "#6b7280" },
  { id: "foh",     name: "FOH Son",   color: "#3b82f6" },
  { id: "plateau", name: "Plateau",   color: "#f97316" },
  { id: "lumiere", name: "Lumière",   color: "#a855f7" },
  { id: "regie",   name: "Régie",     color: "#22c55e" },
];

// Identifiant client persistant (survit aux reconnexions)
let clientId = localStorage.getItem("dewicom-clientId");
if (!clientId) {
  clientId = crypto.randomUUID();
  localStorage.setItem("dewicom-clientId", clientId);
}

let socket = null;
let myName = "";
let myChannel = "general";
let channels = [...CHANNELS_DEFAULT];
let channelState = {};
let mediaStream = null;
let audioCtx = null;
let processor = null;
let speaking = false;
let channelStates = {};
let directorMode = false;
let ringSoundEnabled = true;
let pttMode = true;
let allPttKeys = ["Space", "Enter", "KeyZ", "KeyX", "MediaPlayPause", "MediaTrackNext", "MediaTrackPrevious", "MediaStop"];
let mediaKeyState = {};
