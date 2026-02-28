package com.dewicom;

import android.content.Context;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.util.Log;

import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.SocketException;
import java.net.URL;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;

import java.security.cert.X509Certificate;

public class NetworkDiscovery {
    private static final String TAG = "NetworkDiscovery";
    private static final int CONNECT_TIMEOUT_MS = 400;
    private static final int PARALLEL_THREADS = 50;

    // ── Détection adresse locale ──────────────────────────────────────────────

    /**
     * Retourne le subnet IPv4 (ex: "192.168.1") depuis le WiFi ou les interfaces.
     * Retourne aussi les adresses IPv6 link-local utiles.
     */
    public static SubnetInfo getSubnetInfo(Context context) {
        SubnetInfo info = new SubnetInfo();

        // 1. Essaie via WifiManager (plus fiable sur Android)
        try {
            WifiManager wifiManager = (WifiManager) context.getApplicationContext()
                    .getSystemService(Context.WIFI_SERVICE);
            if (wifiManager != null && wifiManager.isWifiEnabled()) {
                WifiInfo wifiInfo = wifiManager.getConnectionInfo();
                int ipInt = wifiInfo.getIpAddress();
                if (ipInt != 0) {
                    String ip = String.format("%d.%d.%d.%d",
                            (ipInt & 0xff),
                            (ipInt >> 8 & 0xff),
                            (ipInt >> 16 & 0xff),
                            (ipInt >> 24 & 0xff));
                    String[] parts = ip.split("\\.");
                    info.deviceIPv4 = ip;
                    info.subnet = parts[0] + "." + parts[1] + "." + parts[2];
                    info.lastOctet = Integer.parseInt(parts[3]);
                    Log.d(TAG, "WiFi IP: " + ip + " -> subnet: " + info.subnet);
                    return info;
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "WifiManager failed", e);
        }

        // 2. Fallback via NetworkInterface
        try {
            for (NetworkInterface intf : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!intf.isUp() || intf.isLoopback()) continue;
                for (InetAddress addr : Collections.list(intf.getInetAddresses())) {
                    if (addr.isLoopbackAddress()) continue;
                    String host = addr.getHostAddress();
                    if (host == null) continue;
                    if (host.contains(":")) {
                        // IPv6 link-local (commence par fe80)
                        if (host.startsWith("fe80")) info.ipv6Addresses.add(host.split("%")[0]);
                    } else {
                        String[] parts = host.split("\\.");
                        if (parts.length == 4) {
                            info.deviceIPv4 = host;
                            info.subnet = parts[0] + "." + parts[1] + "." + parts[2];
                            info.lastOctet = Integer.parseInt(parts[3]);
                        }
                    }
                }
            }
        } catch (SocketException e) {
            Log.e(TAG, "NetworkInterface failed", e);
        }

        // 3. Fallback hardcodé si rien trouvé
        if (info.subnet == null) {
            info.subnet = "192.168.1";
            info.lastOctet = 1;
            Log.w(TAG, "Fallback subnet: " + info.subnet);
        }

        return info;
    }

    public static class SubnetInfo {
        public String subnet = null;
        public String deviceIPv4 = null;
        public int lastOctet = 1;
        public List<String> ipv6Addresses = new ArrayList<>();
    }

    // ── Scan parallèle ────────────────────────────────────────────────────────

    /**
     * Stratégie de découverte en deux étapes :
     * 1. Écoute multicast UDP 3s — si le serveur s'annonce, trouvé instantanément
     * 2. Fallback : scan parallèle de tout le subnet (~2s)
     */
    public static String findDewiComServer(Context context, int port) {
        // Étape 1 : multicast (quasi-instantané si serveur présent)
        Log.d(TAG, "Tentative découverte multicast...");
        String multicastResult = MulticastDiscovery.listen(context);
        if (multicastResult != null) {
            Log.d(TAG, "Serveur trouvé via multicast: " + multicastResult);
            return multicastResult;
        }

        // Étape 2 : fallback scan parallèle
        Log.d(TAG, "Multicast: rien trouvé, fallback scan parallèle...");
        SubnetInfo info = getSubnetInfo(context);
        Log.d(TAG, "Scan subnet " + info.subnet + ".x (" + PARALLEL_THREADS + " threads parallèles)");

        // Génère les IPs dans l'ordre de priorité
        List<String> candidates = buildPriorityList(info, port);

        ExecutorService pool = Executors.newFixedThreadPool(PARALLEL_THREADS);
        AtomicReference<String> found = new AtomicReference<>(null);

        try {
            // Soumet toutes les tâches
            List<Future<String>> futures = new ArrayList<>();
            for (String ip : candidates) {
                futures.add(pool.submit(() -> {
                    if (found.get() != null) return null; // déjà trouvé
                    return isDewiComServer(ip, port) ? ip : null;
                }));
            }

            // Attend le premier résultat positif
            for (Future<String> future : futures) {
                try {
                    String result = future.get(CONNECT_TIMEOUT_MS * 3L, TimeUnit.MILLISECONDS);
                    if (result != null) {
                        found.set(result);
                        Log.d(TAG, "DewiCom trouvé: " + result);
                        break;
                    }
                } catch (Exception e) {
                    // timeout ou erreur sur cette IP, on continue
                }
            }

            // Annule les tâches restantes
            for (Future<String> f : futures) f.cancel(true);

        } finally {
            pool.shutdownNow();
        }

        return found.get();
    }

    /**
     * Construit la liste d'IPs à tester dans l'ordre optimal :
     * 1. Adresses IPv6 connues
     * 2. IPs proches du téléphone (±10)
     * 3. IPs communes (.1, .2, .10, .100, .254)
     * 4. Reste du subnet
     */
    private static List<String> buildPriorityList(SubnetInfo info, int port) {
        List<String> priority = new ArrayList<>();
        List<String> rest = new ArrayList<>();
        boolean[] added = new boolean[255];

        // IPv6 en premier
        for (String ipv6 : info.ipv6Addresses) {
            priority.add(ipv6);
        }

        // IPs proches du téléphone (±10)
        for (int delta = -10; delta <= 10; delta++) {
            int i = info.lastOctet + delta;
            if (i >= 1 && i <= 254 && i != info.lastOctet) {
                priority.add(info.subnet + "." + i);
                added[i] = true;
            }
        }

        // IPs communes (routeurs, serveurs fixes)
        int[] common = {1, 2, 3, 10, 20, 50, 100, 150, 200, 254, 253};
        for (int i : common) {
            if (!added[i]) {
                priority.add(info.subnet + "." + i);
                added[i] = true;
            }
        }

        // Reste du subnet
        for (int i = 1; i <= 254; i++) {
            if (!added[i] && i != info.lastOctet) {
                rest.add(info.subnet + "." + i);
            }
        }

        priority.addAll(rest);
        Log.d(TAG, "Candidates: " + priority.size() + " IPs (priorité: " + Math.min(priority.size(), 20) + " premières)");
        return priority;
    }

    // ── Test d'un serveur individuel ─────────────────────────────────────────

    /**
     * Retourne "apk", "nodejs", ou "unknown" selon la réponse /api/dewicom-discovery.
     */
    public static String getServerMode(String host, int port) {
        try {
            String urlStr = host.contains(":")
                ? "http://[" + host + "]:" + port + "/api/dewicom-discovery"
                : "http://" + host + ":" + port + "/api/dewicom-discovery";
            HttpURLConnection conn = (HttpURLConnection) new URL(urlStr).openConnection();
            conn.setConnectTimeout(CONNECT_TIMEOUT_MS);
            conn.setReadTimeout(CONNECT_TIMEOUT_MS);
            if (conn.getResponseCode() == 200) {
                String body = new java.util.Scanner(conn.getInputStream()).useDelimiter("\\A").next();
                conn.disconnect();
                if (body.contains("\"mode\":\"apk\"")) return "apk";
                if (body.contains("DewiCom")) return "nodejs";
            }
            conn.disconnect();
        } catch (Exception ignored) {}
        return "unknown";
    }

    public static boolean isDewiComServer(String host, int port) {
        // Essaie HTTP d'abord (plus rapide, pas de handshake SSL)
        if (tryHttp(host, port)) return true;
        // Puis HTTPS avec cert auto-signé accepté
        return tryHttps(host, port);
    }

    private static boolean tryHttp(String host, int port) {
        try {
            String urlStr = host.contains(":")
                ? "http://[" + host + "]:" + port + "/api/dewicom-discovery"
                : "http://" + host + ":" + port + "/api/dewicom-discovery";
            HttpURLConnection conn = (HttpURLConnection) new URL(urlStr).openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(CONNECT_TIMEOUT_MS);
            conn.setReadTimeout(CONNECT_TIMEOUT_MS);
            conn.setInstanceFollowRedirects(false);
            int code = conn.getResponseCode();
            if (code == 200) {
                String body = new java.util.Scanner(conn.getInputStream()).useDelimiter("\\A").next();
                conn.disconnect();
                return body.contains("DewiCom");
            }
            conn.disconnect();
        } catch (Exception ignored) {}
        return false;
    }

    private static boolean tryHttps(String host, int port) {
        try {
            String urlStr = host.contains(":")
                ? "https://[" + host + "]:" + port + "/api/dewicom-discovery"
                : "https://" + host + ":" + port + "/api/dewicom-discovery";
            HttpsURLConnection conn = (HttpsURLConnection) new URL(urlStr).openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(CONNECT_TIMEOUT_MS);
            conn.setReadTimeout(CONNECT_TIMEOUT_MS);
            conn.setInstanceFollowRedirects(false);
            // Accepte tous les certificats
            SSLContext sc = SSLContext.getInstance("TLS");
            sc.init(null, new TrustManager[]{new X509TrustManager() {
                public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
                public void checkClientTrusted(X509Certificate[] c, String a) {}
                public void checkServerTrusted(X509Certificate[] c, String a) {}
            }}, new java.security.SecureRandom());
            conn.setSSLSocketFactory(sc.getSocketFactory());
            conn.setHostnameVerifier((h, s) -> true);
            int code = conn.getResponseCode();
            if (code == 200) {
                String body = new java.util.Scanner(conn.getInputStream()).useDelimiter("\\A").next();
                conn.disconnect();
                return body.contains("DewiCom");
            }
            conn.disconnect();
        } catch (Exception ignored) {}
        return false;
    }
}
