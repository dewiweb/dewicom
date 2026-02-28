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
 *   {"service":"DewiCom","ip":"192.168.x.y","port":3001,"protocol":"https"}
 *
 * Cette classe écoute pendant un délai maximal et retourne la première IP trouvée.
 */
public class MulticastDiscovery {
    private static final String TAG = "MulticastDiscovery";
    private static final String MCAST_ADDR = "224.0.0.251";
    private static final int MCAST_PORT = 9999;
    private static final int LISTEN_TIMEOUT_MS = 3000;

    /**
     * Écoute le réseau multicast pendant LISTEN_TIMEOUT_MS ms.
     * Retourne l'IP du premier serveur DewiCom trouvé, ou null si timeout.
     */
    public static String listen(Context context) {
        // Android exige un WifiManager.MulticastLock pour recevoir les paquets multicast
        WifiManager wifiManager = (WifiManager) context.getApplicationContext()
                .getSystemService(Context.WIFI_SERVICE);
        WifiManager.MulticastLock lock = null;

        try {
            lock = wifiManager.createMulticastLock("dewicom_discovery");
            lock.setReferenceCounted(true);
            lock.acquire();

            InetAddress group = InetAddress.getByName(MCAST_ADDR);
            MulticastSocket socket = new MulticastSocket(MCAST_PORT);
            socket.setSoTimeout(LISTEN_TIMEOUT_MS);
            socket.setReuseAddress(true);
            socket.joinGroup(group);

            Log.d(TAG, "Écoute multicast " + MCAST_ADDR + ":" + MCAST_PORT + " pendant " + LISTEN_TIMEOUT_MS + "ms...");

            byte[] buf = new byte[512];
            DatagramPacket packet = new DatagramPacket(buf, buf.length);

            long deadline = System.currentTimeMillis() + LISTEN_TIMEOUT_MS;
            while (System.currentTimeMillis() < deadline) {
                try {
                    socket.receive(packet);
                    String json = new String(packet.getData(), 0, packet.getLength(), "UTF-8");
                    Log.d(TAG, "Paquet reçu: " + json);

                    if (json.contains("\"DewiCom\"")) {
                        String ip = extractJson(json, "ip");
                        String portStr = extractJsonNumber(json, "port");
                        if (ip != null) {
                            Log.d(TAG, "Serveur DewiCom trouvé via multicast: " + ip + ":" + portStr);
                            socket.leaveGroup(group);
                            socket.close();
                            return ip;
                        }
                    }
                } catch (java.net.SocketTimeoutException e) {
                    break; // timeout atteint
                }
            }

            socket.leaveGroup(group);
            socket.close();
            Log.d(TAG, "Aucun serveur trouvé via multicast");

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
