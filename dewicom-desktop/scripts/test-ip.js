const os = require("os");
const candidates = [];
for (const [name, ifaces] of Object.entries(os.networkInterfaces())) {
  for (const iface of ifaces) {
    if (iface.family !== "IPv4" || iface.internal) continue;
    if (iface.address.startsWith("169.254.")) continue;
    const lname = name.toLowerCase();
    let score = 0;
    if (lname.includes("virtualbox") || lname.includes("vmware") ||
        lname.includes("vbox") || lname.includes("hyper-v") ||
        lname.includes("tap") || lname.includes("tun") ||
        lname.includes("docker")) score -= 10;
    if (iface.address.startsWith("192.168.") || iface.address.startsWith("10.") ||
        iface.address.startsWith("172.")) score += 5;
    candidates.push({ address: iface.address, name, score });
  }
}
candidates.sort((a, b) => b.score - a.score);
console.log("Candidates:");
candidates.forEach(c => console.log(`  score=${c.score}  ${c.address}  (${c.name})`));
console.log("Selected:", candidates[0]?.address ?? "127.0.0.1");
