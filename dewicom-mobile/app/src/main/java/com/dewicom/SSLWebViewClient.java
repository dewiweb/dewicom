package com.dewicom;

import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebResourceError;
import android.widget.Toast;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;
import java.security.cert.X509Certificate;
import java.io.ByteArrayInputStream;

public class SSLWebViewClient extends WebViewClient {
    
    @Override
    public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
        super.onReceivedError(view, request, error);
        Toast.makeText(view.getContext(), "Erreur SSL: " + error.getDescription(), Toast.LENGTH_LONG).show();
    }
    
    @Override
    public void onPageFinished(WebView view, String url) {
        super.onPageFinished(view, url);
        Toast.makeText(view.getContext(), "Page chargée: " + url, Toast.LENGTH_SHORT).show();
    }
}
