const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("DewiComDesktop", {
  getServerUrl: () => ipcRenderer.invoke("get-server-url"),
  rediscover: () => ipcRenderer.invoke("rediscover"),
  onDiscoveryStatus: (fn) => ipcRenderer.on("discovery-status", (_, msg) => fn(msg)),
  onServerChanged: (fn) => ipcRenderer.on("server-changed", (_, url) => fn(url)),
  getNetworkInterfaces: () => ipcRenderer.invoke("get-network-interfaces"),
  getSelectedInterface: () => ipcRenderer.invoke("get-selected-interface"),
  setNetworkInterface: (ip) => ipcRenderer.invoke("set-network-interface", ip),
  openSettings: () => ipcRenderer.invoke("open-settings"),
});
