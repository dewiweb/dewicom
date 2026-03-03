package com.dewicom;

import android.app.Activity;
import android.os.Bundle;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebSettings;
import android.webkit.WebChromeClient;
import android.webkit.SslErrorHandler;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceError;
import android.webkit.WebResourceResponse;
import android.net.http.SslCertificate;
import android.net.http.SslError;
import android.webkit.JavascriptInterface;
import android.Manifest;
import android.app.AlertDialog;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.util.Log;
import android.view.View;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.io.IOException;

public class MainActivity extends Activity {
    private WebView webView;
    private static final int PERMISSION_REQUEST_CODE = 1;
    private static final int PERMISSION_LOCATION_CODE = 2;
    private ExecutorService executor = Executors.newCachedThreadPool();
    private LocalWebServer localWebServer;
    private String foundServerIP = null;
    private String localServerAddress = null;
    private volatile String pendingRemoteIP = null;
    private volatile boolean scanComplete = false;
    private volatile String foundServerMode = "local";
    private LeaderElection leaderElection;
    private BroadcastReceiver networkReceiver = null;
    private String chosenSsid = null;           // SSID WiFi choisi par l'utilisateur
    private volatile boolean onChosenWifi = false; // vrai si le WiFi actuel = chosenSsid
    private View waitingView = null;            // vue d'attente affichée quand WiFi wrong
    private static final String PREFS_NAME = "dewicom_prefs";
    private static final String PREF_SSID  = "chosen_ssid";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        // Initialise le serveur local
        localWebServer = new LocalWebServer(this);

        webView = findViewById(R.id.webview);
        
        // Configure SSL
        SSLConfigurator.configureWebView(webView, this);
        
        // Expose la config Java au JS AVANT le chargement de la page
        webView.addJavascriptInterface(new DewiComConfig(), "DewiComAndroid");

        // Configure le WebViewClient pour gérer les erreurs SSL
        webView.setWebViewClient(new android.webkit.WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
                // Injecte window.dewicomServerIP au tout début, avant que le JS principal s'exécute
                if (foundServerIP != null) {
                    view.evaluateJavascript("window.dewicomServerIP='" + foundServerIP + "';", null);
                }
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                // Injecte l'IP distante si le scan est déjà terminé
                if (pendingRemoteIP != null) {
                    view.evaluateJavascript(
                        "window.dewicomServerIP='" + pendingRemoteIP + "';" +
                        "window.dewicomServerMode='" + foundServerMode + "';" +
                        "window.dewicomScanComplete=true;", null);
                } else if (scanComplete) {
                    view.evaluateJavascript("window.dewicomScanComplete=true;", null);
                }
                // Affiche l'adresse du serveur local si disponible
                if (localServerAddress != null) {
                    showLocalServerInfo();
                }
            }
            
            @Override
            public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                // Accepte tous les certificats SSL (auto-signés)
                Toast.makeText(MainActivity.this, "Accepte certificat SSL", Toast.LENGTH_SHORT).show();
                handler.proceed();
            }
            
            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                Toast.makeText(MainActivity.this, "Erreur chargement: " + error.getDescription(), Toast.LENGTH_LONG).show();
            }
        });
        
        WebSettings webSettings = webView.getSettings();
        webSettings.setJavaScriptEnabled(true);
        webSettings.setDomStorageEnabled(true);
        webSettings.setMediaPlaybackRequiresUserGesture(false);
        webSettings.setAllowFileAccessFromFileURLs(true);
        webSettings.setAllowUniversalAccessFromFileURLs(true);
        webSettings.setAllowContentAccess(true);
        webSettings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        // Force getUserMedia à fonctionner sur origines HTTP (serveur LAN)
        // en traitant toutes les origines comme sécurisées dans la WebView
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            webSettings.setSafeBrowsingEnabled(false);
        }
        
        // Configure le WebChromeClient pour les permissions
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(android.webkit.PermissionRequest request) {
                // Accorde automatiquement les permissions pour le microphone
                if (request.getResources().length > 0) {
                    for (String resource : request.getResources()) {
                        if (resource.equals(android.webkit.PermissionRequest.RESOURCE_AUDIO_CAPTURE)) {
                            request.grant(new String[]{android.webkit.PermissionRequest.RESOURCE_AUDIO_CAPTURE});
                            return;
                        }
                    }
                }
                request.deny();
            }
        });
        
        // Demande les permissions (micro + localisation pour SSID) puis sélection WiFi
        requestPermissionsAndInit();
    }

    // Interface Java exposée au JavaScript
    public class DewiComConfig {
        @JavascriptInterface
        public String getServerIP() { return foundServerIP != null ? foundServerIP : ""; }
        @JavascriptInterface
        public String getLocalAddress() { return localServerAddress != null ? localServerAddress : ""; }
        @JavascriptInterface
        public boolean isLocalMode() { return "127.0.0.1".equals(foundServerIP); }
        @JavascriptInterface
        public String getServerMode() { return foundServerMode; }
        @JavascriptInterface
        public void requestRediscovery() {
            // Relance l'élection complète depuis le JS (bouton Reconnecter)
            executor.execute(() -> {
                if (leaderElection != null) { leaderElection.stop(); leaderElection = null; }
                if (localWebServer != null) { localWebServer.stop(); localWebServer = null; }
                pendingRemoteIP = null;
                scanComplete = false;
                runOnUiThread(() -> startLeaderElection());
            });
        }
    }


    private void showLocalServerInfo() {
        // Affiche l'adresse du serveur local dans un Toast long
        String message = "🚀 Serveur local démarré !\n" +
                        "📱 Autres appareils: https://" + localServerAddress + ":3001\n" +
                        "🔐 Accepte le certificat auto-signé";
        
        Toast.makeText(this, message, Toast.LENGTH_LONG).show();
        
        // Injecte aussi l'info dans la page pour l'afficher dans l'interface
        String javascript = "if (typeof window.showLocalServerInfo === 'function') {" +
                           "  window.showLocalServerInfo('" + localServerAddress + "');" +
                           "}";
        webView.evaluateJavascript(javascript, null);
    }

    private String getLocalIPAddress() {
        try {
            // Essaie de trouver l'adresse WiFi locale
            for (NetworkInterface intf : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (intf.isUp() && !intf.isLoopback() && intf.getName().startsWith("wlan")) {
                    for (InetAddress addr : Collections.list(intf.getInetAddresses())) {
                        if (!addr.isLoopbackAddress() && addr.getHostAddress().indexOf(':') < 0) {
                            return addr.getHostAddress();
                        }
                    }
                }
            }
            
            // Fallback: première interface non-loopback
            for (NetworkInterface intf : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (intf.isUp() && !intf.isLoopback()) {
                    for (InetAddress addr : Collections.list(intf.getInetAddresses())) {
                        if (!addr.isLoopbackAddress() && addr.getHostAddress().indexOf(':') < 0) {
                            return addr.getHostAddress();
                        }
                    }
                }
            }
        } catch (Exception e) {
            // Erreur
        }
        
        return "127.0.0.1"; // Dernier fallback
    }

    /**
     * Démarre l'élection de leader.
     * Le leader héberge le serveur (LocalWebServer).
     * Les followers se connectent au leader.
     * Si le leader tombe, une nouvelle élection est lancée automatiquement.
     */
    private void startLeaderElection() {
        localServerAddress = getLocalIPAddress();

        // Pré-écoute multicast : si un serveur dedicated/docker est présent, connexion directe
        executor.execute(() -> {
            String dedicatedIP = MulticastDiscovery.listenForDedicated(MainActivity.this);
            if (dedicatedIP != null) {
                Log.d("MainActivity", "Serveur dédié détecté via multicast: " + dedicatedIP + " — bypass élection");
                String mode = NetworkDiscovery.getServerMode(dedicatedIP, 3001);
                if ("unknown".equals(mode)) mode = "dedicated";
                foundServerIP = dedicatedIP;
                foundServerMode = mode;
                pendingRemoteIP = dedicatedIP;
                scanComplete = true;
                final String serverIP = dedicatedIP;
                final String serverMode = mode;
                runOnUiThread(() -> {
                    webView.evaluateJavascript(
                        "window.dewicomServerIP='" + serverIP + "';" +
                        "window.dewicomServerMode='" + serverMode + "';" +
                        "window.dewicomScanComplete=true;" +
                        "if(typeof reconnectSocket==='function') reconnectSocket('" + serverIP + "','" + serverMode + "');",
                        null);
                    webView.loadUrl("http://" + serverIP + ":3001");
                });
                // Pas d'élection Bully — on surveille juste que le serveur reste là
                startDedicatedServerWatchdog(dedicatedIP);
                return;
            }

            // Aucun serveur dédié → démarrage normal avec serveur local + élection Bully
            try {
                if (localWebServer == null) localWebServer = new LocalWebServer(MainActivity.this);
                localWebServer.start();
                foundServerIP = "127.0.0.1";
                Log.d("MainActivity", "Serveur local prêt sur 127.0.0.1:3001");
            } catch (IOException e) {
                Log.e("MainActivity", "Erreur serveur local: " + e.getMessage());
            }
            runOnUiThread(() -> webView.loadUrl("http://127.0.0.1:3001"));
            runOnUiThread(() -> startBullyElection());
        });
    }

    private ScheduledExecutorService watchdogScheduler = null;

    private void startDedicatedServerWatchdog(String serverIP) {
        if (watchdogScheduler != null) watchdogScheduler.shutdownNow();
        watchdogScheduler = Executors.newSingleThreadScheduledExecutor();
        watchdogScheduler.scheduleWithFixedDelay(() -> {
            boolean alive = NetworkDiscovery.isDewiComServer(serverIP, 3001);
            if (!alive) {
                Log.w("MainActivity", "Serveur dédié " + serverIP + " perdu — re-découverte multicast");
                watchdogScheduler.shutdownNow();
                watchdogScheduler = null;
                // Tente d'abord une re-écoute multicast : un autre serveur dédié a peut-être pris le relais
                executor.execute(() -> {
                    String newIP = MulticastDiscovery.listenForDedicated(MainActivity.this);
                    if (newIP != null && !newIP.equals(serverIP)) {
                        Log.d("MainActivity", "Nouveau serveur dédié: " + newIP + " — basculement");
                        String mode = NetworkDiscovery.getServerMode(newIP, 3001);
                        if ("unknown".equals(mode)) mode = "dedicated";
                        foundServerIP = newIP;
                        foundServerMode = mode;
                        pendingRemoteIP = newIP;
                        final String ip = newIP; final String m = mode;
                        runOnUiThread(() -> {
                            webView.evaluateJavascript(
                                "window.dewicomServerIP='" + ip + "';" +
                                "window.dewicomServerMode='" + m + "';" +
                                "if(typeof reconnectSocket==='function') reconnectSocket('" + ip + "','" + m + "');", null);
                            webView.loadUrl("http://" + ip + ":3001");
                        });
                        startDedicatedServerWatchdog(ip);
                    } else {
                        // Aucun serveur dédié → retour en mode Bully
                        Log.w("MainActivity", "Aucun serveur dédié — retour élection Bully");
                        runOnUiThread(() -> {
                            pendingRemoteIP = null;
                            scanComplete = false;
                            // Démarrage serveur local puis élection
                            executor.execute(() -> {
                                try {
                                    if (localWebServer == null) localWebServer = new LocalWebServer(MainActivity.this);
                                    localWebServer.start();
                                    foundServerIP = "127.0.0.1";
                                } catch (IOException e) { Log.e("MainActivity", "Erreur serveur local: " + e.getMessage()); }
                                runOnUiThread(() -> {
                                    webView.loadUrl("http://127.0.0.1:3001");
                                    startBullyElection();
                                });
                            });
                        });
                    }
                });
            }
        }, 2000, 2000, TimeUnit.MILLISECONDS);
    }

    private void startBullyElection() {
        leaderElection = new LeaderElection(this, localServerAddress, new LeaderElection.Listener() {
            @Override
            public void onBecomeLeader(String myIP) {
                // Ce nœud est leader : redémarre le serveur local si nécessaire
                if (localWebServer == null) {
                    localWebServer = new LocalWebServer(MainActivity.this);
                    try { localWebServer.start(); Log.d("MainActivity", "LocalWebServer redémarré (leader)"); }
                    catch (java.io.IOException e) { Log.e("MainActivity", "Erreur redémarrage serveur: " + e.getMessage()); }
                }
                final boolean wasFollower = pendingRemoteIP != null;
                foundServerIP = "127.0.0.1";
                foundServerMode = "local";
                scanComplete = true;
                pendingRemoteIP = null;
                Log.d("MainActivity", "LEADER élu: " + myIP + " (wasFollower=" + wasFollower + ")");
                runOnUiThread(() -> {
                    Toast.makeText(MainActivity.this,
                        "👑 Leader — serveur actif sur " + myIP + ":3001",
                        Toast.LENGTH_LONG).show();
                    if (wasFollower) {
                        // Était follower : la WebView pointe encore sur l'ancien leader
                        // On recharge sur le serveur local pour rétablir le contexte WS natif
                        webView.loadUrl("http://127.0.0.1:3001");
                    } else {
                        webView.evaluateJavascript(
                            "window.dewicomServerIP='127.0.0.1';" +
                            "window.dewicomServerMode='local';" +
                            "window.dewicomScanComplete=true;" +
                            "if(typeof reconnectSocket==='function') reconnectSocket('127.0.0.1','local');", null);
                    }
                });
            }

            @Override
            public void onLeaderElected(String leaderIP) {
                // Un autre nœud est leader : arrête le serveur local pour éviter les audio zombies
                if (localWebServer != null) {
                    localWebServer.stop();
                    localWebServer = null;
                    Log.d("MainActivity", "LocalWebServer arrêté (follower)");
                }
                String detectedMode = NetworkDiscovery.getServerMode(leaderIP, 3001);
                final String mode = "unknown".equals(detectedMode) ? "nodejs" : detectedMode;
                foundServerIP = leaderIP;
                foundServerMode = mode;
                pendingRemoteIP = leaderIP;
                scanComplete = true;
                Log.d("MainActivity", "FOLLOWER — leader: " + leaderIP + " (mode: " + mode + ")");
                runOnUiThread(() -> {
                    Toast.makeText(MainActivity.this,
                        "📡 Leader: " + leaderIP, Toast.LENGTH_LONG).show();
                    webView.evaluateJavascript(
                        "window.dewicomServerIP='" + leaderIP + "';" +
                        "window.dewicomServerMode='" + mode + "';" +
                        "window.dewicomScanComplete=true;" +
                        "if(typeof reconnectSocket==='function') reconnectSocket('" + leaderIP + "','" + mode + "');",
                        null);
                });
            }
        });
        leaderElection.start();
        // Listener permanent : si un docker/dedicated arrive en cours de session Bully, on bascule
        startSuperiorServerListener();
    }

    // ── Sélection WiFi dédié ─────────────────────────────────────────────────────

    private String getCurrentSsid() {
        // Android 10+ : WifiInfo.getSSID() retourne <unknown ssid> sans permission systeme
        // On tente quand meme via WifiManager (fonctionne si location accordee + scanning actif)
        WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        if (wm != null && wm.isWifiEnabled()) {
            WifiInfo info = wm.getConnectionInfo();
            if (info != null) {
                String ssid = info.getSSID();
                if (ssid != null && !ssid.equals("<unknown ssid>") && !ssid.isEmpty()) {
                    return ssid.startsWith("\"") ? ssid.substring(1, ssid.length() - 1) : ssid;
                }
            }
        }
        return null;
    }

    private java.util.List<String> getKnownSsids() {
        // Reseaux WiFi enregistres sur l'appareil (ne necessite pas de permission sur API < 29)
        java.util.List<String> ssids = new java.util.ArrayList<>();
        String current = getCurrentSsid();
        if (current != null) ssids.add(current);
        WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        if (wm != null) {
            try {
                java.util.List<android.net.wifi.WifiConfiguration> configs = wm.getConfiguredNetworks();
                if (configs != null) {
                    for (android.net.wifi.WifiConfiguration c : configs) {
                        if (c.SSID == null) continue;
                        String s = c.SSID.startsWith("\"") ? c.SSID.substring(1, c.SSID.length() - 1) : c.SSID;
                        if (!s.isEmpty() && !ssids.contains(s)) ssids.add(s);
                    }
                }
            } catch (Exception ignored) {}
        }
        return ssids;
    }

    private void initWifiSelection() {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String saved = prefs.getString(PREF_SSID, null);
        String current = getCurrentSsid();

        if (saved != null) {
            // SSID déjà choisi : vérifie si on est dessus
            chosenSsid = saved;
            Log.d("MainActivity", "[wifi] SSID enregistré: " + chosenSsid + ", actuel: " + current);
            if (chosenSsid.equals(current)) {
                onChosenWifi = true;
                startLeaderElection();
            } else {
                onChosenWifi = false;
                showWaitingForWifi();
            }
            registerWifiReceiver();
        } else {
            // Première fois : dialogue de sélection
            showWifiSelectionDialog(current);
        }
    }

    private void showWifiSelectionDialog(String currentSsid) {
        java.util.List<String> known = getKnownSsids();

        // Conteneur du dialogue
        LinearLayout container = new LinearLayout(this);
        container.setOrientation(LinearLayout.VERTICAL);
        int pad = (int)(16 * getResources().getDisplayMetrics().density);
        container.setPadding(pad * 2, pad, pad * 2, 0);

        // Champ de saisie manuelle
        android.widget.EditText input = new android.widget.EditText(this);
        input.setHint("Nom du réseau WiFi (SSID)");
        input.setSingleLine(true);
        input.setInputType(android.text.InputType.TYPE_CLASS_TEXT);
        if (currentSsid != null) input.setText(currentSsid);
        else if (!known.isEmpty()) input.setText(known.get(0));
        container.addView(input);

        // Liste des réseaux connus (suggestions)
        if (!known.isEmpty()) {
            TextView hint = new TextView(this);
            hint.setText("Réseaux enregistrés :");
            hint.setTextSize(12);
            hint.setTextColor(0xFF888888);
            hint.setPadding(0, pad, 0, 4);
            container.addView(hint);

            for (String s : known) {
                Button btn = new Button(this);
                btn.setText(s);
                btn.setTextSize(13);
                btn.setAllCaps(false);
                btn.setPadding(0, 4, 0, 4);
                btn.setBackgroundColor(android.graphics.Color.TRANSPARENT);
                btn.setTextColor(0xFF4FC3F7);
                btn.setOnClickListener(v -> input.setText(s));
                container.addView(btn);
            }
        }

        new AlertDialog.Builder(this)
            .setTitle("Réseau WiFi DewiCom")
            .setMessage("L'app se connecte uniquement sur ce réseau.\nElle se met en pause si vous changez de WiFi.")
            .setView(container)
            .setPositiveButton("Confirmer", (dialog, w) -> {
                String chosen = input.getText().toString().trim();
                if (chosen.isEmpty()) {
                    // Vide = sans contrainte
                    chosenSsid = null;
                    onChosenWifi = true;
                    startLeaderElection();
                } else {
                    chosenSsid = chosen;
                    getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                        .edit().putString(PREF_SSID, chosenSsid).apply();
                    Log.d("MainActivity", "[wifi] SSID choisi: " + chosenSsid);
                    String current = getCurrentSsid();
                    // Si on ne peut pas lire le SSID actuel, on suppose qu'on y est
                    boolean onIt = current == null || chosenSsid.equals(current);
                    if (onIt) {
                        onChosenWifi = true;
                        startLeaderElection();
                    } else {
                        onChosenWifi = false;
                        showWaitingForWifi();
                    }
                    registerWifiReceiver();
                }
            })
            .setNegativeButton("Sans contrainte WiFi", (dialog, w) -> {
                chosenSsid = null;
                onChosenWifi = true;
                startLeaderElection();
            })
            .setCancelable(false)
            .show();
    }

    private void showWaitingForWifi() {
        webView.setVisibility(View.GONE);
        if (waitingView != null) return;
        LinearLayout ll = new LinearLayout(this);
        ll.setOrientation(LinearLayout.VERTICAL);
        ll.setGravity(android.view.Gravity.CENTER);
        ll.setBackgroundColor(0xFF1a1a2e);
        ll.setLayoutParams(new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.MATCH_PARENT));

        TextView tv = new TextView(this);
        tv.setText("En attente du WiFi\n\u00ab " + (chosenSsid != null ? chosenSsid : "?") + " \u00bb");
        tv.setTextColor(0xFFFFFFFF);
        tv.setTextSize(18);
        tv.setGravity(android.view.Gravity.CENTER);
        tv.setPadding(32, 0, 32, 32);
        ll.addView(tv);

        Button btn = new Button(this);
        btn.setText("Changer de réseau");
        btn.setOnClickListener(v -> {
            getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit().remove(PREF_SSID).apply();
            chosenSsid = null;
            hideWaitingView();
            showWifiSelectionDialog(getCurrentSsid());
        });
        ll.addView(btn);

        waitingView = ll;
        ((android.view.ViewGroup) webView.getParent()).addView(ll);
        Log.d("MainActivity", "[wifi] Affichage écran attente WiFi: " + chosenSsid);
    }

    private void hideWaitingView() {
        if (waitingView != null) {
            ((android.view.ViewGroup) waitingView.getParent()).removeView(waitingView);
            waitingView = null;
        }
        webView.setVisibility(View.VISIBLE);
    }

    private void registerWifiReceiver() {
        if (networkReceiver != null) return;
        networkReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                String action = intent.getAction();
                if (!WifiManager.NETWORK_STATE_CHANGED_ACTION.equals(action) &&
                    !WifiManager.WIFI_STATE_CHANGED_ACTION.equals(action)) return;

                String currentSsid = getCurrentSsid();
                boolean isOnChosen = chosenSsid == null || chosenSsid.equals(currentSsid);

                if (isOnChosen && !onChosenWifi) {
                    // Retour sur le WiFi choisi
                    Log.d("MainActivity", "[wifi] Retour sur WiFi choisi: " + currentSsid + " — re-découverte");
                    onChosenWifi = true;
                    runOnUiThread(() -> hideWaitingView());
                    stopSession(); // arrête session sans désenregistrer le wifi receiver
                    executor = Executors.newCachedThreadPool();
                    executor.execute(() -> {
                        try { Thread.sleep(2500); } catch (InterruptedException ignored) {}
                        runOnUiThread(() -> startLeaderElection());
                    });
                } else if (!isOnChosen && onChosenWifi) {
                    // Bascule sur un autre WiFi
                    Log.d("MainActivity", "[wifi] Changement WiFi: " + currentSsid + " ≠ " + chosenSsid + " — pause");
                    onChosenWifi = false;
                    stopSession();
                    executor = Executors.newCachedThreadPool();
                    runOnUiThread(() -> showWaitingForWifi());
                }
            }
        };
        IntentFilter filter = new IntentFilter();
        filter.addAction(WifiManager.NETWORK_STATE_CHANGED_ACTION);
        filter.addAction(WifiManager.WIFI_STATE_CHANGED_ACTION);
        registerReceiver(networkReceiver, filter);
        Log.d("MainActivity", "[wifi] BroadcastReceiver WiFi enregistré (SSID suivi: " + chosenSsid + ")");
    }

    private Thread superiorServerThread = null;
    private volatile boolean superiorListenerRunning = false;

    private void startSuperiorServerListener() {
        stopSuperiorServerListener();
        superiorListenerRunning = true;
        superiorServerThread = new Thread(() -> {
            android.net.wifi.WifiManager wm = (android.net.wifi.WifiManager)
                getApplicationContext().getSystemService(android.content.Context.WIFI_SERVICE);
            android.net.wifi.WifiManager.MulticastLock lock = null;
            try {
                lock = wm.createMulticastLock("dewicom_superior");
                lock.setReferenceCounted(true);
                lock.acquire();
                java.net.InetAddress group = java.net.InetAddress.getByName(MulticastDiscovery.MCAST_ADDR_PUBLIC);
                java.net.MulticastSocket socket = new java.net.MulticastSocket(MulticastDiscovery.MCAST_PORT_PUBLIC);
                socket.setReuseAddress(true);
                socket.setSoTimeout(500);
                socket.joinGroup(group);
                byte[] buf = new byte[512];
                while (superiorListenerRunning) {
                    try {
                        java.net.DatagramPacket pkt = new java.net.DatagramPacket(buf, buf.length);
                        socket.receive(pkt);
                        String json = new String(pkt.getData(), 0, pkt.getLength(), "UTF-8");
                        if (!json.contains("\"DewiCom\"")) continue;
                        String mode = MulticastDiscovery.extractJsonPublic(json, "mode");
                        if (MulticastDiscovery.modePriorityPublic(mode) < 2) continue;
                        String ip = MulticastDiscovery.extractJsonPublic(json, "ip");
                        if (ip == null || ip.equals(foundServerIP)) continue;
                        Log.d("MainActivity", "[superior-listener] Serveur supérieur détecté: " + ip + " (mode=" + mode + ")");
                        superiorListenerRunning = false;
                        final String serverIP = ip;
                        final String serverMode = mode;
                        // Bascule vers ce serveur
                        if (leaderElection != null) { leaderElection.stop(); leaderElection = null; }
                        if (localWebServer != null) { localWebServer.stop(); localWebServer = null; }
                        foundServerIP = serverIP;
                        foundServerMode = serverMode;
                        pendingRemoteIP = serverIP;
                        scanComplete = true;
                        runOnUiThread(() -> {
                            webView.evaluateJavascript(
                                "window.dewicomServerIP='" + serverIP + "';" +
                                "window.dewicomServerMode='" + serverMode + "';" +
                                "if(typeof reconnectSocket==='function') reconnectSocket('" + serverIP + "','" + serverMode + "');",
                                null);
                            webView.loadUrl("http://" + serverIP + ":3001");
                        });
                        startDedicatedServerWatchdog(serverIP);
                    } catch (java.net.SocketTimeoutException ignored) {}
                }
                socket.leaveGroup(group);
                socket.close();
            } catch (Exception e) {
                Log.w("MainActivity", "superior-listener: " + e.getMessage());
            } finally {
                if (lock != null && lock.isHeld()) lock.release();
            }
        }, "dewicom-superior-listener");
        superiorServerThread.setDaemon(true);
        superiorServerThread.start();
    }

    private void stopSuperiorServerListener() {
        superiorListenerRunning = false;
        if (superiorServerThread != null) { superiorServerThread.interrupt(); superiorServerThread = null; }
    }

    private void requestPermissionsAndInit() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this,
                new String[]{Manifest.permission.RECORD_AUDIO},
                PERMISSION_REQUEST_CODE);
        } else {
            initWifiSelection();
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == PERMISSION_REQUEST_CODE) {
            for (int i = 0; i < permissions.length; i++) {
                if (Manifest.permission.RECORD_AUDIO.equals(permissions[i])
                        && (grantResults.length <= i || grantResults[i] != PackageManager.PERMISSION_GRANTED)) {
                    Toast.makeText(this, "Microphone refusé - l'app ne fonctionnera pas correctement", Toast.LENGTH_LONG).show();
                }
            }
            // Lance l'init WiFi dans tous les cas (même si localisation refusée)
            initWifiSelection();
        }
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    // Arrête la session (serveur, élection, watchdog) sans toucher au wifi receiver
    private void stopSession() {
        if (leaderElection != null) { leaderElection.stop(); leaderElection = null; }
        if (localWebServer != null) { localWebServer.stop(); localWebServer = null; }
        if (watchdogScheduler != null) { watchdogScheduler.shutdownNow(); watchdogScheduler = null; }
        stopSuperiorServerListener();
        if (executor != null && !executor.isShutdown()) executor.shutdownNow();
        foundServerIP = null; pendingRemoteIP = null; scanComplete = false;
    }

    // Arrêt complet (onDestroy) — désenregistre aussi le wifi receiver
    private void stopAll() {
        stopSession();
        if (networkReceiver != null) { try { unregisterReceiver(networkReceiver); } catch (Exception ignored) {} networkReceiver = null; }
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        stopAll();
    }

}
