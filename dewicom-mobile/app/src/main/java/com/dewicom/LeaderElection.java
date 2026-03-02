package com.dewicom;

import android.content.Context;
import android.net.wifi.WifiManager;
import android.util.Log;

import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.MulticastSocket;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Élection de leader de type Bully sur multicast UDP.
 *
 * Protocole :
 *  - Chaque nœud a un nodeId = hash de son IP (long)
 *  - Le nœud avec le plus grand nodeId devient leader
 *  - Messages multicast sur ELECT_PORT :
 *      ELECTION:<nodeId>:<ip>  → je candidate
 *      LEADER:<nodeId>:<ip>    → j'ai gagné
 *      HEARTBEAT:<nodeId>:<ip> → je suis vivant (du leader, toutes les 2s)
 *
 * Si le leader ne heartbeate plus pendant LEADER_TIMEOUT_MS → nouvelle élection.
 */
public class LeaderElection {
    private static final String TAG = "LeaderElection";

    public static final String MCAST_ADDR = "224.0.0.251";
    public static final int ELECT_PORT   = 9998;

    private static final int HEARTBEAT_INTERVAL_MS = 2000;
    private static final int LEADER_TIMEOUT_MS      = 6000;
    private static final int ELECTION_WAIT_MS       = 2000; // attente de réponses ELECTION

    public enum State { FOLLOWER, CANDIDATE, LEADER }

    public interface Listener {
        /** Appelé quand ce nœud devient leader (doit démarrer le serveur). */
        void onBecomeLeader(String myIP);
        /** Appelé quand un leader est élu (pas nous) — doit se connecter à leaderIP. */
        void onLeaderElected(String leaderIP);
    }

    private final Context context;
    private final String myIP;
    private final long   myNodeId;
    private final Listener listener;

    private volatile State  state         = State.FOLLOWER;
    private volatile String leaderIP      = null;
    private final AtomicLong lastHeartbeat = new AtomicLong(0);
    private final AtomicReference<String> currentLeaderIP = new AtomicReference<>(null);
    private volatile boolean electionPending = false; // debounce : une seule élection à la fois

    private ScheduledExecutorService scheduler;
    private ScheduledFuture<?> heartbeatTask;
    private ScheduledFuture<?> watchdogTask;
    private ScheduledFuture<?> electionTask;
    private Thread listenThread;
    private volatile boolean running = false;

    private DatagramSocket sendSocket;
    private MulticastSocket recvSocket;
    private WifiManager.MulticastLock mcastLock;

    public LeaderElection(Context context, String myIP, Listener listener) {
        this.context  = context;
        this.myIP     = myIP;
        this.myNodeId = ipToNodeId(myIP);
        this.listener = listener;
        Log.d(TAG, "Init — IP: " + myIP + " nodeId: " + myNodeId);
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    public void start() {
        running   = true;
        scheduler = Executors.newScheduledThreadPool(2);

        acquireMulticastLock();
        startListening();

        // Lance une première élection après un délai aléatoire (évite les collisions)
        long delay = 500 + (long)(Math.random() * 1000);
        scheduler.schedule(this::startElection, delay, TimeUnit.MILLISECONDS);
    }

    public void stop() {
        running = false;
        electionPending = false;
        if (electionTask  != null) { electionTask.cancel(false);  electionTask  = null; }
        if (heartbeatTask != null) { heartbeatTask.cancel(false); heartbeatTask = null; }
        if (watchdogTask  != null) { watchdogTask.cancel(false);  watchdogTask  = null; }
        if (scheduler     != null) scheduler.shutdownNow();
        if (listenThread  != null) listenThread.interrupt();
        try { if (recvSocket != null) recvSocket.close(); } catch (Exception ignored) {}
        try { if (sendSocket != null) sendSocket.close(); } catch (Exception ignored) {}
        if (mcastLock != null && mcastLock.isHeld()) mcastLock.release();
    }

    public State  getState()    { return state; }
    public String getLeaderIP() { return currentLeaderIP.get(); }
    public boolean isLeader()   { return state == State.LEADER; }

    // ── Élection ──────────────────────────────────────────────────────────────

    private synchronized void startElection() {
        if (!running) return;
        if (electionPending) return; // debounce : une seule élection à la fois
        electionPending = true;
        state = State.CANDIDATE;
        Log.d(TAG, "Lancement élection (nodeId=" + myNodeId + ")");
        broadcast("ELECTION:" + myNodeId + ":" + myIP);

        if (electionTask != null) electionTask.cancel(false);
        electionTask = scheduler.schedule(() -> {
            electionPending = false;
            if (state == State.CANDIDATE) becomeLeader();
        }, ELECTION_WAIT_MS, TimeUnit.MILLISECONDS);
    }

    private synchronized void becomeLeader() {
        if (!running) return;
        state = State.LEADER;
        currentLeaderIP.set(myIP);
        Log.d(TAG, "Je suis le LEADER (" + myIP + ")");
        broadcast("LEADER:" + myNodeId + ":" + myIP);
        listener.onBecomeLeader(myIP);
        stopWatchdog();
        startHeartbeat();
    }

    private synchronized void becomeFollower(String newLeaderIP) {
        if (!running) return;
        boolean changed = !newLeaderIP.equals(currentLeaderIP.get());
        // Annule toute élection en cours
        if (electionTask != null) { electionTask.cancel(false); electionTask = null; }
        electionPending = false;
        state = State.FOLLOWER;
        currentLeaderIP.set(newLeaderIP);
        lastHeartbeat.set(System.currentTimeMillis());
        Log.d(TAG, "Je suis FOLLOWER, leader=" + newLeaderIP);
        if (changed) listener.onLeaderElected(newLeaderIP);
        stopHeartbeat();
        startWatchdog();
    }

    // ── Traitement des messages ────────────────────────────────────────────────

    private synchronized void handleMessage(String msg, String senderIP) {
        if (!running) return;
        String[] parts = msg.split(":");
        if (parts.length < 3) return;
        String type       = parts[0];
        long   senderId   = Long.parseLong(parts[1]);
        String senderNode = parts[2];

        switch (type) {
            case "ELECTION":
                if (senderId > myNodeId) {
                    // ID supérieur → annule notre candidature, reset heartbeat pour laisser
                    // le temps au supérieur de se proclamer avant que le watchdog intervienne
                    Log.d(TAG, "ELECTION d'un plus grand nodeId (" + senderId + ") — déférence");
                    if (state == State.CANDIDATE) {
                        if (electionTask != null) { electionTask.cancel(false); electionTask = null; }
                        electionPending = false;
                        state = State.FOLLOWER;
                    }
                    lastHeartbeat.set(System.currentTimeMillis());
                } else if (senderId < myNodeId && !electionPending) {
                    // Notre ID est plus grand → on s'annonce si pas déjà candidat
                    broadcast("ELECTION:" + myNodeId + ":" + myIP);
                }
                break;

            case "LEADER":
                Log.d(TAG, "LEADER reçu: " + senderNode + " (nodeId=" + senderId + ")");
                if (senderId >= myNodeId) {
                    // ID >= au nôtre → on se soumet (>= évite split-brain si IDs égaux)
                    becomeFollower(senderNode);
                } else if (!electionPending) {
                    // Notre ID est plus grand et pas d'élection en cours → on challenge
                    Log.d(TAG, "LEADER inférieur (" + senderId + " < " + myNodeId + ") — challenge");
                    startElection();
                }
                break;

            case "HEARTBEAT":
                if (senderNode.equals(currentLeaderIP.get())) {
                    // Heartbeat du leader connu → reset watchdog
                    lastHeartbeat.set(System.currentTimeMillis());
                } else if (senderId > myNodeId) {
                    // Heartbeat d'un nœud supérieur inconnu comme leader → on le reconnaît
                    becomeFollower(senderNode);
                }
                // Heartbeat d'un nœud inférieur (on est LEADER) → ignoré
                break;
        }
    }

    // ── Heartbeat (leader) ────────────────────────────────────────────────────

    private void startHeartbeat() {
        stopHeartbeat();
        heartbeatTask = scheduler.scheduleWithFixedDelay(
            () -> {
                if (state == State.LEADER) {
                    broadcast("HEARTBEAT:" + myNodeId + ":" + myIP);
                }
            },
            0, HEARTBEAT_INTERVAL_MS, TimeUnit.MILLISECONDS);
    }

    private void stopHeartbeat() {
        if (heartbeatTask != null) { heartbeatTask.cancel(false); heartbeatTask = null; }
    }

    // ── Watchdog (follower surveille le leader) ───────────────────────────────

    private void startWatchdog() {
        stopWatchdog();
        lastHeartbeat.set(System.currentTimeMillis());
        watchdogTask = scheduler.scheduleWithFixedDelay(() -> {
            if (state != State.FOLLOWER || !running) return;
            long elapsed = System.currentTimeMillis() - lastHeartbeat.get();
            if (elapsed > LEADER_TIMEOUT_MS) {
                Log.w(TAG, "Leader silencieux depuis " + elapsed + "ms → élection");
                startElection();
            }
        }, LEADER_TIMEOUT_MS, LEADER_TIMEOUT_MS / 2, TimeUnit.MILLISECONDS);
    }

    private void stopWatchdog() {
        if (watchdogTask != null) { watchdogTask.cancel(false); watchdogTask = null; }
    }

    // ── Réseau ────────────────────────────────────────────────────────────────

    private void broadcast(String msg) {
        try {
            if (sendSocket == null || sendSocket.isClosed()) {
                sendSocket = new DatagramSocket();
                sendSocket.setBroadcast(true);
            }
            byte[] data   = msg.getBytes("UTF-8");
            InetAddress group = InetAddress.getByName(MCAST_ADDR);
            DatagramPacket pkt = new DatagramPacket(data, data.length, group, ELECT_PORT);
            sendSocket.send(pkt);
            Log.d(TAG, "→ " + msg);
        } catch (Exception e) {
            Log.w(TAG, "Erreur broadcast: " + e.getMessage());
        }
    }

    private void startListening() {
        listenThread = new Thread(() -> {
            try {
                recvSocket = new MulticastSocket(ELECT_PORT);
                recvSocket.setReuseAddress(true);
                recvSocket.setSoTimeout(500);
                InetAddress group = InetAddress.getByName(MCAST_ADDR);
                recvSocket.joinGroup(group);
                Log.d(TAG, "Écoute élection sur " + MCAST_ADDR + ":" + ELECT_PORT);

                byte[] buf = new byte[256];
                while (running) {
                    try {
                        DatagramPacket pkt = new DatagramPacket(buf, buf.length);
                        recvSocket.receive(pkt);
                        String msg       = new String(pkt.getData(), 0, pkt.getLength(), "UTF-8");
                        String senderIP  = pkt.getAddress().getHostAddress();
                        if (!senderIP.equals(myIP)) { // ignore nos propres messages
                            handleMessage(msg, senderIP);
                        }
                    } catch (java.net.SocketTimeoutException ignored) {
                    } catch (Exception e) {
                        if (running) Log.w(TAG, "Erreur réception: " + e.getMessage());
                    }
                }
                recvSocket.leaveGroup(group);
                recvSocket.close();
            } catch (Exception e) {
                Log.e(TAG, "Erreur socket élection: " + e.getMessage());
            }
        }, "dewicom-election");
        listenThread.setDaemon(true);
        listenThread.start();
    }

    private void acquireMulticastLock() {
        try {
            WifiManager wm = (WifiManager) context.getApplicationContext()
                    .getSystemService(Context.WIFI_SERVICE);
            mcastLock = wm.createMulticastLock("dewicom_election");
            mcastLock.setReferenceCounted(true);
            mcastLock.acquire();
        } catch (Exception e) {
            Log.w(TAG, "MulticastLock: " + e.getMessage());
        }
    }

    // ── Utilitaires ───────────────────────────────────────────────────────────

    private static long ipToNodeId(String ip) {
        try {
            String[] p = ip.split("\\.");
            return ((long)(Integer.parseInt(p[0]) & 0xFF) << 24)
                 | ((long)(Integer.parseInt(p[1]) & 0xFF) << 16)
                 | ((long)(Integer.parseInt(p[2]) & 0xFF) <<  8)
                 | ((long)(Integer.parseInt(p[3]) & 0xFF));
        } catch (Exception e) {
            return (long)(Math.random() * Long.MAX_VALUE);
        }
    }
}
