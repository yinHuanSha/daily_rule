package io.github.yinhuansha.dailyrule;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

public final class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String INDEX = "https://" + HOST + "/index.html";
    private static final int IMPORT = 10, EXPORT = 11;
    private WebView web;
    private SecretStore secrets;
    private ValueCallback<Uri[]> picker;
    private File pendingExport;
    private String pendingTicket;

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        secrets = new SecretStore(this);
        pendingExport = new File(getCacheDir(), "pending-export.json");
        if (saved != null) pendingTicket = saved.getString("ticket");
        web = new WebView(this);
        web.setBackgroundColor(Color.rgb(244, 239, 223));
        web.setOnApplyWindowInsetsListener((view, insets) -> {
            view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                    insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets.consumeSystemWindowInsets();
        });
        setContentView(web);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        web.addJavascriptInterface(new Bridge(), "DailyRuleAndroid");
        web.setWebViewClient(new WebViewClient() {
            @Override public void onPageFinished(WebView view, String url) {
                if (!isLocal(Uri.parse(url))) return;
                view.postDelayed(() -> {
                    if (isFinishing() || isDestroyed()) return;
                    view.evaluateJavascript("!!(document.getElementById('root') && document.getElementById('root').firstElementChild)", ready -> {
                        if (!"false".equals(ready) || isFinishing() || isDestroyed()) return;
                        new AlertDialog.Builder(MainActivity.this)
                                .setTitle("每日国策未能显示")
                                .setMessage("请在应用商店更新 Android System WebView 或 Chrome，然后重新打开每日国策。")
                                .setPositiveButton("重新加载", (dialog, which) -> web.reload())
                                .setNegativeButton("关闭", (dialog, which) -> finish()).show();
                    });
                }, 6000);
            }

            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                // All in-app documents are bundled. Never attach the bridge to an external document.
                return !isLocal(request.getUrl());
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (isLocal(uri)) return asset(uri);
                if (!request.isForMainFrame() && "https".equals(uri.getScheme())
                        && "api.github.com".equals(uri.getHost()) && uri.getUserInfo() == null
                        && (uri.getPort() == -1 || uri.getPort() == 443)) return null;
                return missing();
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (picker != null) picker.onReceiveValue(null);
                picker = callback;
                Intent request = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE);
                // Some file providers report a JSON backup as text/plain or octet-stream.
                request.setType("*/*");
                try { startActivityForResult(request, IMPORT); }
                catch (RuntimeException ex) { picker.onReceiveValue(null); picker = null; }
                return true;
            }
        });
        web.loadUrl(INDEX);
    }

    private static boolean isLocal(Uri uri) {
        return "https".equals(uri.getScheme()) && HOST.equals(uri.getAuthority());
    }

    private WebResourceResponse asset(Uri uri) {
        String path = uri.getPath();
        if (path == null) return missing();
        if ("/".equals(path)) path = "/index.html";
        if (!path.matches("/[a-zA-Z0-9_./-]+") || path.contains("..") || path.contains("//")) return missing();
        String mime = path.endsWith(".js") ? "text/javascript" : path.endsWith(".css") ? "text/css" :
                path.endsWith(".html") ? "text/html" : path.endsWith(".svg") ? "image/svg+xml" :
                path.endsWith(".png") ? "image/png" : path.endsWith(".jpg") ? "image/jpeg" :
                path.endsWith(".webmanifest") ? "application/manifest+json" : "application/octet-stream";
        try {
            InputStream input = getAssets().open("www" + path);
            Map<String,String> headers = new HashMap<>();
            headers.put("Cache-Control", "no-store");
            headers.put("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
                    + "img-src 'self' data: blob:; connect-src 'self' https://api.github.com; frame-src 'none'; "
                    + "object-src 'none'; base-uri 'none'; form-action 'none'; worker-src 'none'");
            return new WebResourceResponse(mime, mime.startsWith("text/") ? "UTF-8" : null, 200, "OK", headers, input);
        } catch (IOException missing) { return missing(); }
    }

    private static WebResourceResponse missing() {
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", Collections.emptyMap(),
                new ByteArrayInputStream(new byte[0]));
    }

    private final class Bridge {
        @JavascriptInterface public String getSecret() {
            try { return secrets.read(); }
            catch (Exception ex) { throw new IllegalStateException("设备密钥不可用，请重新连接同步账户。"); }
        }
        @JavascriptInterface public boolean setSecret(String value) {
            try { return value != null && secrets.write(value); }
            catch (Exception ex) { return false; }
        }
        @JavascriptInterface public void exportJson(String filename, String json, String ticket) {
            runOnUiThread(() -> startExport(filename, json, ticket));
        }
    }

    private void startExport(String filename, String json, String ticket) {
        if (ticket == null || !ticket.matches("[a-zA-Z0-9-]{1,80}")) return;
        if (pendingTicket != null) { exportResult(ticket, "busy"); return; }
        if (filename == null || !filename.matches("daily-rule-backup-v[0-9]+-[0-9-]+\\.json"))
            filename = "daily-rule-backup.json";
        try {
            try (OutputStream out = new FileOutputStream(pendingExport)) {
                out.write(json.getBytes(StandardCharsets.UTF_8));
            }
            pendingTicket = ticket;
            startActivityForResult(new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                    .setType("application/json").putExtra(Intent.EXTRA_TITLE, filename), EXPORT);
        } catch (IOException | RuntimeException ex) { finishExport(ticket, "error"); }
    }

    private void finishExport(String ticket, String state) {
        pendingTicket = null;
        pendingExport.delete();
        exportResult(ticket, state);
    }

    private void exportResult(String ticket, String state) {
        web.evaluateJavascript("window.dispatchEvent(new CustomEvent('daily-rule-export',{detail:{ticket:'"
                + ticket + "',status:'" + state + "'}}))", null);
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        Uri uri = data != null ? data.getData() : null;
        boolean selected = result == RESULT_OK && uri != null && "content".equals(uri.getScheme());
        if (request == IMPORT && picker != null) {
            picker.onReceiveValue(selected ? new Uri[]{uri} : null);
            picker = null;
        } else if (request == EXPORT && pendingTicket != null) {
            String ticket = pendingTicket;
            if (!selected) { finishExport(ticket, "cancel"); return; }
            try (InputStream input = new FileInputStream(pendingExport);
                 OutputStream output = getContentResolver().openOutputStream(uri, "wt")) {
                if (output == null) throw new IOException();
                byte[] block = new byte[8192]; int count;
                while ((count = input.read(block)) != -1) output.write(block, 0, count);
            } catch (IOException | RuntimeException ex) {
                finishExport(ticket, "error");
                Toast.makeText(this, "备份未保存，请重试。", Toast.LENGTH_LONG).show();
                return;
            }
            finishExport(ticket, "saved");
            Toast.makeText(this, "已保存 JSON 备份", Toast.LENGTH_SHORT).show();
        }
    }

    @Override public void onBackPressed() {
        web.evaluateJavascript("(function(){var d=document.querySelector('dialog[open]');"
                + "if(d){var b=d.querySelector('[aria-label=关闭]');if(b)b.click();return true}"
                + "return false})()", handled -> {
                    if ("true".equals(handled)) return;
                    if (web.canGoBack()) web.goBack(); else super.onBackPressed();
                });
    }

    @Override protected void onSaveInstanceState(Bundle state) {
        super.onSaveInstanceState(state);
        state.putString("ticket", pendingTicket);
    }
}
