package com.nordic.kcal;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ContentValues;
import android.content.Context;
import android.content.ContentUris;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.ConsoleMessage;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.JsResult;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.util.Base64;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * 轻卡账本 (KCAL // MONO) 的原生外壳。
 *
 * 前端是单文件网页应用，这里用 WebView 承载：把 assets/www 通过一个虚拟 https 域名
 * (appassets.androidplatform.net) 提供给 WebView，这样 localStorage 有稳定的 origin，
 * 且 fetch 调用云端多模态接口时的 CORS 行为与浏览器一致（file:// 不行）。
 */
public class MainActivity extends Activity {

    private static final String HOST = "appassets.androidplatform.net";
    private static final String BASE_URL = "https://" + HOST + "/";
    private static final int REQ_PICK_FILE = 5011;

    private WebView webView;
    private ValueCallback<Uri[]> pendingFileCallback;
    private Uri pendingCameraUri;
    private boolean pageFinished = false;
    private SensorManager sensorManager;
    private float stepCounterValue = -1f;
    private boolean stepSensorRegistered = false;
    private SensorEventListener stepListener;
    private boolean fallbackTried = false;
    private String pendingQuickAction = null;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        if (getIntent() != null) {
            pendingQuickAction = getIntent().getStringExtra("kcal_action");
        }
        webView = new WebView(this);
        webView.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        webView.setBackgroundColor(Color.parseColor("#F2F4F5"));
        // Android 12+ 默认的「拉伸回弹」会把整个页面拉变形，滑到顶/底时尤其明显，这里关掉
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.setVerticalScrollBarEnabled(false);
        webView.setHorizontalScrollBarEnabled(false);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setTextZoom(100);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setLoadWithOverviewMode(false);
        s.setUseWideViewPort(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setUserAgentString(s.getUserAgentString() + " KCALNative/1.2");

        CookieManager.getInstance().setAcceptCookie(true);

        Reminders.createChannel(this);
        Reminders.scheduleAll(this);
        DailyCard.createChannel(this);
        DailyCard.refresh(this);

        sensorManager = (SensorManager) getSystemService(SENSOR_SERVICE);
        registerStepSensorIfAllowed();

        webView.addJavascriptInterface(new NativeBridge(), "KCALNative");
        webView.setWebViewClient(new Client());
        webView.setWebChromeClient(new Chrome());

        setContentView(webView);
        webView.loadUrl(BASE_URL + "index.html");

        // 兜底：3 秒没加载完就重载一次（同一 origin）；再失败弹错误，绝不切 file://
        // 切 file:// 会换掉 localStorage 的 origin，等于换一份空账本，风险太大
        webView.postDelayed(new Runnable() {
            @Override
            public void run() {
                if (!pageFinished && !fallbackTried) {
                    fallbackTried = true;
                    webView.loadUrl(BASE_URL + "index.html");
                    webView.postDelayed(new Runnable() {
                        @Override
                        public void run() {
                            if (!pageFinished) {
                                showLoadFailure();
                            }
                        }
                    }, 4000);
                }
            }
        }, 3000);
    }

    /** 页面加载失败时给出可操作提示，不静默白屏、也不切换到别的 origin。 */
    private void showLoadFailure() {
        try {
            new AlertDialog.Builder(this)
                    .setTitle("页面没有加载成功")
                    .setMessage("本地网页资源读取失败。可以先点「重试」；仍然不行就强制停止后重新打开 App，数据不会丢。")
                    .setPositiveButton("重试", new DialogInterface.OnClickListener() {
                        @Override
                        public void onClick(DialogInterface dialog, int which) {
                            fallbackTried = false;
                            pageFinished = false;
                            webView.loadUrl(BASE_URL + "index.html");
                        }
                    })
                    .setNegativeButton("退出", new DialogInterface.OnClickListener() {
                        @Override
                        public void onClick(DialogInterface dialog, int which) {
                            finish();
                        }
                    })
                    .setCancelable(false)
                    .show();
        } catch (Exception ignored) {
        }
    }

    // ---------------------------------------------------------------- WebView

    private class Client extends WebViewClient {

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri url = request.getUrl();
            if (url != null && HOST.equals(url.getHost())) {
                String path = url.getPath();
                if (path == null || path.length() == 0 || "/".equals(path)) {
                    path = "/index.html";
                }
                // 只允许访问 www 目录内的文件
                while (path.startsWith("/")) {
                    path = path.substring(1);
                }
                if (path.contains("..")) {
                    return null;
                }
                try {
                    InputStream in = getAssets().open("www/" + path);
                    WebResourceResponse resp = new WebResourceResponse(
                            mimeOf(path), isTextual(path) ? "utf-8" : null, in);
                    Map<String, String> headers = new HashMap<String, String>();
                    headers.put("Access-Control-Allow-Origin", "*");
                    headers.put("Cache-Control", "no-cache");
                    resp.setResponseHeaders(headers);
                    return resp;
                } catch (IOException e) {
                    return new WebResourceResponse("text/plain", "utf-8",
                            new ByteArrayInputStream("not found".getBytes()));
                }
            }
            return null;
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            return handleUrl(url);
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return handleUrl(request.getUrl().toString());
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            pageFinished = true;
            if (pendingQuickAction != null) {
                final String action = pendingQuickAction;
                pendingQuickAction = null;
                view.postDelayed(new Runnable() {
                    @Override
                    public void run() {
                        runQuickAction(action);
                    }
                }, 200);
            }
        }

        private boolean handleUrl(String url) {
            if (url == null) {
                return false;
            }
            if (url.startsWith(BASE_URL)) {
                return false;
            }
            // 站外链接交给系统浏览器 / 对应 App
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
            } catch (Exception ignored) {
            }
            return true;
        }
    }

    private class Chrome extends WebChromeClient {

        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                         FileChooserParams params) {
            if (pendingFileCallback != null) {
                pendingFileCallback.onReceiveValue(null);
            }
            pendingFileCallback = callback;
            pendingCameraUri = null;

            Intent content = new Intent(Intent.ACTION_GET_CONTENT);
            content.addCategory(Intent.CATEGORY_OPENABLE);
            content.setType("image/*");

            // 相机入口：不做 resolveActivity 检查（Android 11+ 包可见性限制会让它返回 null），
            // 直接把拍照意图作为首选交给系统选择器，没有相机应用时系统会自动忽略。
            Intent capture = null;
            try {
                Intent cap = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                File f = TempImageProvider.newTempFile(MainActivity.this);
                Uri out = TempImageProvider.uriFor(f);
                cap.putExtra(MediaStore.EXTRA_OUTPUT, out);
                cap.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                        | Intent.FLAG_GRANT_READ_URI_PERMISSION);
                pendingCameraUri = out;
                capture = cap;
            } catch (Exception e) {
                pendingCameraUri = null;
                capture = null;
            }

            Intent chooser = Intent.createChooser(content, "拍照或从相册选择");
            if (capture != null) {
                chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[]{capture});
                chooser.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                        | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            }
            try {
                startActivityForResult(chooser, REQ_PICK_FILE);
            } catch (Exception e) {
                if (pendingFileCallback != null) {
                    pendingFileCallback.onReceiveValue(null);
                    pendingFileCallback = null;
                }
            }
            return true;
        }

        @Override
        public boolean onConsoleMessage(ConsoleMessage cm) {
            return true;
        }

        // 网页里的 alert / confirm 需要原生实现，否则 WebView 默认什么都不显示
        @Override
        public boolean onJsAlert(WebView view, String url, String message, final JsResult result) {
            new AlertDialog.Builder(MainActivity.this)
                    .setMessage(message)
                    .setPositiveButton("知道了", new DialogInterface.OnClickListener() {
                        @Override
                        public void onClick(DialogInterface d, int which) {
                            result.confirm();
                        }
                    })
                    .setOnCancelListener(new DialogInterface.OnCancelListener() {
                        @Override
                        public void onCancel(DialogInterface d) {
                            result.cancel();
                        }
                    })
                    .show();
            return true;
        }

        @Override
        public boolean onJsConfirm(WebView view, String url, String message, final JsResult result) {
            new AlertDialog.Builder(MainActivity.this)
                    .setMessage(message)
                    .setPositiveButton("确定", new DialogInterface.OnClickListener() {
                        @Override
                        public void onClick(DialogInterface d, int which) {
                            result.confirm();
                        }
                    })
                    .setNegativeButton("取消", new DialogInterface.OnClickListener() {
                        @Override
                        public void onClick(DialogInterface d, int which) {
                            result.cancel();
                        }
                    })
                    .setOnCancelListener(new DialogInterface.OnCancelListener() {
                        @Override
                        public void onCancel(DialogInterface d) {
                            result.cancel();
                        }
                    })
                    .show();
            return true;
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode != REQ_PICK_FILE) {
            super.onActivityResult(requestCode, resultCode, data);
            return;
        }
        Uri[] results = null;
        if (resultCode == RESULT_OK) {
            if (data != null && data.getClipData() != null) {
                int n = data.getClipData().getItemCount();
                results = new Uri[n];
                for (int i = 0; i < n; i++) {
                    results[i] = data.getClipData().getItemAt(i).getUri();
                }
            } else if (data != null && data.getData() != null) {
                results = new Uri[]{data.getData()};
            } else if (pendingCameraUri != null) {
                results = new Uri[]{pendingCameraUri};
            }
        }
        if (pendingFileCallback != null) {
            pendingFileCallback.onReceiveValue(results);
            pendingFileCallback = null;
        }
        pendingCameraUri = null;
    }

    // ------------------------------------------------------------ 返回键处理

    @Override
    public void onBackPressed() {
        webView.evaluateJavascript(
                "(function(){try{return (window.__kcalBack&&window.__kcalBack())||'exit';}catch(e){return 'exit';}})()",
                new ValueCallback<String>() {
                    @Override
                    public void onReceiveValue(String value) {
                        if (value == null || value.contains("exit")) {
                            finish();
                        }
                    }
                });
    }

    // --------------------------------------------------------------- JS 桥接

    public class NativeBridge {

        @JavascriptInterface
        public void toast(final String msg) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    Toast.makeText(MainActivity.this, msg, Toast.LENGTH_SHORT).show();
                }
            });
        }

        @JavascriptInterface
        public String platform() {
            return "android";
        }

        /** 把文本(备份 JSON)写到系统「下载/KCAL」目录；老系统走应用私有目录 + 分享。 */
        @JavascriptInterface
        public void saveTextFile(final String fileName, final String content) {
            String saved = null;
            if (Build.VERSION.SDK_INT >= 29) {
                saved = saveViaMediaStore(fileName, content);
            }
            if (saved == null) {
                saved = saveViaAppDir(fileName, content);
            }
            final String msg = saved != null
                    ? "已保存：" + saved
                    : "保存失败，请改用「复制迁移码」方式备份";
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    Toast.makeText(MainActivity.this, msg, Toast.LENGTH_LONG).show();
                }
            });
        }


        /** 保存 canvas 生成的 PNG（base64 dataUrl）到「下载/KCAL」 */
        @JavascriptInterface
        public void savePngBase64(final String fileName, final String dataUrl) {
            String saved = null;
            try {
                String b64 = dataUrl == null ? "" : dataUrl;
                int comma = b64.indexOf(',');
                if (comma >= 0) {
                    b64 = b64.substring(comma + 1);
                }
                byte[] bytes = Base64.decode(b64, Base64.DEFAULT);
                if (bytes.length > 0) {
                    saved = saveBytesViaMediaStore(fileName, "image/png", bytes);
                }
            } catch (Throwable ignored) {
            }
            final String msg = saved != null
                    ? "图片已保存：下载/KCAL/" + fileName
                    : "图片保存失败，请重试";
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    Toast.makeText(MainActivity.this, msg, Toast.LENGTH_LONG).show();
                }
            });
        }

        /** 每日提醒：开启/关闭 + 两个时间点（HH:mm） */
        @JavascriptInterface
        public void setReminders(final String enabled, final String lunch, final String night) {
            final boolean on = "true".equals(enabled);
            final int[] a = parseHHmm(lunch, 12, 30);
            final int[] b = parseHHmm(night, 21, 30);
            getSharedPreferences(Reminders.PREFS, MODE_PRIVATE).edit()
                    .putBoolean("enabled", on)
                    .putInt("t1h", a[0]).putInt("t1m", a[1])
                    .putInt("t2h", b[0]).putInt("t2m", b[1])
                    .apply();
            Reminders.createChannel(MainActivity.this);
            Reminders.scheduleAll(MainActivity.this);
            boolean asked = getSharedPreferences(Reminders.PREFS, MODE_PRIVATE)
                    .getBoolean("permAsked", false);
            if (on && Build.VERSION.SDK_INT >= 33 && !asked
                    && checkSelfPermission("android.permission.POST_NOTIFICATIONS")
                    != PackageManager.PERMISSION_GRANTED) {
                getSharedPreferences(Reminders.PREFS, MODE_PRIVATE).edit()
                        .putBoolean("permAsked", true).apply();
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        try {
                            requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 5021);
                        } catch (Exception ignored) {
                        }
                    }
                });
            }
            final String msg = on ? "每日提醒已开启" : "每日提醒已关闭";
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    Toast.makeText(MainActivity.this, msg, Toast.LENGTH_SHORT).show();
                }
            });
        }



        /** 网页算好的「今日还可摄入」快照：桌面小组件与通知栏都从这里取数 */
        @JavascriptInterface
        public void pushDailyCard(final String json) {
            DailyCard.save(MainActivity.this, json);
            DailyCard.refresh(MainActivity.this);
        }

        /** 通知栏常驻开关；Android 13+ 首次开启会弹通知权限 */
        @JavascriptInterface
        public void setCardNotification(final String enabled) {
            final boolean on = "true".equals(enabled);
            DailyCard.setNotificationEnabled(MainActivity.this, on);
            if (on && Build.VERSION.SDK_INT >= 33
                    && checkSelfPermission("android.permission.POST_NOTIFICATIONS")
                    != PackageManager.PERMISSION_GRANTED) {
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        try {
                            requestPermissions(
                                    new String[]{"android.permission.POST_NOTIFICATIONS"}, 5023);
                        } catch (Exception ignored) {
                        }
                    }
                });
            }
        }

        /** API Key 的加密读写：密钥在 Android Keystore，密文在 SharedPreferences */
        @JavascriptInterface
        public String secureGet(final String name) {
            if (!"apiKey".equals(name)) {
                return "";
            }
            return SecureStore.get(MainActivity.this, name);
        }

        @JavascriptInterface
        public void secureSet(final String name, final String value) {
            if (!"apiKey".equals(name)) {
                return;
            }
            SecureStore.set(MainActivity.this, name, value);
        }

        /** 列出「下载/KCAL/自动备份」里的备份（JSON 数组，按时间倒序） */
        @JavascriptInterface
        public String listAutoBackups() {
            JSONArray arr = new JSONArray();
            try {
                Uri collection = Uri.parse("content://media/external/downloads");
                String rel = Environment.DIRECTORY_DOWNLOADS + "/" + AUTO_DIR;
                Cursor c = getContentResolver().query(collection,
                        new String[]{MediaStore.MediaColumns.DISPLAY_NAME,
                                MediaStore.MediaColumns.SIZE,
                                MediaStore.MediaColumns.DATE_ADDED},
                        "relative_path LIKE ? AND _display_name LIKE ?",
                        new String[]{rel + "%", AUTO_PREFIX + "%"}, "date_added DESC");
                if (c != null) {
                    while (c.moveToNext()) {
                        JSONObject o = new JSONObject();
                        o.put("name", c.getString(0));
                        o.put("size", c.getLong(1));
                        o.put("date", c.getLong(2));
                        arr.put(o);
                    }
                    c.close();
                }
            } catch (Exception ignored) {
            }
            try {
                File dir = new File(getExternalFilesDir(null), "auto_backup");
                File[] fs = dir.listFiles();
                if (fs != null) {
                    for (File f : fs) {
                        String n = f.getName();
                        if (n.startsWith(AUTO_PREFIX) && n.endsWith(".json")) {
                            JSONObject o = new JSONObject();
                            o.put("name", n);
                            o.put("size", f.length());
                            o.put("date", f.lastModified() / 1000);
                            arr.put(o);
                        }
                    }
                }
            } catch (Exception ignored) {
            }
            return arr.toString();
        }

        /** 读取某份自动备份的内容（只允许 kcal_auto_yyyymmdd.json） */
        @JavascriptInterface
        public String readAutoBackup(final String name) {
            if (name == null || !name.matches("^kcal_auto_\\d{8}\\.json$")) {
                return "";
            }
            try {
                Uri collection = Uri.parse("content://media/external/downloads");
                String rel = Environment.DIRECTORY_DOWNLOADS + "/" + AUTO_DIR;
                Uri uri = findDownload(collection, rel, name);
                if (uri != null) {
                    InputStream in = getContentResolver().openInputStream(uri);
                    if (in != null) {
                        String text = readAll(in);
                        in.close();
                        return text;
                    }
                }
            } catch (Exception ignored) {
            }
            try {
                File f = new File(new File(getExternalFilesDir(null), "auto_backup"), name);
                if (f.exists()) {
                    FileInputStream fis = new FileInputStream(f);
                    String text = readAll(fis);
                    fis.close();
                    return text;
                }
            } catch (Exception ignored) {
            }
            return "";
        }

        /** Health Connect 由可选模块 com.nordic.kcal.HealthSync 提供（CI 构建才包含）；这里用反射调用，缺失时安全返回 */
        private String callHealthSync(String method) {
            try {
                Class<?> c = Class.forName("com.nordic.kcal.HealthSync");
                Object inst = c.getField("INSTANCE").get(null);
                Object r = c.getMethod(method, Context.class).invoke(inst, this);
                return r == null ? "{\"ok\":false,\"reason\":\"empty\"}" : r.toString();
            } catch (Throwable t) {
                return "{\"ok\":false,\"reason\":\"absent\"}";
            }
        }

        @JavascriptInterface
        public String hcStatus() {
            return callHealthSync("status");
        }

        @JavascriptInterface
        public String hcReadToday() {
            return callHealthSync("readToday");
        }

        @JavascriptInterface
        public void hcOpenSettings() {
            try {
                Class<?> c = Class.forName("com.nordic.kcal.HealthSync");
                Object inst = c.getField("INSTANCE").get(null);
                c.getMethod("openSettings", Context.class).invoke(inst, this);
            } catch (Throwable ignored) {
            }
        }

        /** 读取系统计步器（开机以来的累计值）；返回 JSON 字符串 */
        @JavascriptInterface
        public String getStepData() {
            boolean granted = true;
            if (Build.VERSION.SDK_INT >= 29) {
                granted = checkSelfPermission("android.permission.ACTIVITY_RECOGNITION")
                        == PackageManager.PERMISSION_GRANTED;
            }
            boolean hasSensor = sensorManager != null
                    && sensorManager.getDefaultSensor(Sensor.TYPE_STEP_COUNTER) != null;
            if (!granted) {
                return "{\"ok\":false,\"reason\":\"no_permission\"}";
            }
            if (!hasSensor) {
                return "{\"ok\":false,\"reason\":\"no_sensor\"}";
            }
            if (stepCounterValue < 0) {
                registerStepSensorIfAllowed();
                return "{\"ok\":false,\"reason\":\"warming_up\"}";
            }
            return "{\"ok\":true,\"stepsSinceBoot\":" + Math.round(stepCounterValue) + "}";
        }

        /** 申请「身体活动」权限（Android 10+ 读计步器需要） */
        @JavascriptInterface
        public void requestStepPermission() {
            if (Build.VERSION.SDK_INT < 29) {
                return;
            }
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    if (checkSelfPermission("android.permission.ACTIVITY_RECOGNITION")
                            == PackageManager.PERMISSION_GRANTED) {
                        registerStepSensorIfAllowed();
                        return;
                    }
                    try {
                        requestPermissions(
                                new String[]{"android.permission.ACTIVITY_RECOGNITION"}, 5022);
                    } catch (Exception ignored) {
                    }
                }
            });
        }

        /** 每天自动备份一份到「下载/KCAL/自动备份」，保留最近 7 份 */
        @JavascriptInterface
        public void autoBackup(final String json) {
            try {
                if (Build.VERSION.SDK_INT >= 29) {
                    if (writeAutoBackup(json)) {
                        pruneAutoBackups(7);
                    }
                } else {
                    writeAutoBackupLegacy(json);
                }
            } catch (Exception ignored) {
            }
        }

        /** 分享一段文本（备份 JSON、迁移码）。 */
        @JavascriptInterface
        public void shareText(final String text) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    Intent i = new Intent(Intent.ACTION_SEND);
                    i.setType("text/plain");
                    i.putExtra(Intent.EXTRA_TEXT, text);
                    try {
                        startActivity(Intent.createChooser(i, "分享迁移码"));
                    } catch (Exception ignored) {
                    }
                }
            });
        }

        /** 分享刚导出的备份文件。 */
        @JavascriptInterface
        public void shareLastExport() {
            final String path = lastExportPath;
            if (path == null) {
                toast("还没有导出过备份文件");
                return;
            }
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        Uri uri = exportUriFor(path);
                        if (uri == null) {
                            return;
                        }
                        Intent i = new Intent(Intent.ACTION_SEND);
                        i.setType("application/json");
                        i.putExtra(Intent.EXTRA_STREAM, uri);
                        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        startActivity(Intent.createChooser(i, "分享备份文件"));
                    } catch (Exception ignored) {
                    }
                }
            });
        }
    }

    private String lastExportPath;
    private Uri lastExportUri;

    private Uri exportUriFor(String path) {
        if (lastExportUri != null) {
            return lastExportUri;
        }
        return null;
    }

    private static String mimeForName(String name) {
        String n = name == null ? "" : name.toLowerCase();
        if (n.endsWith(".csv")) return "text/csv";
        if (n.endsWith(".png")) return "image/png";
        if (n.endsWith(".txt")) return "text/plain";
        if (n.endsWith(".html")) return "text/html";
        return "application/json";
    }

    private String saveViaMediaStore(String fileName, String content) {
        OutputStream out = null;
        try {
            ContentValues cv = new ContentValues();
            cv.put(MediaStore.MediaColumns.DISPLAY_NAME, fileName);
            cv.put(MediaStore.MediaColumns.MIME_TYPE, mimeForName(fileName));
            cv.put("relative_path", Environment.DIRECTORY_DOWNLOADS + "/KCAL");
            Uri collection = Uri.parse("content://media/external/downloads");
            Uri uri = getContentResolver().insert(collection, cv);
            if (uri == null) {
                return null;
            }
            out = getContentResolver().openOutputStream(uri);
            if (out == null) {
                return null;
            }
            out.write(content.getBytes("UTF-8"));
            out.flush();
            lastExportUri = uri;
            lastExportPath = fileName;
            return "下载/KCAL/" + fileName;
        } catch (Exception e) {
            return null;
        } finally {
            closeQuietly(out);
        }
    }

    private String saveBytesViaMediaStore(String fileName, String mime, byte[] bytes) {
        OutputStream out = null;
        try {
            ContentValues cv = new ContentValues();
            cv.put(MediaStore.MediaColumns.DISPLAY_NAME, fileName);
            cv.put(MediaStore.MediaColumns.MIME_TYPE, mime);
            cv.put("relative_path", Environment.DIRECTORY_DOWNLOADS + "/KCAL");
            Uri collection = Uri.parse("content://media/external/downloads");
            Uri uri = getContentResolver().insert(collection, cv);
            if (uri == null) {
                return null;
            }
            out = getContentResolver().openOutputStream(uri);
            if (out == null) {
                return null;
            }
            out.write(bytes);
            out.flush();
            return "下载/KCAL/" + fileName;
        } catch (Exception e) {
            return null;
        } finally {
            closeQuietly(out);
        }
    }

    private String saveViaAppDir(String fileName, String content) {
        try {
            File dir = new File(getExternalFilesDir(null), "exports");
            if (!dir.exists() && !dir.mkdirs()) {
                dir = getFilesDir();
            }
            File f = new File(dir, fileName);
            FileOutputStream fos = new FileOutputStream(f);
            fos.write(content.getBytes("UTF-8"));
            fos.close();
            lastExportPath = f.getAbsolutePath();
            return f.getAbsolutePath();
        } catch (Exception e) {
            return null;
        }
    }

    private static String readAll(InputStream in) throws IOException {
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) {
            bos.write(buf, 0, n);
        }
        return new String(bos.toByteArray(), "UTF-8");
    }

    private static void closeQuietly(OutputStream out) {
        if (out != null) {
            try {
                out.close();
            } catch (IOException ignored) {
            }
        }
    }


    // ------------------------------------------------------------ 自动备份

    private static final String AUTO_DIR = "KCAL/自动备份";
    private static final String AUTO_PREFIX = "kcal_auto_";

    private static int[] parseHHmm(String s, int dh, int dm) {
        try {
            if (s != null && s.indexOf(':') > 0) {
                String[] p = s.split(":");
                int h = Integer.parseInt(p[0].trim());
                int m = Integer.parseInt(p[1].trim());
                if (h >= 0 && h < 24 && m >= 0 && m < 60) {
                    return new int[]{h, m};
                }
            }
        } catch (Exception ignored) {
        }
        return new int[]{dh, dm};
    }

    private boolean writeAutoBackup(String json) {
        String day = new SimpleDateFormat("yyyyMMdd", Locale.US).format(new Date());
        String name = AUTO_PREFIX + day + ".json";
        String rel = Environment.DIRECTORY_DOWNLOADS + "/" + AUTO_DIR;
        Uri collection = Uri.parse("content://media/external/downloads");
        OutputStream out = null;
        try {
            Uri existing = findDownload(collection, rel, name);
            if (existing != null) {
                out = getContentResolver().openOutputStream(existing, "wt");
                if (out == null) {
                    return false;
                }
                out.write(json.getBytes("UTF-8"));
                return true;
            }
            ContentValues cv = new ContentValues();
            cv.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
            cv.put(MediaStore.MediaColumns.MIME_TYPE, "application/json");
            cv.put("relative_path", rel);
            Uri uri = getContentResolver().insert(collection, cv);
            if (uri == null) {
                return false;
            }
            out = getContentResolver().openOutputStream(uri);
            if (out == null) {
                return false;
            }
            out.write(json.getBytes("UTF-8"));
            return true;
        } catch (Exception e) {
            return false;
        } finally {
            closeQuietly(out);
        }
    }

    private Uri findDownload(Uri collection, String rel, String name) {
        Cursor c = null;
        try {
            c = getContentResolver().query(collection,
                    new String[]{MediaStore.MediaColumns._ID},
                    "_display_name=? AND relative_path LIKE ?", new String[]{name, rel + "%"}, null);
            if (c != null && c.moveToFirst()) {
                return ContentUris.withAppendedId(collection, c.getLong(0));
            }
        } catch (Exception ignored) {
        } finally {
            if (c != null) {
                c.close();
            }
        }
        return null;
    }

    private void pruneAutoBackups(int keep) {
        String rel = Environment.DIRECTORY_DOWNLOADS + "/" + AUTO_DIR;
        Uri collection = Uri.parse("content://media/external/downloads");
        Cursor c = null;
        try {
            c = getContentResolver().query(collection,
                    new String[]{MediaStore.MediaColumns._ID},
                    "relative_path LIKE ? AND _display_name LIKE ?",
                    new String[]{rel + "%", AUTO_PREFIX + "%"}, "date_added DESC");
            if (c == null) {
                return;
            }
            int i = 0;
            while (c.moveToNext()) {
                i++;
                if (i <= keep) {
                    continue;
                }
                try {
                    getContentResolver().delete(
                            ContentUris.withAppendedId(collection, c.getLong(0)), null, null);
                } catch (Exception ignored) {
                }
            }
        } catch (Exception ignored) {
        } finally {
            if (c != null) {
                c.close();
            }
        }
    }

    private void writeAutoBackupLegacy(String json) {
        try {
            File dir = new File(getExternalFilesDir(null), "auto_backup");
            if (!dir.exists() && !dir.mkdirs()) {
                return;
            }
            String day = new SimpleDateFormat("yyyyMMdd", Locale.US).format(new Date());
            File f = new File(dir, AUTO_PREFIX + day + ".json");
            FileOutputStream fos = new FileOutputStream(f);
            fos.write(json.getBytes("UTF-8"));
            fos.close();
        } catch (Exception ignored) {
        }
    }


    // ------------------------------------------------------------ 计步传感器

    private void registerStepSensorIfAllowed() {
        if (sensorManager == null || stepSensorRegistered) {
            return;
        }
        if (Build.VERSION.SDK_INT >= 29
                && checkSelfPermission("android.permission.ACTIVITY_RECOGNITION")
                != PackageManager.PERMISSION_GRANTED) {
            return;
        }
        Sensor counter = sensorManager.getDefaultSensor(Sensor.TYPE_STEP_COUNTER);
        if (counter == null) {
            return;
        }
        stepListener = new SensorEventListener() {
            @Override
            public void onSensorChanged(SensorEvent event) {
                if (event != null && event.values != null && event.values.length > 0) {
                    stepCounterValue = event.values[0];
                }
            }

            @Override
            public void onAccuracyChanged(Sensor sensor, int accuracy) {
            }
        };
        stepSensorRegistered = sensorManager.registerListener(stepListener, counter, SensorManager.SENSOR_DELAY_NORMAL);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (intent == null) {
            return;
        }
        String action = intent.getStringExtra("kcal_action");
        if (action == null) {
            return;
        }
        if (pageFinished) {
            runQuickAction(action);
        } else {
            pendingQuickAction = action;
        }
    }

    /** 通知栏快捷动作 → 交给网页执行（白名单） */
    private void runQuickAction(String action) {
        if (action == null || webView == null) {
            return;
        }
        String safe = action.replaceAll("[^a-zA-Z0-9_]", "");
        try {
            webView.evaluateJavascript(
                    "window.__kcalQuickAction && window.__kcalQuickAction('" + safe + "')", null);
        } catch (Exception ignored) {
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode == 5022) {
            for (int r : results) {
                if (r == PackageManager.PERMISSION_GRANTED) {
                    registerStepSensorIfAllowed();
                }
            }
        } else if (requestCode == 5023) {
            // 通知权限结果：允许后立刻补一条常驻通知
            DailyCard.updateNotification(this);
        }
    }

    @Override
    protected void onDestroy() {
        if (sensorManager != null && stepSensorRegistered && stepListener != null) {
            try {
                sensorManager.unregisterListener(stepListener);
            } catch (Exception ignored) {
            }
            stepSensorRegistered = false;
        }
        super.onDestroy();
    }

    // ------------------------------------------------------------------ 工具

    private static boolean isTextual(String path) {
        String p = path.toLowerCase();
        return p.endsWith(".html") || p.endsWith(".js") || p.endsWith(".css")
                || p.endsWith(".json") || p.endsWith(".svg") || p.endsWith(".txt");
    }

    private static String mimeOf(String path) {
        String p = path.toLowerCase();
        if (p.endsWith(".html") || p.endsWith(".htm")) return "text/html";
        if (p.endsWith(".js")) return "application/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".json")) return "application/json";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
        if (p.endsWith(".webp")) return "image/webp";
        if (p.endsWith(".woff2")) return "font/woff2";
        if (p.endsWith(".woff")) return "font/woff";
        if (p.endsWith(".ttf")) return "font/ttf";
        if (p.endsWith(".ico")) return "image/x-icon";
        return "application/octet-stream";
    }
}
