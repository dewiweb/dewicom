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
import android.content.pm.PackageManager;
import android.util.Log;
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
    private ExecutorService executor = Executors.newCachedThreadPool();
    private LocalWebServer localWebServer;
    private String foundServerIP = null;
    private String localServerAddress = null;
    private volatile String pendingRemoteIP = null;
    private volatile boolean scanComplete = false;
    private volatile String foundServerMode = "local";
    private LeaderElection leaderElection;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        // Initialise le serveur local
        localWebServer = new LocalWebServer(this);

        // Demande les permissions au démarrage
        requestMicrophonePermission();

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
        
        // Démarre l'élection de leader
        startLeaderElection();
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
            runOnUiThread(() -> {
                if (leaderElection != null) leaderElection.stop();
                leaderElection = null;
                pendingRemoteIP = null;
                scanComplete = false;
                startLeaderElection();
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

        // Démarre d'abord le serveur local et la page (secure context)
        executor.execute(() -> {
            try {
                if (localWebServer == null) localWebServer = new LocalWebServer(this);
                localWebServer.start();
                foundServerIP = "127.0.0.1";
                Log.d("MainActivity", "Serveur local prêt sur 127.0.0.1:3001");
            } catch (IOException e) {
                Log.e("MainActivity", "Erreur serveur local: " + e.getMessage());
            }
            runOnUiThread(() -> webView.loadUrl("http://127.0.0.1:3001"));
        });

        leaderElection = new LeaderElection(this, localServerAddress, new LeaderElection.Listener() {
            @Override
            public void onBecomeLeader(String myIP) {
                // Ce nœud est leader : son serveur local est déjà actif
                foundServerIP = "127.0.0.1";
                foundServerMode = "local";
                scanComplete = true;
                pendingRemoteIP = null;
                Log.d("MainActivity", "LEADER élu: " + myIP);
                runOnUiThread(() -> {
                    Toast.makeText(MainActivity.this,
                        "👑 Leader — serveur actif sur " + myIP + ":3001",
                        Toast.LENGTH_LONG).show();
                    webView.evaluateJavascript(
                        "window.dewicomServerIP='127.0.0.1';" +
                        "window.dewicomServerMode='local';" +
                        "window.dewicomScanComplete=true;" +
                        "if(typeof reconnectSocket==='function') reconnectSocket('127.0.0.1');", null);
                });
            }

            @Override
            public void onLeaderElected(String leaderIP) {
                // Un autre nœud est leader : on se connecte à lui
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
                        "if(typeof reconnectSocket==='function') reconnectSocket('" + leaderIP + "');",
                        null);
                });
            }
        });
        leaderElection.start();
    }

    private void requestMicrophonePermission() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) 
                != PackageManager.PERMISSION_GRANTED) {
            
            ActivityCompat.requestPermissions(this, 
                new String[]{Manifest.permission.RECORD_AUDIO}, 
                PERMISSION_REQUEST_CODE);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        
        if (requestCode == PERMISSION_REQUEST_CODE) {
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                Toast.makeText(this, "Microphone autorisé !", Toast.LENGTH_SHORT).show();
            } else {
                Toast.makeText(this, "Microphone refusé - l\'app ne fonctionnera pas correctement", Toast.LENGTH_LONG).show();
            }
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

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (leaderElection != null) leaderElection.stop();
        if (executor != null && !executor.isShutdown()) executor.shutdown();
        if (localWebServer != null && localWebServer.isAlive()) localWebServer.stop();
    }
}
