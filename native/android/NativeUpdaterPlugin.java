package com.octoteo.watersortsolver;

import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@CapacitorPlugin(name = "NativeUpdater")
public class NativeUpdaterPlugin extends Plugin {
    private static final String APK_MIME = "application/vnd.android.package-archive";
    private static final String GITEE_MANIFEST = "https://gitee.com/octoteo/water-sort-solver-android/raw/main/latest.json";
    private static final String GITHUB_RELEASE_MANIFEST = "https://github.com/octoteo/water-sort-solver/releases/download/android-latest/latest.json";
    private static final String[] MANIFEST_URLS = new String[]{
        GITEE_MANIFEST,
        GITHUB_RELEASE_MANIFEST,
        "https://water-sort-solver-eight.vercel.app/update/latest.json",
        "https://raw.githubusercontent.com/octoteo/water-sort-solver/main/public/update/latest.json"
    };

    private volatile UpdatePlan lastPlan;

    private static final class ApkSource {
        final String name;
        final String url;

        ApkSource(String name, String url) {
            this.name = name;
            this.url = url;
        }
    }

    private static final class UpdatePlan {
        final long versionCode;
        final String versionName;
        final String notes;
        final String sha256;
        final String manifestUrl;
        final List<ApkSource> sources;

        UpdatePlan(long versionCode, String versionName, String notes, String sha256, String manifestUrl, List<ApkSource> sources) {
            this.versionCode = versionCode;
            this.versionName = versionName;
            this.notes = notes;
            this.sha256 = sha256;
            this.manifestUrl = manifestUrl;
            this.sources = sources;
        }
    }

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
                    String notes = manifest.optString("notes", "");
                    String sha256 = normalizeSha256(manifest.optString("sha256", ""));
                    List<ApkSource> sources = parseSources(manifest);
                    if (sources.isEmpty()) throw new IllegalStateException("更新清单缺少 APK 下载地址");

                    UpdatePlan plan = new UpdatePlan(latestCode, latestName, notes, sha256, manifestUrl, sources);
                    lastPlan = plan;

                    JSObject result = new JSObject();
                    result.put("available", latestCode > currentCode);
                    result.put("currentVersionCode", currentCode);
                    result.put("currentVersionName", current.versionName != null ? current.versionName : "0.0.0");
                    result.put("versionCode", latestCode);
                    result.put("versionName", latestName);
                    result.put("apkUrl", sources.get(0).url);
                    result.put("fallbackApkUrl", sources.size() > 1 ? sources.get(1).url : "");
                    result.put("downloadSource", sources.get(0).name);
                    result.put("sha256", sha256);
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
        String requestedUrl = call.getString("apkUrl");
        if (requestedUrl == null || requestedUrl.isEmpty()) {
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

                UpdatePlan plan = lastPlan;
                List<ApkSource> candidates = new ArrayList<>();
                String expectedSha256 = "";
                if (plan != null && !plan.sources.isEmpty() && requestedUrl.equals(plan.sources.get(0).url)) {
                    candidates.addAll(plan.sources);
                    expectedSha256 = plan.sha256;
                } else {
                    candidates.add(new ApkSource("首选源", requestedUrl));
                }

                Exception lastDownloadError = null;
                ApkSource successfulSource = null;
                for (ApkSource source : candidates) {
                    try {
                        if (target.exists() && !target.delete()) throw new IllegalStateException("无法清理旧更新文件");
                        download(source.url, target);
                        if (target.length() < 500_000) throw new IllegalStateException("下载到的 APK 文件异常");
                        if (!expectedSha256.isEmpty()) verifySha256(target, expectedSha256);
                        successfulSource = source;
                        break;
                    } catch (Exception error) {
                        lastDownloadError = error;
                    }
                }

                if (successfulSource == null) {
                    throw new IllegalStateException(lastDownloadError != null ? lastDownloadError.getMessage() : "所有更新源均不可用");
                }

                File apk = target;
                String sourceName = successfulSource.name;
                Activity activity = getActivity();
                if (activity == null) throw new IllegalStateException("Activity unavailable");
                activity.runOnUiThread(() -> openInstaller(activity, apk, sourceName, call));
            } catch (Exception error) {
                if (target != null) {
                    //noinspection ResultOfMethodCallIgnored
                    target.delete();
                }
                call.reject("下载更新失败：" + error.getMessage());
            }
        }, "water-sort-update-download").start();
    }

    private void openInstaller(Activity activity, File apk, String sourceName, PluginCall call) {
        try {
            Uri uri = FileProvider.getUriForFile(
                getContext(),
                getContext().getPackageName() + ".files",
                apk
            );

            Intent installIntent = new Intent(Intent.ACTION_INSTALL_PACKAGE);
            installIntent.setDataAndType(uri, APK_MIME);
            installIntent.setClipData(ClipData.newRawUri("Water Sort Solver update", uri));
            installIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

            PackageManager packageManager = getContext().getPackageManager();
            List<ResolveInfo> handlers = packageManager.queryIntentActivities(installIntent, PackageManager.MATCH_DEFAULT_ONLY);
            if (handlers.isEmpty()) {
                installIntent.setAction(Intent.ACTION_VIEW);
                handlers = packageManager.queryIntentActivities(installIntent, PackageManager.MATCH_DEFAULT_ONLY);
            }

            grantReadAccess(uri, handlers);
            ResolveInfo resolved = packageManager.resolveActivity(installIntent, PackageManager.MATCH_DEFAULT_ONLY);
            if (resolved != null && resolved.activityInfo != null && resolved.activityInfo.packageName != null) {
                getContext().grantUriPermission(
                    resolved.activityInfo.packageName,
                    uri,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION
                );
            }

            activity.startActivity(installIntent);

            JSObject result = new JSObject();
            result.put("started", true);
            result.put("needsPermission", false);
            result.put("source", sourceName);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("无法打开 Android 安装器：" + error.getMessage());
        }
    }

    private void grantReadAccess(Uri uri, List<ResolveInfo> handlers) {
        for (ResolveInfo handler : handlers) {
            if (handler == null || handler.activityInfo == null) continue;
            String packageName = handler.activityInfo.packageName;
            if (packageName == null || packageName.isEmpty()) continue;
            try {
                getContext().grantUriPermission(packageName, uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
            } catch (Exception ignored) {
                // Keep trying the remaining package installer handlers. The intent
                // still carries a scoped grant as the platform-standard fallback.
            }
        }
    }

    private List<ApkSource> parseSources(JSONObject manifest) {
        Map<String, ApkSource> unique = new LinkedHashMap<>();
        JSONArray sources = manifest.optJSONArray("apkSources");
        if (sources != null) {
            for (int index = 0; index < sources.length(); index++) {
                JSONObject source = sources.optJSONObject(index);
                if (source == null) continue;
                String url = source.optString("url", "").trim();
                if (url.isEmpty()) continue;
                String name = source.optString("name", "更新源").trim();
                unique.put(url, new ApkSource(name.isEmpty() ? "更新源" : name, url));
            }
        }
        String legacyUrl = manifest.optString("apkUrl", "").trim();
        if (!legacyUrl.isEmpty() && !unique.containsKey(legacyUrl)) {
            unique.put(legacyUrl, new ApkSource("兼容更新源", legacyUrl));
        }
        return new ArrayList<>(unique.values());
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

    private void verifySha256(File file, String expected) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream input = new BufferedInputStream(new FileInputStream(file))) {
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = input.read(buffer)) >= 0) {
                if (read > 0) digest.update(buffer, 0, read);
            }
        }
        StringBuilder actual = new StringBuilder();
        for (byte value : digest.digest()) actual.append(String.format("%02x", value & 0xff));
        if (!actual.toString().equals(normalizeSha256(expected))) {
            throw new IllegalStateException("APK SHA-256 校验失败");
        }
    }

    private String normalizeSha256(String value) {
        return value == null ? "" : value.replace(":", "").trim().toLowerCase();
    }

    private HttpURLConnection open(String sourceUrl) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(sourceUrl).openConnection();
        connection.setConnectTimeout(8_000);
        connection.setReadTimeout(60_000);
        connection.setInstanceFollowRedirects(true);
        connection.setRequestProperty("User-Agent", "WaterSortSolver-Android/0.8");
        connection.setRequestProperty("Accept", "application/json, application/vnd.android.package-archive, */*");
        return connection;
    }
}
