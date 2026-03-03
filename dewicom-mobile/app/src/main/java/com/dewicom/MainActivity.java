package com.dewicom;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.Manifest;
import android.net.http.SslError;
import android.os.Bundle;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.InputMethodManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.SslErrorHandler;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

public class MainActivity extends Activity {

    private static final String TAG = "DewiCom";
    private static final int PERMISSION_REQUEST_CODE = 1;
    private static final String PREFS_NAME = "dewicom_prefs";
    private static final String PREF_SERVER_URL = "server_url";
    private static final int DEFAULT_PORT = 3001;

    private WebView webView;
    private View connectingView = null;
    private String serverUrl = null;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        webView = findViewById(R.id.webview);

        setupWebView();

        // Permission micro puis init
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this,
                new String[]{Manifest.permission.RECORD_AUDIO}, PERMISSION_REQUEST_CODE);
        } else {
            init();
        }
    }

    private void setupWebView() {
        SSLConfigurator.configureWebView(webView, this);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            s.setSafeBrowsingEnabled(false);
        }

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                for (String res : request.getResources()) {
                    if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(res)) {
                        request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
                        return;
                    }
                }
                request.deny();
            }
        });

        webView.setWebViewClient(buildWebViewClient(false));

        // Expose l'URL courante au JS
        webView.addJavascriptInterface(new Object() {
            @JavascriptInterface
            public String getServerUrl() { return serverUrl != null ? serverUrl : ""; }
        }, "DewiComAndroid");
    }

    private void init() {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String saved = prefs.getString(PREF_SERVER_URL, null);
        if (saved != null) {
            serverUrl = saved;
            connectTo(serverUrl);
        } else {
            showServerDialog(false);
        }
    }

    private void connectTo(String url) {
        serverUrl = url;
        Log.d(TAG, "Connexion à: " + url);
        showConnecting(url);
        webView.loadUrl(url);
    }

    // ── Écran de connexion intermédiaire ─────────────────────────────────────

    private void showConnecting(String url) {
        if (connectingView != null) return;
        LinearLayout ll = new LinearLayout(this);
        ll.setOrientation(LinearLayout.VERTICAL);
        ll.setGravity(Gravity.CENTER);
        ll.setBackgroundColor(0xFF1a1a2e);
        ll.setLayoutParams(new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        int pad = dp(24);
        ll.setPadding(pad, pad, pad, pad);

        ProgressBar pb = new ProgressBar(this);
        ll.addView(pb);

        TextView tv = new TextView(this);
        tv.setText("Connexion à\n" + url);
        tv.setTextColor(0xFFCCCCCC);
        tv.setTextSize(16);
        tv.setGravity(Gravity.CENTER);
        tv.setPadding(0, dp(16), 0, dp(24));
        ll.addView(tv);

        Button btn = new Button(this);
        btn.setText("Changer de serveur");
        btn.setOnClickListener(v -> showServerDialog(false));
        ll.addView(btn);

        connectingView = ll;
        ((ViewGroup) webView.getParent()).addView(ll);
        webView.setVisibility(View.GONE);

        // Masquer l'écran de connexion dès que la page se charge
        webView.setWebViewClient(buildWebViewClient(true));
    }

    private void hideConnecting() {
        runOnUiThread(() -> {
            if (connectingView != null) {
                ((ViewGroup) connectingView.getParent()).removeView(connectingView);
                connectingView = null;
            }
            webView.setVisibility(View.VISIBLE);
        });
    }

    // ── Dialogue de saisie du serveur ────────────────────────────────────────

    private void showServerDialog(boolean isError) {
        int pad = dp(20);
        LinearLayout container = new LinearLayout(this);
        container.setOrientation(LinearLayout.VERTICAL);
        container.setPadding(pad, dp(8), pad, 0);

        EditText input = new EditText(this);
        input.setHint("192.168.1.x");
        input.setSingleLine(true);
        input.setInputType(android.text.InputType.TYPE_CLASS_TEXT
            | android.text.InputType.TYPE_TEXT_VARIATION_URI);
        // Pré-remplir avec l'URL mémorisée ou une suggestion
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String saved = prefs.getString(PREF_SERVER_URL, null);
        if (saved != null) {
            input.setText(saved);
            input.setSelection(saved.length());
        }
        container.addView(input);

        TextView hint = new TextView(this);
        hint.setText("Entrez l'IP ou l'URL du serveur DewiCom\n(ex: 192.168.1.10  ou  http://192.168.1.10:3001)");
        hint.setTextSize(12);
        hint.setTextColor(0xFF888888);
        hint.setPadding(0, dp(8), 0, 0);
        container.addView(hint);

        String title = isError ? "Serveur inaccessible" : "Serveur DewiCom";
        String msg   = isError ? "La connexion a échoué. Vérifiez l'adresse." : null;

        AlertDialog.Builder builder = new AlertDialog.Builder(this)
            .setTitle(title)
            .setView(container)
            .setCancelable(saved != null) // annulable seulement si on a déjà un serveur
            .setPositiveButton("Connecter", (dialog, w) -> {
                String raw = input.getText().toString().trim();
                if (raw.isEmpty()) return;
                String url = normalizeUrl(raw);
                getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                    .edit().putString(PREF_SERVER_URL, url).apply();
                connectTo(url);
            });

        if (saved != null) {
            builder.setNegativeButton("Annuler", null);
        }

        if (msg != null) builder.setMessage(msg);
        builder.show();

        // Focus + clavier immédiat
        input.postDelayed(() -> {
            input.requestFocus();
            InputMethodManager imm = (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
            if (imm != null) imm.showSoftInput(input, InputMethodManager.SHOW_IMPLICIT);
        }, 200);
    }

    // ── WebViewClient commun avec patch mediaDevices pour HTTP ────────────────

    private static final String SECURE_CONTEXT_PATCH =
        // Force isSecureContext=true et expose navigator.mediaDevices sur HTTP
        // La WebView Android masque mediaDevices sur les origines non-HTTPS
        "(function(){" +
        "  try { Object.defineProperty(window,'isSecureContext',{value:true,writable:false}); } catch(e){}" +
        "  if(!navigator.mediaDevices){" +
        "    try {" +
        "      Object.defineProperty(navigator,'mediaDevices',{" +
        "        value: { getUserMedia: function(c){ return navigator.getUserMedia" +
        "          ? new Promise(function(ok,ko){ navigator.getUserMedia(c,ok,ko); })" +
        "          : (navigator.webkitGetUserMedia" +
        "            ? new Promise(function(ok,ko){ navigator.webkitGetUserMedia(c,ok,ko); })" +
        "            : Promise.reject(new Error('getUserMedia not supported'))); }" +
        "        }," +
        "        writable:true, configurable:true" +
        "      });" +
        "    } catch(e){}" +
        "  }" +
        "})();";

    private WebViewClient buildWebViewClient(boolean hideConnectingOnFinish) {
        return new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                view.evaluateJavascript(SECURE_CONTEXT_PATCH, null);
            }
            @Override
            public void onPageFinished(WebView view, String url) {
                view.evaluateJavascript(SECURE_CONTEXT_PATCH, null);
                if (hideConnectingOnFinish) hideConnecting();
            }
            @Override
            public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                handler.proceed();
            }
            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    if (hideConnectingOnFinish) hideConnecting();
                    runOnUiThread(() -> showServerDialog(true));
                }
            }
        };
    }

    private String normalizeUrl(String raw) {
        if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
        // IP seule ou IP:port
        if (raw.contains(":") && !raw.startsWith("http")) {
            return "http://" + raw;
        }
        return "http://" + raw + ":" + DEFAULT_PORT;
    }

    private int dp(int dp) {
        return (int)(dp * getResources().getDisplayMetrics().density);
    }

    // ── Cycle de vie ─────────────────────────────────────────────────────────

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == PERMISSION_REQUEST_CODE) {
            if (grantResults.length == 0 || grantResults[0] != PackageManager.PERMISSION_GRANTED) {
                Toast.makeText(this, "Microphone refusé — l'audio ne fonctionnera pas", Toast.LENGTH_LONG).show();
            }
            init();
        }
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (webView != null) webView.destroy();
    }

}
