package com.octoteo.watersortsolver;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.InstallSourceInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.List;
import java.util.Locale;

final class UpdateDiagnostics {
    private static final String PREFS = "water_sort_update_diagnostics";
    private static final String KEY_EVENTS = "events";
    private static final String KEY_LAST_STAGE = "last_stage";
    private static final int MAX_EVENTS = 120;

    private UpdateDiagnostics() {}

    static synchronized void record(Context context, String stage, String message) {
        record(context, stage, message, null);
    }

    static synchronized void record(Context context, String stage, String message, JSONObject data) {
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            JSONArray previous;
            try {
                previous = new JSONArray(prefs.getString(KEY_EVENTS, "[]"));
            } catch (Exception ignored) {
                previous = new JSONArray();
            }

            JSONObject event = new JSONObject();
            event.put("time", timestamp());
            event.put("stage", stage);
            event.put("message", message == null ? "" : message);
            if (data != null) event.put("data", data);

            JSONArray next = new JSONArray();
            int keepFrom = Math.max(0, previous.length() - (MAX_EVENTS - 1));
            for (int index = keepFrom; index < previous.length(); index++) next.put(previous.get(index));
            next.put(event);

            prefs.edit()
                .putString(KEY_EVENTS, next.toString())
                .putString(KEY_LAST_STAGE, stage)
                .apply();
        } catch (Exception ignored) {
            // Diagnostics must never break the update flow.
        }
    }

    static synchronized void recordException(Context context, String stage, Throwable error) {
        recordException(context, stage, error, null);
    }

    static synchronized void recordException(Context context, String stage, Throwable error, JSONObject extra) {
        JSONObject data = extra == null ? new JSONObject() : extra;
        try {
            data.put("exception", error == null ? "unknown" : error.getClass().getName());
            data.put("detail", error == null || error.getMessage() == null ? "" : error.getMessage());
        } catch (Exception ignored) {}
        record(context, stage, error == null ? "unknown error" : String.valueOf(error.getMessage()), data);
    }

    static synchronized void clear(Context context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply();
        record(context, "diagnostics.cleared", "diagnostic history cleared");
    }

    static synchronized String buildReport(Context context) {
        try {
            JSONObject report = new JSONObject();
            report.put("schemaVersion", 1);
            report.put("generatedAt", timestamp());
            report.put("app", appInfo(context));
            report.put("device", deviceInfo());
            report.put("permissions", permissionInfo(context));
            report.put("packageInstaller", installerInfo(context));

            SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            report.put("lastStage", prefs.getString(KEY_LAST_STAGE, ""));
            try {
                report.put("events", new JSONArray(prefs.getString(KEY_EVENTS, "[]")));
            } catch (Exception ignored) {
                report.put("events", new JSONArray());
            }
            return report.toString(2);
        } catch (Exception error) {
            return "{\"diagnosticsError\":\"" + sanitize(error.getMessage()) + "\"}";
        }
    }

    private static JSONObject appInfo(Context context) throws Exception {
        PackageManager pm = context.getPackageManager();
        PackageInfo info;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            info = pm.getPackageInfo(context.getPackageName(), PackageManager.PackageInfoFlags.of(0));
        } else {
            //noinspection deprecation
            info = pm.getPackageInfo(context.getPackageName(), 0);
        }

        JSONObject app = new JSONObject();
        app.put("packageName", context.getPackageName());
        app.put("versionName", info.versionName == null ? "" : info.versionName);
        app.put("versionCode", Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? info.getLongVersionCode() : info.versionCode);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            try {
                InstallSourceInfo source = pm.getInstallSourceInfo(context.getPackageName());
                app.put("installingPackageName", source.getInstallingPackageName());
                app.put("initiatingPackageName", source.getInitiatingPackageName());
                app.put("originatingPackageName", source.getOriginatingPackageName());
            } catch (Exception error) {
                app.put("installSourceError", error.getClass().getSimpleName() + ": " + String.valueOf(error.getMessage()));
            }
        } else {
            //noinspection deprecation
            app.put("installingPackageName", pm.getInstallerPackageName(context.getPackageName()));
        }
        return app;
    }

    private static JSONObject deviceInfo() throws Exception {
        JSONObject device = new JSONObject();
        device.put("manufacturer", Build.MANUFACTURER);
        device.put("brand", Build.BRAND);
        device.put("model", Build.MODEL);
        device.put("device", Build.DEVICE);
        device.put("product", Build.PRODUCT);
        device.put("androidRelease", Build.VERSION.RELEASE);
        device.put("sdkInt", Build.VERSION.SDK_INT);
        device.put("securityPatch", Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? Build.VERSION.SECURITY_PATCH : "");
        device.put("display", Build.DISPLAY);
        device.put("fingerprint", Build.FINGERPRINT);
        device.put("supportedAbis", new JSONArray(Build.SUPPORTED_ABIS));
        device.put("miuiVersion", getProp("ro.miui.ui.version.name"));
        device.put("hyperOsVersion", getProp("ro.mi.os.version.name"));
        device.put("hyperOsIncremental", getProp("ro.mi.os.version.incremental"));
        device.put("buildIncremental", getProp("ro.build.version.incremental"));
        return device;
    }

    private static JSONObject permissionInfo(Context context) throws Exception {
        JSONObject permissions = new JSONObject();
        permissions.put("canRequestPackageInstalls", Build.VERSION.SDK_INT < Build.VERSION_CODES.O || context.getPackageManager().canRequestPackageInstalls());
        return permissions;
    }

    private static JSONObject installerInfo(Context context) throws Exception {
        JSONObject installer = new JSONObject();
        JSONArray sessions = new JSONArray();
        try {
            PackageInstaller packageInstaller = context.getPackageManager().getPackageInstaller();
            List<PackageInstaller.SessionInfo> mySessions = packageInstaller.getMySessions();
            for (PackageInstaller.SessionInfo session : mySessions) {
                JSONObject item = new JSONObject();
                item.put("sessionId", session.getSessionId());
                item.put("appPackageName", session.getAppPackageName());
                item.put("progress", session.getProgress());
                item.put("active", session.isActive());
                item.put("createdMillis", session.getCreatedMillis());
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) item.put("installReason", session.getInstallReason());
                sessions.put(item);
            }
        } catch (Exception error) {
            installer.put("sessionReadError", error.getClass().getSimpleName() + ": " + String.valueOf(error.getMessage()));
        }
        installer.put("mySessions", sessions);
        return installer;
    }

    private static String getProp(String name) {
        Process process = null;
        try {
            process = new ProcessBuilder("/system/bin/getprop", name).redirectErrorStream(true).start();
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream()))) {
                String line = reader.readLine();
                return line == null ? "" : line.trim();
            }
        } catch (Exception ignored) {
            return "";
        } finally {
            if (process != null) process.destroy();
        }
    }

    private static String timestamp() {
        return new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSXXX", Locale.US).format(new Date());
    }

    private static String sanitize(String value) {
        if (value == null) return "";
        return value.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", " ").replace("\r", " ");
    }
}
