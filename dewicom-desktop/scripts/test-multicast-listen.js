// Test d'écoute multicast — à lancer avec node pour diagnostiquer
// node scripts/test-multicast-listen.js
const dgram = require("dgram");
const os = require("os");

const MCAST_ADDR = "224.0.0.251";
const ports = [9998, 9999];

function getLocalIP() {
  const candidates = [];
  for (const [name, ifaces] of Object.entries(os.networkInterfaces())) {
    for (const iface of ifaces) {
      if (iface.family !== "IPv4" || iface.internal) continue;
      if (iface.address.startsWith("169.254.")) continue;
      const lname = name.toLowerCase();
      let score = 0;
      if (lname.includes("virtualbox") || lname.includes("vmware")) score -= 10;
      if (iface.address.startsWith("192.168.") || iface.address.startsWith("10.")) score += 5;
      candidates.push({ address: iface.address, name, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.address ?? "127.0.0.1";
}

const localIP = getLocalIP();
console.log(`IP locale sélectionnée: ${localIP}`);
console.log(`Écoute multicast ${MCAST_ADDR} sur ports ${ports.join(", ")}...`);
console.log("(Ctrl+C pour arrêter)\n");

for (const port of ports) {
  const sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
  sock.on("message", (msg, rinfo) => {
    console.log(`[port ${port}] Reçu de ${rinfo.address}:${rinfo.port} → ${msg.toString("utf8")}`);
  });
  sock.on("error", (e) => console.error(`[port ${port}] Erreur: ${e.message}`));
  sock.bind(port, "0.0.0.0", () => {
    try { sock.addMembership(MCAST_ADDR, localIP); } catch (e) {
      try { sock.addMembership(MCAST_ADDR); } catch (e2) {}
    }
    console.log(`[port ${port}] Prêt.`);
  });
}
