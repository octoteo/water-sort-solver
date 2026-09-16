package com.octoteo.watersortsolver;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.IntentSender;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

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
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@CapacitorPlugin(name = "NativeUpdater")
public class NativeUpdaterPlugin extends Plugin {
    private static final String GITEE_MANIFEST = "https://gitee.com/octoteo/water-sort-solver-android/raw/main/latest.json";
    private static final String GITHUB_RELEASE_MANIFEST = "https://github.com/octoteo/water-sort-solver/releases/download/android-latest/latest.json";
    private static final String[] MANIFEST_URLS = new String[]{
        GITEE_MANIFEST,
        GITHUB_RELEASE_MANIFEST
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
            PackageInfo info = getPackageInfo(0);
            JSObject result = new JSObject();
            result.put("versionName", info.versionName != null ? info.versionName : "0.0.0");
            result.put("versionCode", getVersionCode(info));
            call.resolve(result);
        } catch (Exception error) {
            UpdateDiagnostics.recordException(getContext(), "version.read.failure", error);
            call.reject("无法读取当前版本：" + error.getMessage());
        }
    }

    @PluginMethod
    public void getUpdateDiagnostics(PluginCall call) {
        JSObject result = new JSObject();
        result.put("report", UpdateDiagnostics.buildReport(getContext()));
        call.resolve(result);
    }

    @PluginMethod
    public void clearUpdateDiagnostics(PluginCall call) {
        UpdateDiagnostics.clear(getContext());
        JSObject result = new JSObject();
        result.put("cleared", true);
        call.resolve(result);
    }

    @PluginMethod
    public void checkForUpdate(PluginCall call) {
        UpdateDiagnostics.record(getContext(), "check.start", "checking update manifests");
        new Thread(() -> {
            Exception lastError = null;
            UpdatePlan bestPlan = null;
            PackageInfo current;
            long currentCode;
            try {
                current = getPackageInfo(0);
                currentCode = getVersionCode(current);
            } catch (Exception error) {
                UpdateDiagnostics.recordException(getContext(), "check.failure", error);
                call.reject("检查更新失败：" + error.getMessage());
                return;
            }

            for (String manifestUrl : MANIFEST_URLS) {
                try {
                    JSONObject attempt = new JSONObject();
                    attempt.put("url", manifestUrl);
                    UpdateDiagnostics.record(getContext(), "check.manifest.try", "fetch manifest", attempt);

                    JSONObject manifest = fetchJson(manifestUrl);
                    long latestCode = manifest.optLong("versionCode", currentCode);
                    String latestName = manifest.optString("versionName", String.valueOf(latestCode));
                    String notes = manifest.optString("notes", "");
                    String sha256 = normalizeSha256(manifest.optString("sha256", ""));
                    List<ApkSource> sources = parseSources(manifest);
                    if (sources.isEmpty()) throw new IllegalStateException("更新清单缺少 APK 下载地址");
                    if (sha256.isEmpty()) throw new IllegalStateException("更新清单缺少 APK SHA-256");

                    UpdatePlan candidate = new UpdatePlan(latestCode, latestName, notes, sha256, manifestUrl, sources);
                    JSONObject data = new JSONObject();
                    data.put("manifestUrl", manifestUrl);
                    data.put("currentVersionCode", currentCode);
                    data.put("latestVersionCode", latestCode);
                    data.put("latestVersionName", latestName);
                    data.put("sha256Present", true);
                    data.put("sourceCount", sources.size());
                    data.put("selected", bestPlan == null || latestCode > bestPlan.versionCode);
                    UpdateDiagnostics.record(getContext(), "check.manifest.accepted", "valid update manifest", data);

                    if (bestPlan == null || latestCode > bestPlan.versionCode) {
                        bestPlan = candidate;
                    }
                } catch (Exception error) {
                    lastError = error;
                    JSONObject failure = new JSONObject();
                    try { failure.put("manifestUrl", manifestUrl); } catch (Exception ignored) {}
                    UpdateDiagnostics.recordException(getContext(), "check.manifest.failure", error, failure);
                }
            }

            if (bestPlan == null) {
                UpdateDiagnostics.recordException(getContext(), "check.failure", lastError);
                call.reject("检查更新失败：" + (lastError != null ? lastError.getMessage() : "网络不可用"));
                return;
            }

            lastPlan = bestPlan;
            JSONObject selected = new JSONObject();
            try {
                selected.put("manifestUrl", bestPlan.manifestUrl);
                selected.put("currentVersionCode", currentCode);
                selected.put("latestVersionCode", bestPlan.versionCode);
                selected.put("latestVersionName", bestPlan.versionName);
                selected.put("sourceCount", bestPlan.sources.size());
            } catch (Exception ignored) {}
            UpdateDiagnostics.record(getContext(), "check.success", "best update manifest selected", selected);

            JSObject result = new JSObject();
            result.put("available", bestPlan.versionCode > currentCode);
            result.put("currentVersionCode", currentCode);
            result.put("currentVersionName", current.versionName != null ? current.versionName : "0.0.0");
            result.put("versionCode", bestPlan.versionCode);
            result.put("versionName", bestPlan.versionName);
            result.put("apkUrl", bestPlan.sources.get(0).url);
            result.put("fallbackApkUrl", bestPlan.sources.size() > 1 ? bestPlan.sources.get(1).url : "");
            result.put("downloadSource", bestPlan.sources.get(0).name);
            result.put("sha256", bestPlan.sha256);
            result.put("notes", bestPlan.notes);
            result.put("manifestUrl", bestPlan.manifestUrl);
            call.resolve(result);
        }, "water-sort-update-check").start();
    }

    @PluginMethod
    public void installUpdate(PluginCall call) {
        String requestedUrl = call.getString("apkUrl");
        if (requestedUrl == null || requestedUrl.isEmpty()) {
            UpdateDiagnostics.record(getContext(), "install.reject", "missing apk url");
            call.reject("缺少 APK 下载地址。");
            return;
        }

        JSONObject requestData = new JSONObject();
        try {
            requestData.put("apkUrl", requestedUrl);
            requestData.put("sdkInt", Build.VERSION.SDK_INT);
            requestData.put("canRequestPackageInstalls", Build.VERSION.SDK_INT < Build.VERSION_CODES.O || getContext().getPackageManager().canRequestPackageInstalls());
        } catch (Exception ignored) {}
        UpdateDiagnostics.record(getContext(), "install.request", "user requested update installation", requestData);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !getContext().getPackageManager().canRequestPackageInstalls()) {
            Activity activity = getActivity();
            if (activity == null) {
                UpdateDiagnostics.record(getContext(), "install.permission.failure", "activity unavailable");
                call.reject("无法打开“允许安装未知应用”设置。");
                return;
            }
            Intent settingsIntent = new Intent(
                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:" + getContext().getPackageName())
            );
            activity.startActivity(settingsIntent);
            UpdateDiagnostics.record(getContext(), "install.permission.requested", "opened unknown-app install settings");
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
                        JSONObject sourceData = new JSONObject();
                        sourceData.put("name", source.name);
                        sourceData.put("url", source.url);
                        UpdateDiagnostics.record(getContext(), "download.start", "downloading apk", sourceData);

                        if (target.exists() && !target.delete()) throw new IllegalStateException("无法清理旧更新文件");
                        download(source.url, target);
                        if (target.length() < 500_000) throw new IllegalStateException("下载到的 APK 文件异常");

                        String actualSha256 = sha256File(target);
                        JSONObject verifyData = new JSONObject();
                        verifyData.put("bytes", target.length());
                        verifyData.put("expectedSha256", expectedSha256);
                        verifyData.put("actualSha256", actualSha256);
                        verifyData.put("verified", !expectedSha256.isEmpty() && actualSha256.equals(expectedSha256));
                        UpdateDiagnostics.record(getContext(), "download.sha256", "apk digest calculated", verifyData);
                        if (expectedSha256.isEmpty()) throw new IllegalStateException("更新清单缺少 APK SHA-256");
                        if (!actualSha256.equals(expectedSha256)) {
                            throw new IllegalStateException("APK SHA-256 校验失败");
                        }

                        JSONObject apkInfo = inspectDownloadedApk(target);
                        UpdateDiagnostics.record(getContext(), "apk.preflight", "downloaded apk parsed", apkInfo);
                        if (!getContext().getPackageName().equals(apkInfo.optString("packageName"))) {
                            throw new IllegalStateException("APK 包名与当前应用不一致");
                        }
                        if (apkInfo.has("signerMatches") && !apkInfo.optBoolean("signerMatches", false)) {
                            throw new IllegalStateException("APK 签名与当前安装版本不一致");
                        }

                        successfulSource = source;
                        UpdateDiagnostics.record(getContext(), "download.success", "apk download and preflight succeeded", sourceData);
                        break;
                    } catch (Exception error) {
                        lastDownloadError = error;
                        JSONObject failure = new JSONObject();
                        try {
                            failure.put("source", source.name);
                            failure.put("url", source.url);
                        } catch (Exception ignored) {}
                        UpdateDiagnostics.recordException(getContext(), "download.failure", error, failure);
                    }
                }

                if (successfulSource == null) {
                    JSONObject exhausted = new JSONObject();
                    try {
                        exhausted.put("attemptedSources", candidates.size());
                        exhausted.put("lastError", lastDownloadError != null ? lastDownloadError.getMessage() : "所有更新源均不可用");
                    } catch (Exception ignored) {}
                    UpdateDiagnostics.record(getContext(), "download.all_sources_failed", "all update sources failed", exhausted);
                    throw new IllegalStateException(lastDownloadError != null ? lastDownloadError.getMessage() : "所有更新源均不可用");
                }

                int sessionId = stageAndCommitInstall(target);
                String sourceName = successfulSource.name;
                // PackageInstaller owns its own staged copy after openWrite()/commit().
                //noinspection ResultOfMethodCallIgnored
                target.delete();

                JSONObject data = new JSONObject();
                data.put("sessionId", sessionId);
                data.put("source", sourceName);
                UpdateDiagnostics.record(getContext(), "install.commit.returned", "PackageInstaller session committed", data);

                JSObject result = new JSObject();
                result.put("started", true);
                result.put("needsPermission", false);
                result.put("source", sourceName);
                result.put("sessionId", sessionId);
                call.resolve(result);
            } catch (Exception error) {
                UpdateDiagnostics.recordException(getContext(), "update.prepare.failure", error);
                if (target != null) {
                    //noinspection ResultOfMethodCallIgnored
                    target.delete();
                }
                call.reject("准备更新安装失败：" + error.getMessage());
            }
        }, "water-sort-update-download").start();
    }

    private int stageAndCommitInstall(File apk) throws Exception {
        PackageInstaller installer = getContext().getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(
            PackageInstaller.SessionParams.MODE_FULL_INSTALL
        );
        params.setAppPackageName(getContext().getPackageName());
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_REQUIRED);
        }

        int sessionId = installer.createSession(params);
        JSONObject created = new JSONObject();
        created.put("sessionId", sessionId);
        created.put("apkBytes", apk.length());
        UpdateDiagnostics.record(getContext(), "session.created", "PackageInstaller session created", created);

        boolean committed = false;
        try (PackageInstaller.Session session = installer.openSession(sessionId)) {
            long written = 0;
            try (InputStream input = new BufferedInputStream(new FileInputStream(apk));
                 OutputStream output = session.openWrite("base.apk", 0, apk.length())) {
                byte[] buffer = new byte[64 * 1024];
                int read;
                while ((read = input.read(buffer)) >= 0) {
                    if (read > 0) {
                        output.write(buffer, 0, read);
                        written += read;
                    }
                }
                session.fsync(output);
            }
            JSONObject staged = new JSONObject();
            staged.put("sessionId", sessionId);
            staged.put("writtenBytes", written);
            UpdateDiagnostics.record(getContext(), "session.staged", "apk fully written into PackageInstaller", staged);

            Intent statusIntent = new Intent(getContext(), NativeInstallReceiver.class);
            statusIntent.setAction(NativeInstallReceiver.ACTION_INSTALL_STATUS);
            statusIntent.putExtra(NativeInstallReceiver.EXTRA_SESSION_ID, sessionId);
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) flags |= PendingIntent.FLAG_MUTABLE;
            PendingIntent pendingIntent = PendingIntent.getBroadcast(getContext(), sessionId, statusIntent, flags);
            IntentSender statusReceiver = pendingIntent.getIntentSender();
            UpdateDiagnostics.record(getContext(), "session.commit.start", "committing PackageInstaller session", staged);
            session.commit(statusReceiver);
            committed = true;
            UpdateDiagnostics.record(getContext(), "session.commit.called", "PackageInstaller commit returned", staged);
            return sessionId;
        } finally {
            if (!committed) {
                try {
                    installer.abandonSession(sessionId);
                    JSONObject abandoned = new JSONObject();
                    abandoned.put("sessionId", sessionId);
                    UpdateDiagnostics.record(getContext(), "session.abandoned", "uncommitted session abandoned", abandoned);
                } catch (Exception ignored) {
                    // Best effort cleanup only.
                }
            }
        }
    }

    private JSONObject inspectDownloadedApk(File apk) throws Exception {
        PackageManager pm = getContext().getPackageManager();
        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
        PackageInfo archive;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            archive = pm.getPackageArchiveInfo(apk.getAbsolutePath(), PackageManager.PackageInfoFlags.of(flags));
        } else {
            //noinspection deprecation
            archive = pm.getPackageArchiveInfo(apk.getAbsolutePath(), flags);
        }
        if (archive == null) throw new IllegalStateException("Android 无法解析下载的 APK");

        PackageInfo installed = getPackageInfo(flags);
        JSONArray archiveSigners = signerDigests(archive);
        JSONArray installedSigners = signerDigests(installed);

        JSONObject data = new JSONObject();
        data.put("packageName", archive.packageName == null ? "" : archive.packageName);
        data.put("versionName", archive.versionName == null ? "" : archive.versionName);
        data.put("versionCode", getVersionCode(archive));
        data.put("archiveSignersSha256", archiveSigners);
        data.put("installedSignersSha256", installedSigners);
        if (archiveSigners.length() > 0 && installedSigners.length() > 0) {
            data.put("signerMatches", archiveSigners.optString(0).equals(installedSigners.optString(0)));
        }
        return data;
    }

    private JSONArray signerDigests(PackageInfo info) throws Exception {
        JSONArray result = new JSONArray();
        Signature[] signatures = null;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && info.signingInfo != null) {
            signatures = info.signingInfo.hasMultipleSigners()
                ? info.signingInfo.getApkContentsSigners()
                : info.signingInfo.getSigningCertificateHistory();
        } else {
            //noinspection deprecation
            signatures = info.signatures;
        }
        if (signatures == null) return result;
        for (Signature signature : signatures) {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            result.put(hex(digest.digest(signature.toByteArray())));
        }
        return result;
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

    private PackageInfo getPackageInfo(int flags) throws PackageManager.NameNotFoundException {
        PackageManager packageManager = getContext().getPackageManager();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return packageManager.getPackageInfo(
                getContext().getPackageName(),
                PackageManager.PackageInfoFlags.of(flags)
            );
        }
        //noinspection deprecation
        return packageManager.getPackageInfo(getContext().getPackageName(), flags);
    }

    private long getVersionCode(PackageInfo info) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) return info.getLongVersionCode();
        //noinspection deprecation
        return info.versionCode;
    }

    private JSONObject fetchJson(String sourceUrl) throws Exception {
        long started = System.currentTimeMillis();
        HttpURLConnection connection = open(sourceUrl);
        try {
            int status = connection.getResponseCode();
            JSONObject network = new JSONObject();
            network.put("requestedUrl", sourceUrl);
            network.put("finalUrl", connection.getURL().toString());
            network.put("httpStatus", status);
            network.put("contentType", connection.getContentType());
            network.put("elapsedMs", System.currentTimeMillis() - started);
            UpdateDiagnostics.record(getContext(), "network.manifest.response", "manifest HTTP response", network);
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
        long started = System.currentTimeMillis();
        HttpURLConnection connection = open(sourceUrl);
        try {
            int status = connection.getResponseCode();
            JSONObject network = new JSONObject();
            network.put("requestedUrl", sourceUrl);
            network.put("finalUrl", connection.getURL().toString());
            network.put("httpStatus", status);
            network.put("contentType", connection.getContentType());
            network.put("contentLength", connection.getContentLengthLong());
            network.put("elapsedToHeadersMs", System.currentTimeMillis() - started);
            UpdateDiagnostics.record(getContext(), "network.apk.response", "apk HTTP response", network);
            if (status < 200 || status >= 300) throw new IllegalStateException("HTTP " + status);
            long bytes = 0;
            try (InputStream input = new BufferedInputStream(connection.getInputStream());
                 BufferedOutputStream output = new BufferedOutputStream(new FileOutputStream(target))) {
                byte[] buffer = new byte[64 * 1024];
                int read;
                while ((read = input.read(buffer)) >= 0) {
                    if (read > 0) {
                        output.write(buffer, 0, read);
                        bytes += read;
                    }
                }
                output.flush();
            }
            JSONObject completed = new JSONObject();
            completed.put("bytes", bytes);
            completed.put("elapsedMs", System.currentTimeMillis() - started);
            UpdateDiagnostics.record(getContext(), "network.apk.complete", "apk HTTP download complete", completed);
        } finally {
            connection.disconnect();
        }
    }

    private String sha256File(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream input = new BufferedInputStream(new FileInputStream(file))) {
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = input.read(buffer)) >= 0) {
                if (read > 0) digest.update(buffer, 0, read);
            }
        }
        return hex(digest.digest());
    }

    private String hex(byte[] bytes) {
        StringBuilder actual = new StringBuilder();
        for (byte value : bytes) actual.append(String.format("%02x", value & 0xff));
        return actual.toString();
    }

    private String normalizeSha256(String value) {
        return value == null ? "" : value.replace(":", "").trim().toLowerCase();
    }

    private HttpURLConnection open(String sourceUrl) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(sourceUrl).openConnection();
        connection.setConnectTimeout(8_000);
        connection.setReadTimeout(60_000);
        connection.setInstanceFollowRedirects(true);
        connection.setRequestProperty("User-Agent", "WaterSortSolver-Android/0.9");
        connection.setRequestProperty("Accept", "application/json, application/vnd.android.package-archive, */*");
        return connection;
    }
}
