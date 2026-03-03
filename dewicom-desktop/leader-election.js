/**
 * Élection de leader DewiCom — côté Node.js/Electron.
 * Même protocole que LeaderElection.java (Bully sur multicast UDP port 9998).
 *
 * Messages : ELECTION:<nodeId>:<ip>  LEADER:<nodeId>:<ip>  HEARTBEAT:<nodeId>:<ip>
 */
const dgram = require("dgram");
const os    = require("os");
const fs    = require("fs");
const path  = require("path");

const MCAST_ADDR         = "224.0.0.251";
const ELECT_PORT         = 9998;
const HEARTBEAT_INTERVAL = 1000;  // heartbeat toutes les 1s
const LEADER_TIMEOUT     = 3000;  // 3s sans heartbeat → re-élection
const ELECTION_WAIT      = 1000;  // 1s d'attente avant de se proclamer leader
const BROADCAST_COOLDOWN = 300;   // anti-storm : cooldown entre deux broadcasts ELECTION

function getForcedInterface() {
  try {
    const { app } = require("electron");
    const configPath = path.join(app.getPath("userData"), "server-config.json");
    const saved = JSON.parse(fs.readFileSync(configPath, "utf8"));
    return saved.forcedInterface || null;
  } catch (e) { return null; }
}

function getLocalIP() {
  const forced = getForcedInterface();
  if (forced) return forced;
  const candidates = [];
  for (const [name, ifaces] of Object.entries(os.networkInterfaces())) {
    for (const iface of ifaces) {
      if (iface.family !== "IPv4" || iface.internal) continue;
      if (iface.address.startsWith("169.254.")) continue; // APIPA — pas de routeur
      const lname = name.toLowerCase();
      let score = 0;
      if (lname.includes("virtualbox") || lname.includes("vmware") ||
          lname.includes("vbox") || lname.includes("hyper-v") ||
          lname.includes("loopback") || lname.includes("tap") ||
          lname.includes("tun") || lname.includes("docker") ||
          lname.startsWith("virbr") || lname.startsWith("veth") ||
          lname.startsWith("br-") || lname.startsWith("lxc") ||
          lname.startsWith("lxd")) score -= 10;
      if (iface.address.startsWith("192.168.") || iface.address.startsWith("10.") ||
          iface.address.startsWith("172.")) score += 5;
      candidates.push({ address: iface.address, score });
    }
  }
  if (candidates.length === 0) return "127.0.0.1";
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].address;
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

    this._heartbeatTimer  = null;
    this._watchdogTimer   = null;
    this._electionTimer   = null;
    this._electionPending = false; // debounce : une seule élection à la fois
    this._lastBroadcastTs = 0;     // anti-storm : timestamp du dernier broadcast ELECTION

    console.log(`[election] Init — IP: ${this.myIP}, nodeId: ${this.myNodeId}`);
  }

  start() {
    this.running = true;
    this._openSocket();
    const delay = 500 + Math.random() * 1000;
    setTimeout(() => this._startElection(), delay);
  }

  stop() {
    this.running = false;
    clearInterval(this._heartbeatTimer);
    clearInterval(this._watchdogTimer);
    clearTimeout(this._electionTimer);
    this._electionPending = false;
    try { this._socket?.close(); } catch (e) {}
  }

  // Pause propre avant veille : arrête les timers sans fermer le socket
  pauseTimers() {
    clearInterval(this._heartbeatTimer);  this._heartbeatTimer = null;
    clearInterval(this._watchdogTimer);   this._watchdogTimer  = null;
    clearTimeout(this._electionTimer);    this._electionTimer  = null;
    this._electionPending = false;
    console.log("[election] Timers suspendus (veille système)");
  }

  // Reprise après réveil : repart proprement selon l'état courant
  resumeTimers() {
    if (!this.running) return;
    this.lastHeartbeat = Date.now(); // évite un faux timeout immédiat
    if (this.state === "LEADER") {
      this._startHeartbeat(); // reprend uniquement le heartbeat — pas de callback onBecomeLeader
    } else {
      this._startWatchdog(); // reprend watchdog follower
    }
    console.log("[election] Timers repris après réveil (état: " + this.state + ")");
  }

  isLeader()   { return this.state === "LEADER"; }
  getLeaderIP(){ return this.leaderIP; }

  // ── Réseau ──────────────────────────────────────────────────────────────────

  _openSocket() {
    this._socket = dgram.createSocket({ type: "udp4", reuseAddr: true });

    this._socket.on("message", (msg, rinfo) => {
      if (rinfo.address === this.myIP) return;
      this._handleMessage(msg.toString("utf8"), rinfo.address);
    });

    this._socket.on("error", (e) => {
      if (this.running) console.warn("[election] Socket error:", e.message);
    });

    this._socket.bind(ELECT_PORT, "0.0.0.0", () => {
      try { this._socket.addMembership(MCAST_ADDR, this.myIP); } catch (e) {
        try { this._socket.addMembership(MCAST_ADDR); } catch (e2) {}
      }
      console.log(`[election] Écoute ${MCAST_ADDR}:${ELECT_PORT}`);
    });
  }

  _broadcast(msg) {
    const buf = Buffer.from(msg, "utf8");
    const s   = dgram.createSocket("udp4");
    s.bind(0, () => {
      try { s.setMulticastInterface(this.myIP); } catch (e) {}
      s.setMulticastTTL(4);
      s.send(buf, 0, buf.length, ELECT_PORT, MCAST_ADDR, () => s.close());
    });
    console.log(`[election] → ${msg}`);
  }

  // ── Élection ────────────────────────────────────────────────────────────────

  _startElection() {
    if (!this.running) return;
    if (this._electionPending) return; // debounce : une seule élection à la fois
    this._electionPending = true;
    this.state = "CANDIDATE";
    console.log(`[election] Lancement (nodeId=${this.myNodeId})`);
    this._broadcastElection();

    clearTimeout(this._electionTimer);
    this._electionTimer = setTimeout(() => {
      this._electionPending = false;
      if (this.state === "CANDIDATE") this._becomeLeader();
    }, ELECTION_WAIT);
  }

  _broadcastElection() {
    const now = Date.now();
    if (now - this._lastBroadcastTs < BROADCAST_COOLDOWN) return; // anti-storm
    this._lastBroadcastTs = now;
    this._broadcast(`ELECTION:${this.myNodeId}:${this.myIP}`);
  }

  _becomeLeader() {
    if (!this.running) return;
    this.state    = "LEADER";
    this.leaderIP = this.myIP;
    console.log(`[election] LEADER élu: ${this.myIP}`);
    this._broadcast(`LEADER:${this.myNodeId}:${this.myIP}`);
    this.onBecomeLeader(this.myIP);
    this._stopWatchdog();
    this._startHeartbeat();
  }

  _becomeFollower(newLeaderIP) {
    if (!this.running) return;
    const changed = newLeaderIP !== this.leaderIP;
    // Annule toute élection en cours
    clearTimeout(this._electionTimer);
    this._electionPending = false;
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
          // ID supérieur reçu → on se retire quelle que soit notre état (CANDIDATE ou LEADER)
          if (this.state === "LEADER") {
            // Un nœud supérieur arrive ou revient : on cède immédiatement
            console.log(`[election] ELECTION d'un supérieur (${senderId}) alors qu'on est LEADER — démission`);
            this._stopHeartbeat();
            this.leaderIP = null;
          }
          if (this.state === "CANDIDATE") {
            clearTimeout(this._electionTimer);
            this._electionPending = false;
          }
          this.state = "FOLLOWER";
          // Reset lastHeartbeat pour laisser le supérieur le temps de se proclamer
          this.lastHeartbeat = Date.now();
          this._startWatchdog(); // surveille que le supérieur se proclame bien
          // Protocole Bully : répondre OK pour signaler qu'on se déférence
          this._broadcast(`OK:${this.myNodeId}:${this.myIP}`);
        } else if (senderId < this.myNodeId) {
          // Notre ID est plus grand → on démarre notre propre élection (anti-storm)
          if (!this._electionPending) {
            this._startElection();
          } else {
            this._broadcastElection(); // déjà candidat, re-broadcast avec cooldown
          }
        }
        // senderId === myNodeId : collision d'IP improbable, ignoré
        break;

      case "OK":
        // Un nœud supérieur prend le relais — on annule notre candidature
        if (this.state === "CANDIDATE" && senderId > this.myNodeId) {
          clearTimeout(this._electionTimer);
          this._electionPending = false;
          this.state = "FOLLOWER";
          this.lastHeartbeat = Date.now();
          this._startWatchdog();
        }
        break;

      case "LEADER":
        console.log(`[election] LEADER reçu: ${senderNode} (nodeId=${senderId})`);
        if (senderId >= this.myNodeId) {
          // Le leader a un ID >= au nôtre — on se soumet (>= évite split-brain si IDs égaux)
          this._becomeFollower(senderNode);
        } else if (!this._electionPending) {
          // Notre ID est plus grand et pas d'élection en cours — on challenge
          console.log(`[election] LEADER inférieur (${senderId} < ${this.myNodeId}) — challenge`);
          this._startElection();
        }
        break;

      case "HEARTBEAT":
        if (senderNode === this.leaderIP) {
          // Heartbeat du leader connu : reset watchdog
          this.lastHeartbeat = Date.now();
        } else if (senderId > this.myNodeId) {
          // Heartbeat d'un nœud supérieur inconnu comme leader → on le reconnaît
          this._becomeFollower(senderNode);
        }
        // Heartbeat d'un nœud inférieur alors qu'on est LEADER → on ignore
        break;
    }
  }

  // ── Heartbeat ────────────────────────────────────────────────────────────────

  _startHeartbeat() {
    this._stopHeartbeat();
    this._heartbeatTimer = setInterval(() => {
      if (this.state === "LEADER" && this.running) {
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
