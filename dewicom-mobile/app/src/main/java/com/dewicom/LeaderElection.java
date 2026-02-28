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

    private ScheduledExecutorService scheduler;
    private ScheduledFuture<?> heartbeatTask;
    private ScheduledFuture<?> watchdogTask;
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
        if (heartbeatTask != null) heartbeatTask.cancel(false);
        if (watchdogTask  != null) watchdogTask.cancel(false);
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

    private void startElection() {
        if (!running) return;
        Log.d(TAG, "Lancement élection (nodeId=" + myNodeId + ")");
        state = State.CANDIDATE;
        broadcast("ELECTION:" + myNodeId + ":" + myIP);

        // Après ELECTION_WAIT_MS, si on n'a reçu aucune réponse d'un plus grand ID → on gagne
        scheduler.schedule(() -> {
            if (state == State.CANDIDATE) {
                becomeLeader();
            }
        }, ELECTION_WAIT_MS, TimeUnit.MILLISECONDS);
    }

    private void becomeLeader() {
        if (!running) return;
        state = State.LEADER;
        currentLeaderIP.set(myIP);
        Log.d(TAG, "Je suis le LEADER (" + myIP + ")");
        broadcast("LEADER:" + myNodeId + ":" + myIP);
        listener.onBecomeLeader(myIP);
        startHeartbeat();
        stopWatchdog();
    }

    private void becomeFollower(String newLeaderIP) {
        if (!running) return;
        boolean changed = !newLeaderIP.equals(currentLeaderIP.get());
        state = State.FOLLOWER;
        currentLeaderIP.set(newLeaderIP);
        lastHeartbeat.set(System.currentTimeMillis());
        Log.d(TAG, "Je suis FOLLOWER, leader=" + newLeaderIP);
        if (changed) {
            listener.onLeaderElected(newLeaderIP);
        }
        stopHeartbeat();
        startWatchdog();
    }

    // ── Traitement des messages ────────────────────────────────────────────────

    private void handleMessage(String msg, String senderIP) {
        if (!running) return;
        String[] parts = msg.split(":");
        if (parts.length < 3) return;
        String type      = parts[0];
        long   senderId  = Long.parseLong(parts[1]);
        String senderNode = parts[2];

        switch (type) {
            case "ELECTION":
                if (senderId > myNodeId) {
                    // L'expéditeur a un ID plus grand → on se défère, on reste candidat/follower
                    Log.d(TAG, "ELECTION reçue d'un plus grand nodeId (" + senderId + ") — on se défère");
                    state = State.FOLLOWER; // annule notre candidature
                } else if (senderId < myNodeId) {
                    // Notre ID est plus grand → on répond ELECTION pour le décourager
                    broadcast("ELECTION:" + myNodeId + ":" + myIP);
                }
                break;

            case "LEADER":
                Log.d(TAG, "LEADER reçu: " + senderNode + " (nodeId=" + senderId + ")");
                becomeFollower(senderNode);
                break;

            case "HEARTBEAT":
                if (senderNode.equals(currentLeaderIP.get())) {
                    lastHeartbeat.set(System.currentTimeMillis());
                } else if (state == State.FOLLOWER && senderId > myNodeId) {
                    // Heartbeat d'un leader qu'on ne connaissait pas encore
                    becomeFollower(senderNode);
                }
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
