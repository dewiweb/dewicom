package com.dewicom;

import android.content.Context;
import android.net.wifi.WifiManager;
import android.util.Log;

import java.net.DatagramPacket;
import java.net.InetAddress;
import java.net.MulticastSocket;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * Écoute les annonces multicast UDP envoyées par les serveurs DewiCom.
 * Le serveur envoie toutes les 2s sur 224.0.0.251:9999 un JSON :
 *   {"service":"DewiCom","ip":"192.168.x.y","port":3001,"protocol":"http","mode":"docker|dedicated|desktop-local|apk"}
 *
 * Hiérarchie de priorité des modes :
 *   docker (3) > dedicated (2) > desktop-local (1) > apk (0, ignoré)
 * Un serveur docker/dedicated déclenche une résolution immédiate sans attendre le timeout.
 */
public class MulticastDiscovery {
    private static final String TAG = "MulticastDiscovery";
    private static final String MCAST_ADDR = "224.0.0.251";
    private static final int MCAST_PORT = 9999;
    private static final int LISTEN_TIMEOUT_MS = 1500;  // 1.5s suffit si annonces toutes les 1s

    private static int modePriority(String mode) {
        if (mode == null) return 1;
        switch (mode) {
            case "docker":       return 3;
            case "dedicated":    return 2;
            case "desktop-local":return 1;
            default:             return 0; // apk et inconnu ignorés
        }
    }

    /**
     * Écoute le réseau multicast pendant LISTEN_TIMEOUT_MS ms.
     * Retourne l'IP du serveur DewiCom de plus haute priorité trouvé, ou null si timeout.
     */
    public static String listen(Context context) {
        WifiManager wifiManager = (WifiManager) context.getApplicationContext()
                .getSystemService(Context.WIFI_SERVICE);
        WifiManager.MulticastLock lock = null;

        try {
            lock = wifiManager.createMulticastLock("dewicom_discovery");
            lock.setReferenceCounted(true);
            lock.acquire();

            InetAddress group = InetAddress.getByName(MCAST_ADDR);
            MulticastSocket socket = new MulticastSocket(MCAST_PORT);
            socket.setSoTimeout(500); // timeout court par itération
            socket.setReuseAddress(true);
            socket.joinGroup(group);

            Log.d(TAG, "Écoute multicast " + MCAST_ADDR + ":" + MCAST_PORT + " pendant " + LISTEN_TIMEOUT_MS + "ms...");

            byte[] buf = new byte[512];
            DatagramPacket packet = new DatagramPacket(buf, buf.length);

            String bestIp = null;
            int bestPriority = 0;
            long deadline = System.currentTimeMillis() + LISTEN_TIMEOUT_MS;

            while (System.currentTimeMillis() < deadline) {
                try {
                    packet.setLength(buf.length);
                    socket.receive(packet);
                    String json = new String(packet.getData(), 0, packet.getLength(), "UTF-8");
                    Log.d(TAG, "Paquet reçu: " + json);

                    if (!json.contains("\"DewiCom\"")) continue;

                    String mode = extractJson(json, "mode");
                    int priority = modePriority(mode);
                    if (priority == 0) continue; // ignore les APK

                    if (priority > bestPriority) {
                        String ip = extractJson(json, "ip");
                        if (ip != null) {
                            bestIp = ip;
                            bestPriority = priority;
                            Log.d(TAG, "Serveur trouvé: " + ip + " (mode=" + mode + ", priorité=" + priority + ")");
                        }
                    }

                    // Serveur dédié/docker : résolution immédiate
                    if (bestPriority >= 2) break;

                } catch (java.net.SocketTimeoutException e) {
                    // continue jusqu'à deadline globale
                }
            }

            socket.leaveGroup(group);
            socket.close();

            if (bestIp != null) {
                Log.d(TAG, "Serveur retenu: " + bestIp + " (priorité=" + bestPriority + ")");
            } else {
                Log.d(TAG, "Aucun serveur trouvé via multicast");
            }
            return bestIp;

        } catch (Exception e) {
            Log.w(TAG, "Écoute multicast impossible: " + e.getMessage());
        } finally {
            if (lock != null && lock.isHeld()) lock.release();
        }

        return null;
    }

    private static String extractJson(String json, String key) {
        String search = "\"" + key + "\":\"";
        int i = json.indexOf(search);
        if (i < 0) return null;
        i += search.length();
        int e = json.indexOf("\"", i);
        return e < 0 ? null : json.substring(i, e);
    }

    private static String extractJsonNumber(String json, String key) {
        String search = "\"" + key + "\":";
        int i = json.indexOf(search);
        if (i < 0) return null;
        i += search.length();
        int e = i;
        while (e < json.length() && Character.isDigit(json.charAt(e))) e++;
        return json.substring(i, e);
    }
}
