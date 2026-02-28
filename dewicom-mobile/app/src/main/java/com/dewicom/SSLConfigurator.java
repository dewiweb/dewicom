package com.dewicom;

import android.content.Context;
import android.webkit.WebView;
import android.webkit.WebSettings;
import java.security.cert.X509Certificate;
import javax.net.ssl.X509TrustManager;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManager;
import java.security.SecureRandom;

public class SSLConfigurator {
    
    public static void configureWebView(WebView webView, Context context) {
        WebSettings webSettings = webView.getSettings();
        
        // Accepte les certificats SSL auto-signés
        webSettings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        
        // Configure pour accepter tous les certificats
        try {
            SSLContext sslContext = SSLContext.getInstance("TLS");
            sslContext.init(null, new TrustManager[] {
                new X509TrustManager() {
                    public X509Certificate[] getAcceptedIssuers() {
                        return new X509Certificate[]{};
                    }
                    public void checkClientTrusted(X509Certificate[] chain, String authType) {
                    }
                    public void checkServerTrusted(X509Certificate[] chain, String authType) {
                    }
                }
            }, new SecureRandom());
            
            // Applique la configuration SSL à la WebView
            android.webkit.WebView.setWebContentsDebuggingEnabled(true);
            
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}
