package com.dewicom;

import android.net.http.SslError;
import android.webkit.SslErrorHandler;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceError;
import android.util.Log;

public class SSLWebViewClient extends WebViewClient {

    private static final String TAG = "SSLWebViewClient";

    /**
     * Accepte les certificats auto-signés des serveurs DewiCom.
     * Le serveur génère un cert self-signed au démarrage (selfsigned npm package).
     * getUserMedia requiert HTTPS (secure context) → l'acceptation est obligatoire.
     */
    @Override
    public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
        Log.w(TAG, "Certificat SSL non-standard accepté (cert auto-signé DewiCom): " + error.toString());
        handler.proceed();
    }

    @Override
    public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
        Log.e(TAG, "WebResource error: " + error.getDescription() + " on " + request.getUrl());
    }
}
