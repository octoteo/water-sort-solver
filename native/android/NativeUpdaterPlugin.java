package com.octoteo.watersortsolver;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

@CapacitorPlugin(name = "NativeUpdater")
public class NativeUpdaterPlugin extends Plugin {
    private static final String[] MANIFEST_URLS = new String[]{
        "https://water-sort-solver-eight.vercel.app/update/latest.json",
        "https://raw.githubusercontent.com/octoteo/water-sort-solver/main/public/update/latest.json"
    };

    @PluginMethod
    public void getCurrentVersion(PluginCall call) {
        try {
            PackageInfo info = getPackageInfo();
            JSObject result = new JSObject();
            result.put("versionName", info.versionName != null ? info.versionName : "0.0.0");
            result.put("versionCode", getVersionCode(info));
            call.resolve(result);
        } catch (Exception error) {
            call.reject("无法读取当前版本：" + error.getMessage());
        }
    }

    @PluginMethod
    public void checkForUpdate(PluginCall call) {
        new Thread(() -> {
            Exception lastError = null;
            for (String manifestUrl : MANIFEST_URLS) {
                try {
                    JSONObject manifest = fetchJson(manifestUrl);
                    PackageInfo current = getPackageInfo();
                    long currentCode = getVersionCode(current);
                    long latestCode = manifest.optLong("versionCode", currentCode);
                    String latestName = manifest.optString("versionName", String.valueOf(latestCode));
                    String apkUrl = manifest.optString("apkUrl", "");
                    String notes = manifest.optString("notes", "");
                    if (apkUrl.isEmpty()) throw new IllegalStateException("更新清单缺少 apkUrl");

                    JSObject result = new JSObject();
                    result.put("available", latestCode > currentCode);
                    result.put("currentVersionCode", currentCode);
                    result.put("currentVersionName", current.versionName != null ? current.versionName : "0.0.0");
                    result.put("versionCode", latestCode);
                    result.put("versionName", latestName);
                    result.put("apkUrl", apkUrl);
                    result.put("notes", notes);
                    result.put("manifestUrl", manifestUrl);
                    call.resolve(result);
                    return;
                } catch (Exception error) {
                    lastError = error;
                }
            }
            call.reject("检查更新失败：" + (lastError != null ? lastError.getMessage() : "网络不可用"));
        }, "water-sort-update-check").start();
    }

    @PluginMethod
    public void installUpdate(PluginCall call) {
        String apkUrl = call.getString("apkUrl");
        if (apkUrl == null || apkUrl.isEmpty()) {
            call.reject("缺少 APK 下载地址。");
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !getContext().getPackageManager().canRequestPackageInstalls()) {
            Activity activity = getActivity();
            if (activity == null) {
                call.reject("无法打开“允许安装未知应用”设置。");
                return;
            }
            Intent settingsIntent = new Intent(
                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:" + getContext().getPackageName())
            );
            activity.startActivity(settingsIntent);
            JSObject result = new JSObject();
            result.put("started", false);
            result.put("needsPermission", true);
            call.resolve(result);
            return;
        }

        new Thread(() -> {
            File target = null;
            try {
                File updateDir = new File(getContext().getCacheDir(), "updates");
                if (!updateDir.exists() && !updateDir.mkdirs()) throw new IllegalStateException("无法创建更新目录");
                target = new File(updateDir, "water-sort-solver-update.apk");
                download(apkUrl, target);
                if (target.length() < 500_000) throw new IllegalStateException("下载到的 APK 文件异常");

                File apk = target;
                Activity activity = getActivity();
                if (activity == null) throw new IllegalStateException("Activity unavailable");
                activity.runOnUiThread(() -> {
                    try {
                        Uri uri = FileProvider.getUriForFile(
                            getContext(),
                            getContext().getPackageName() + ".files",
                            apk
                        );
                        Intent installIntent = new Intent(Intent.ACTION_VIEW);
                        installIntent.setDataAndType(uri, "application/vnd.android.package-archive");
                        installIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        activity.startActivity(installIntent);

                        JSObject result = new JSObject();
                        result.put("started", true);
                        result.put("needsPermission", false);
                        call.resolve(result);
                    } catch (Exception error) {
                        call.reject("无法打开 Android 安装器：" + error.getMessage());
                    }
                });
            } catch (Exception error) {
                if (target != null) {
                    //noinspection ResultOfMethodCallIgnored
                    target.delete();
                }
                call.reject("下载更新失败：" + error.getMessage());
            }
        }, "water-sort-update-download").start();
    }

    private PackageInfo getPackageInfo() throws PackageManager.NameNotFoundException {
        PackageManager packageManager = getContext().getPackageManager();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return packageManager.getPackageInfo(
                getContext().getPackageName(),
                PackageManager.PackageInfoFlags.of(0)
            );
        }
        //noinspection deprecation
        return packageManager.getPackageInfo(getContext().getPackageName(), 0);
    }

    private long getVersionCode(PackageInfo info) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) return info.getLongVersionCode();
        //noinspection deprecation
        return info.versionCode;
    }

    private JSONObject fetchJson(String sourceUrl) throws Exception {
        HttpURLConnection connection = open(sourceUrl);
        try {
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) throw new IllegalStateException("HTTP " + status);
            try (InputStream input = new BufferedInputStream(connection.getInputStream());
                 ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[16 * 1024];
                int read;
                while ((read = input.read(buffer)) >= 0) {
                    if (read > 0) output.write(buffer, 0, read);
                }
                return new JSONObject(output.toString("UTF-8"));
            }
        } finally {
            connection.disconnect();
        }
    }

    private void download(String sourceUrl, File target) throws Exception {
        HttpURLConnection connection = open(sourceUrl);
        try {
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) throw new IllegalStateException("HTTP " + status);
            try (InputStream input = new BufferedInputStream(connection.getInputStream());
                 BufferedOutputStream output = new BufferedOutputStream(new FileOutputStream(target))) {
                byte[] buffer = new byte[64 * 1024];
                int read;
                while ((read = input.read(buffer)) >= 0) {
                    if (read > 0) output.write(buffer, 0, read);
                }
                output.flush();
            }
        } finally {
            connection.disconnect();
        }
    }

    private HttpURLConnection open(String sourceUrl) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(sourceUrl).openConnection();
        connection.setConnectTimeout(8_000);
        connection.setReadTimeout(30_000);
        connection.setInstanceFollowRedirects(true);
        connection.setRequestProperty("User-Agent", "WaterSortSolver-Android/0.7");
        connection.setRequestProperty("Accept", "application/json, application/vnd.android.package-archive, */*");
        return connection;
    }
}
