/**
 * Élection de leader DewiCom — côté Node.js/Electron.
 * Même protocole que LeaderElection.java (Bully sur multicast UDP port 9998).
 *
 * Messages : ELECTION:<nodeId>:<ip>  LEADER:<nodeId>:<ip>  HEARTBEAT:<nodeId>:<ip>
 */
const dgram = require("dgram");
const os    = require("os");

const MCAST_ADDR         = "224.0.0.251";
const ELECT_PORT         = 9998;
const HEARTBEAT_INTERVAL = 2000;
const LEADER_TIMEOUT     = 6000;
const ELECTION_WAIT      = 2000;

function getLocalIP() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces) {
      if (iface.family === "IPv4" && !iface.internal) return iface.address;
    }
  }
  return "127.0.0.1";
}

function ipToNodeId(ip) {
  const p = ip.split(".").map(Number);
  const base = ((p[0] & 0xFF) * 16777216) + ((p[1] & 0xFF) * 65536) + ((p[2] & 0xFF) * 256) + (p[3] & 0xFF);
  // Le desktop a toujours une priorité supérieure aux APK (offset de 2^32)
  return base + 4294967296;
}

class LeaderElection {
  constructor(callbacks = {}) {
    this.myIP      = getLocalIP();
    this.myNodeId  = ipToNodeId(this.myIP);
    this.state     = "FOLLOWER"; // FOLLOWER | CANDIDATE | LEADER
    this.leaderIP  = null;
    this.lastHeartbeat = 0;
    this.running   = false;

    this.onBecomeLeader  = callbacks.onBecomeLeader  || (() => {});
    this.onLeaderElected = callbacks.onLeaderElected || (() => {});

    this._heartbeatTimer = null;
    this._watchdogTimer  = null;
    this._electionTimer  = null;

    console.log(`[election] Init — IP: ${this.myIP}, nodeId: ${this.myNodeId}`);
  }

  start() {
    this.running = true;
    this._openSocket();
    // Délai aléatoire pour éviter les collisions
    const delay = 500 + Math.random() * 1000;
    setTimeout(() => this._startElection(), delay);
  }

  stop() {
    this.running = false;
    clearInterval(this._heartbeatTimer);
    clearInterval(this._watchdogTimer);
    clearTimeout(this._electionTimer);
    try { this._socket?.close(); } catch (e) {}
  }

  isLeader()   { return this.state === "LEADER"; }
  getLeaderIP(){ return this.leaderIP; }

  // ── Réseau ──────────────────────────────────────────────────────────────────

  _openSocket() {
    this._socket = dgram.createSocket({ type: "udp4", reuseAddr: true });

    this._socket.on("message", (msg, rinfo) => {
      if (rinfo.address === this.myIP) return; // ignore nos propres messages
      this._handleMessage(msg.toString("utf8"), rinfo.address);
    });

    this._socket.on("error", (e) => {
      if (this.running) console.warn("[election] Socket error:", e.message);
    });

    this._socket.bind(ELECT_PORT, () => {
      this._socket.addMembership(MCAST_ADDR);
      console.log(`[election] Écoute ${MCAST_ADDR}:${ELECT_PORT}`);
    });
  }

  _broadcast(msg) {
    const buf = Buffer.from(msg, "utf8");
    const s   = dgram.createSocket("udp4");
    s.send(buf, 0, buf.length, ELECT_PORT, MCAST_ADDR, () => s.close());
    console.log(`[election] → ${msg}`);
  }

  // ── Élection ────────────────────────────────────────────────────────────────

  _startElection() {
    if (!this.running) return;
    console.log(`[election] Lancement (nodeId=${this.myNodeId})`);
    this.state = "CANDIDATE";
    this._broadcast(`ELECTION:${this.myNodeId}:${this.myIP}`);

    clearTimeout(this._electionTimer);
    this._electionTimer = setTimeout(() => {
      if (this.state === "CANDIDATE") this._becomeLeader();
    }, ELECTION_WAIT);
  }

  _becomeLeader() {
    if (!this.running) return;
    this.state    = "LEADER";
    this.leaderIP = this.myIP;
    console.log(`[election] LEADER élu: ${this.myIP}`);
    this._broadcast(`LEADER:${this.myNodeId}:${this.myIP}`);
    this.onBecomeLeader(this.myIP);
    this._startHeartbeat();
    this._stopWatchdog();
  }

  _becomeFollower(newLeaderIP) {
    if (!this.running) return;
    const changed = newLeaderIP !== this.leaderIP;
    this.state    = "FOLLOWER";
    this.leaderIP = newLeaderIP;
    this.lastHeartbeat = Date.now();
    console.log(`[election] FOLLOWER — leader: ${newLeaderIP}`);
    if (changed) this.onLeaderElected(newLeaderIP);
    this._stopHeartbeat();
    this._startWatchdog();
  }

  // ── Traitement des messages ──────────────────────────────────────────────────

  _handleMessage(msg, senderIP) {
    const parts = msg.split(":");
    if (parts.length < 3) return;
    const [type, nodeIdStr, senderNode] = parts;
    const senderId = parseInt(nodeIdStr, 10);

    switch (type) {
      case "ELECTION":
        if (senderId > this.myNodeId) {
          // L'autre a un plus grand ID → on annule notre candidature
          this.state = "FOLLOWER";
        } else if (senderId < this.myNodeId) {
          // Notre ID est plus grand → on répond ELECTION
          this._broadcast(`ELECTION:${this.myNodeId}:${this.myIP}`);
        }
        break;

      case "LEADER":
        console.log(`[election] LEADER reçu: ${senderNode} (nodeId=${senderId})`);
        this._becomeFollower(senderNode);
        break;

      case "HEARTBEAT":
        if (senderNode === this.leaderIP) {
          this.lastHeartbeat = Date.now();
        } else if (this.state === "FOLLOWER" && senderId > this.myNodeId) {
          this._becomeFollower(senderNode);
        }
        break;
    }
  }

  // ── Heartbeat ────────────────────────────────────────────────────────────────

  _startHeartbeat() {
    this._stopHeartbeat();
    this._heartbeatTimer = setInterval(() => {
      if (this.state === "LEADER") {
        this._broadcast(`HEARTBEAT:${this.myNodeId}:${this.myIP}`);
      }
    }, HEARTBEAT_INTERVAL);
  }

  _stopHeartbeat() {
    clearInterval(this._heartbeatTimer);
    this._heartbeatTimer = null;
  }

  // ── Watchdog ─────────────────────────────────────────────────────────────────

  _startWatchdog() {
    this._stopWatchdog();
    this.lastHeartbeat = Date.now();
    this._watchdogTimer = setInterval(() => {
      if (this.state !== "FOLLOWER" || !this.running) return;
      const elapsed = Date.now() - this.lastHeartbeat;
      if (elapsed > LEADER_TIMEOUT) {
        console.warn(`[election] Leader silencieux depuis ${elapsed}ms → élection`);
        this._startElection();
      }
    }, LEADER_TIMEOUT / 2);
  }

  _stopWatchdog() {
    clearInterval(this._watchdogTimer);
    this._watchdogTimer = null;
  }
}

module.exports = { LeaderElection, getLocalIP };
