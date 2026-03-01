package com.dewicom;

import android.content.Context;
import android.util.Log;

import fi.iki.elonen.NanoHTTPD;

import org.java_websocket.WebSocket;
import org.java_websocket.handshake.ClientHandshake;
import org.java_websocket.server.WebSocketServer;

import java.io.IOException;
import java.io.InputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.Timer;
import java.util.TimerTask;

public class LocalWebServer {
    private static final String TAG = "LocalWebServer";
    public static final int HTTP_PORT = 3001;
    public static final int WS_PORT = 3002;

    private static final String MCAST_ADDR = "224.0.0.251";
    private static final int MCAST_PORT = 9999;

    private final Context context;
    private HttpServer httpServer;
    private DewiComWSServer wsServer;
    private Timer announceTimer;
    private DatagramSocket announceSocket;
    private boolean running = false;

    // État partagé
    final Map<String, Set<WebSocket>> channelSockets = new HashMap<>();
    final Map<WebSocket, String[]> socketUser = new HashMap<>();

    public LocalWebServer(Context context) {
        this.context = context;
        for (String ch : new String[]{"general","foh","plateau","lumiere","regie"}) {
            channelSockets.put(ch, new HashSet<>());
        }
    }

    public void start() throws IOException {
        httpServer = new HttpServer();
        httpServer.start(NanoHTTPD.SOCKET_READ_TIMEOUT, false);

        wsServer = new DewiComWSServer(new InetSocketAddress(WS_PORT));
        wsServer.start();

        running = true;
        Log.d(TAG, "Serveurs démarrés - HTTP:" + HTTP_PORT + " WS:" + WS_PORT);

        // Lance les annonces multicast pour que d'autres APK nous trouvent
        startMulticastAnnounce();
    }

    public void stop() {
        if (announceTimer != null) { announceTimer.cancel(); announceTimer = null; }
        if (announceSocket != null) { announceSocket.close(); announceSocket = null; }
        if (httpServer != null) httpServer.stop();
        if (wsServer != null) {
            try { wsServer.stop(); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
        }
        running = false;
    }

    private void startMulticastAnnounce() {
        try {
            // Récupère l'IP locale pour l'inclure dans l'annonce
            NetworkDiscovery.SubnetInfo info = NetworkDiscovery.getSubnetInfo(context);
            final String localIP = info.deviceIPv4 != null ? info.deviceIPv4 : "127.0.0.1";

            announceSocket = new DatagramSocket();
            announceSocket.setBroadcast(true);

            final byte[] payload = ("{\"service\":\"DewiCom\",\"version\":\"1.0.0\"," +
                    "\"ip\":\"" + localIP + "\"," +
                    "\"port\":" + HTTP_PORT + "," +
                    "\"protocol\":\"http\"," +
                    "\"mode\":\"apk\"}").getBytes("UTF-8");

            final InetAddress group = InetAddress.getByName(MCAST_ADDR);

            announceTimer = new Timer("dewicom-announce", true);
            announceTimer.scheduleAtFixedRate(new TimerTask() {
                @Override
                public void run() {
                    try {
                        DatagramPacket packet = new DatagramPacket(payload, payload.length, group, MCAST_PORT);
                        announceSocket.send(packet);
                        Log.d(TAG, "Annonce multicast envoyée: " + localIP);
                    } catch (Exception e) {
                        Log.w(TAG, "Erreur annonce multicast", e);
                    }
                }
            }, 0, 2000); // immédiat puis toutes les 2s

            Log.d(TAG, "Annonces multicast démarrées sur " + MCAST_ADDR + ":" + MCAST_PORT);
        } catch (Exception e) {
            Log.w(TAG, "Impossible de démarrer les annonces multicast", e);
        }
    }

    public boolean isAlive() {
        return running;
    }

    // ── Serveur HTTP (NanoHTTPD) ──────────────────────────────────────────────
    private class HttpServer extends NanoHTTPD {
        HttpServer() { super(HTTP_PORT); }

        @Override
        public Response serve(IHTTPSession session) {
            String uri = session.getUri();
            Log.d(TAG, "HTTP: " + uri);

            if (uri.equals("/api/dewicom-discovery") || uri.equals("/api/ping")) {
                String json = "{\"service\":\"DewiCom\",\"version\":\"1.0.0\",\"status\":\"running\",\"mode\":\"apk\"}";
                Response r = newFixedLengthResponse(Response.Status.OK, "application/json", json);
                r.addHeader("Access-Control-Allow-Origin", "*");
                return r;
            }

            String path = uri.equals("/") ? "public/index.html" : "public" + uri;
            try {
                InputStream is = context.getAssets().open(path);
                return newChunkedResponse(Response.Status.OK, getMime(uri), is);
            } catch (IOException e) {
                try {
                    InputStream is = context.getAssets().open("public/index.html");
                    return newChunkedResponse(Response.Status.OK, "text/html", is);
                } catch (IOException e2) {
                    return newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "404");
                }
            }
        }

        private String getMime(String uri) {
            if (uri.endsWith(".js")) return "application/javascript";
            if (uri.endsWith(".css")) return "text/css";
            if (uri.endsWith(".json")) return "application/json";
            if (uri.endsWith(".png")) return "image/png";
            return "text/html";
        }
    }

    // ── Serveur WebSocket (Java-WebSocket) ───────────────────────────────────
    private class DewiComWSServer extends WebSocketServer {
        DewiComWSServer(InetSocketAddress addr) { super(addr); }

        @Override
        public void onOpen(WebSocket ws, ClientHandshake h) {
            Log.d(TAG, "WS connecté: " + ws.getRemoteSocketAddress());
        }

        @Override
        public void onClose(WebSocket ws, int code, String reason, boolean remote) {
            synchronized (LocalWebServer.this) {
                String[] user = socketUser.remove(ws);
                if (user != null) {
                    Set<WebSocket> ch = channelSockets.get(user[1]);
                    if (ch != null) ch.remove(ws);
                    broadcastAll("42[\"user-left\",{\"name\":\"" + user[0] + "\",\"channel\":\"" + user[1] + "\"}]");
                    Log.d(TAG, user[0] + " déconnecté");
                }
            }
        }

        @Override
        public void onMessage(WebSocket ws, String text) {
            Log.d(TAG, "WS msg: " + text);
            try {
                // Socket.io protocol: "42["event",data]"
                String payload = text;
                if (payload.startsWith("4")) payload = payload.substring(1);
                if (payload.startsWith("2")) { ws.send("3"); return; } // heartbeat
                if (!payload.startsWith("[")) return;

                String event = extractArrayString(payload, 0);
                if (event == null) return;
                Log.d(TAG, "Event: " + event);

                switch (event) {
                    case "join": {
                        String name = extractJson(payload, "name");
                        String channel = extractJson(payload, "channel");
                        String clientId = extractJson(payload, "clientId");
                        if (name == null || channel == null) return;
                        synchronized (LocalWebServer.this) {
                            // Nettoie toute entrée existante avec le même clientId ou nom (reconnexion)
                            java.util.Iterator<Map.Entry<WebSocket, String[]>> it = socketUser.entrySet().iterator();
                            while (it.hasNext()) {
                                Map.Entry<WebSocket, String[]> entry = it.next();
                                if (entry.getKey() == ws) continue;
                                String[] u = entry.getValue();
                                boolean sameClient = (clientId != null && clientId.equals(u.length > 2 ? u[2] : null))
                                        || (clientId == null && name.equals(u[0]));
                                if (sameClient) {
                                    for (Set<WebSocket> s : channelSockets.values()) s.remove(entry.getKey());
                                    it.remove();
                                }
                            }
                            // Retire des anciens canaux du ws courant
                            String[] old = socketUser.get(ws);
                            if (old != null) {
                                for (Set<WebSocket> s : channelSockets.values()) s.remove(ws);
                            }
                            socketUser.put(ws, new String[]{name, channel, clientId != null ? clientId : ""});
                            channelSockets.computeIfAbsent(channel, k -> new HashSet<>()).add(ws);
                            // Ajoute aussi dans les listenChannels (mode director)
                            String listenRaw = extractJsonArray(payload, "listenChannels");
                            if (listenRaw != null) {
                                for (String lch : listenRaw.split(",")) {
                                    lch = lch.trim().replace("\"", "").replace("[", "").replace("]", "");
                                    if (!lch.isEmpty() && !lch.equals(channel)) {
                                        channelSockets.computeIfAbsent(lch, k -> new HashSet<>()).add(ws);
                                    }
                                }
                            }
                        }
                        ws.send("42[\"channels-init\"," + buildChannelsJson() + "]");
                        broadcastChannel(channel, "42[\"user-joined\",{\"name\":\"" + name + "\",\"channel\":\"" + channel + "\"}]", ws);
                        Log.d(TAG, name + " rejoint " + channel);
                        break;
                    }
                    case "switch-channel": {
                        String newCh = extractJson(payload, "channel");
                        if (newCh == null) return;
                        String[] user = socketUser.get(ws);
                        if (user == null) return;
                        synchronized (LocalWebServer.this) {
                            Set<WebSocket> old = channelSockets.get(user[1]);
                            if (old != null) old.remove(ws);
                            broadcastChannel(user[1], "42[\"user-left\",{\"name\":\"" + user[0] + "\",\"channel\":\"" + user[1] + "\"}]", ws);
                            user[1] = newCh;
                            channelSockets.computeIfAbsent(newCh, k -> new HashSet<>()).add(ws);
                        }
                        broadcastChannel(newCh, "42[\"user-joined\",{\"name\":\"" + user[0] + "\",\"channel\":\"" + newCh + "\"}]", ws);
                        break;
                    }
                    case "ptt-start": {
                        String[] user = socketUser.get(ws);
                        if (user == null) return;
                        broadcastChannel(user[1], "42[\"ptt-state\",{\"from\":\"" + user[0] + "\",\"fromId\":\"" + ws.hashCode() + "\",\"channel\":\"" + user[1] + "\",\"speaking\":true}]", ws);
                        break;
                    }
                    case "ptt-stop": {
                        String[] user = socketUser.get(ws);
                        if (user == null) return;
                        broadcastChannel(user[1], "42[\"ptt-state\",{\"from\":\"" + user[0] + "\",\"fromId\":\"" + ws.hashCode() + "\",\"channel\":\"" + user[1] + "\",\"speaking\":false}]", ws);
                        break;
                    }
                    case "audio-chunk": {
                        String[] user = socketUser.get(ws);
                        if (user == null) return;
                        broadcastChannel(user[1], text, ws);
                        break;
                    }
                    case "call-ring": {
                        String[] user = socketUser.get(ws);
                        if (user == null) return;
                        broadcastAllExcept("42[\"call-ring\",{\"from\":\"" + user[0] + "\",\"channel\":\"" + user[1] + "\"}]", ws);
                        break;
                    }
                }
            } catch (Exception e) {
                Log.e(TAG, "Erreur message", e);
            }
        }

        @Override
        public void onMessage(WebSocket ws, java.nio.ByteBuffer buf) {
            String[] user = socketUser.get(ws);
            if (user == null) return;
            broadcastChannelBinary(user[1], buf, ws);
        }

        @Override
        public void onError(WebSocket ws, Exception e) {
            Log.e(TAG, "WS erreur", e);
        }

        @Override
        public void onStart() {
            Log.d(TAG, "WS serveur démarré sur port " + WS_PORT);
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────
    private synchronized void broadcastChannel(String channel, String msg, WebSocket sender) {
        Set<WebSocket> sockets = channelSockets.get(channel);
        if (sockets == null) return;
        for (WebSocket ws : new HashSet<>(sockets)) {
            if (ws != sender && ws.isOpen()) ws.send(msg);
        }
    }

    private synchronized void broadcastChannelBinary(String channel, java.nio.ByteBuffer buf, WebSocket sender) {
        Set<WebSocket> sockets = channelSockets.get(channel);
        if (sockets == null) return;
        for (WebSocket ws : new HashSet<>(sockets)) {
            if (ws != sender && ws.isOpen()) ws.send(buf);
        }
    }

    private synchronized void broadcastAll(String msg) {
        for (Set<WebSocket> sockets : channelSockets.values()) {
            for (WebSocket ws : sockets) { if (ws.isOpen()) ws.send(msg); }
        }
    }

    private synchronized void broadcastAllExcept(String msg, WebSocket sender) {
        for (Set<WebSocket> sockets : channelSockets.values()) {
            for (WebSocket ws : new HashSet<>(sockets)) {
                if (ws.isOpen() && ws != sender) ws.send(msg);
            }
        }
    }

    private String buildChannelsJson() {
        StringBuilder sb = new StringBuilder("[");
        String[][] defs = {{"general","Général","#4CAF50"},{"foh","FOH","#2196F3"},{"plateau","Plateau","#FF9800"},{"lumiere","Lumière","#9C27B0"},{"regie","Régie","#F44336"}};
        for (int i = 0; i < defs.length; i++) {
            if (i > 0) sb.append(",");
            String ch = defs[i][0];
            int n = channelSockets.containsKey(ch) ? channelSockets.get(ch).size() : 0;
            sb.append("{\"id\":\"").append(ch).append("\",\"name\":\"").append(defs[i][1]).append("\",\"color\":\"").append(defs[i][2]).append("\",\"users\":").append(n).append("}");
        }
        return sb.append("]").toString();
    }

    private String extractJson(String json, String key) {
        String s = "\"" + key + "\":\"";
        int i = json.indexOf(s); if (i < 0) return null;
        i += s.length();
        int e = json.indexOf("\"", i); if (e < 0) return null;
        return json.substring(i, e);
    }

    private String extractJsonArray(String json, String key) {
        String s = "\"" + key + "\":[";
        int i = json.indexOf(s); if (i < 0) return null;
        i += s.length() - 1;
        int e = json.indexOf("]", i); if (e < 0) return null;
        return json.substring(i, e + 1);
    }

    private String extractArrayString(String array, int index) {
        int depth = 0, count = 0;
        for (int i = 0; i < array.length(); i++) {
            char c = array.charAt(i);
            if (c == '[' || c == '{') depth++;
            else if (c == ']' || c == '}') depth--;
            else if (c == '"' && depth == 1) {
                if (count == index) {
                    int e = array.indexOf("\"", i + 1);
                    return e < 0 ? null : array.substring(i + 1, e);
                }
                count++;
                i = array.indexOf("\"", i + 1);
                if (i < 0) return null;
            }
        }
        return null;
    }
}
