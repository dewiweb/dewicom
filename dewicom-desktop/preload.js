const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("DewiComDesktop", {
  getServerUrl: () => ipcRenderer.invoke("get-server-url"),
  rediscover: () => ipcRenderer.invoke("rediscover"),
  onDiscoveryStatus: (fn) => ipcRenderer.on("discovery-status", (_, msg) => fn(msg)),
});
