package com.octoteo.watersortsolver;

import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.os.Build;
import android.widget.Toast;

import org.json.JSONObject;

public class NativeInstallReceiver extends BroadcastReceiver {
    static final String ACTION_INSTALL_STATUS = "com.octoteo.watersortsolver.INSTALL_STATUS";
    static final String EXTRA_SESSION_ID = "sessionId";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !ACTION_INSTALL_STATUS.equals(intent.getAction())) return;

        int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        int sessionId = intent.getIntExtra(EXTRA_SESSION_ID, -1);
        String message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
        String otherPackage = intent.getStringExtra(PackageInstaller.EXTRA_OTHER_PACKAGE_NAME);

        JSONObject callback = new JSONObject();
        try {
            callback.put("status", status);
            callback.put("sessionId", sessionId);
            callback.put("statusMessage", message == null ? "" : message);
            callback.put("otherPackageName", otherPackage == null ? "" : otherPackage);
        } catch (Exception ignored) {}
        UpdateDiagnostics.record(context, "receiver.status", "PackageInstaller callback received", callback);

        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            Intent confirmation;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                confirmation = intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent.class);
            } else {
                //noinspection deprecation
                confirmation = intent.getParcelableExtra(Intent.EXTRA_INTENT);
            }
            if (confirmation == null) {
                UpdateDiagnostics.record(context, "receiver.pending.no_intent", "system returned pending user action without confirmation intent", callback);
                Toast.makeText(context, "系统安装确认页面不可用。请打开“更新诊断”复制报告。", Toast.LENGTH_LONG).show();
                return;
            }

            JSONObject confirmationData = new JSONObject();
            try {
                confirmationData.put("action", confirmation.getAction());
                confirmationData.put("package", confirmation.getPackage());
                ComponentName component = confirmation.getComponent();
                confirmationData.put("component", component == null ? "" : component.flattenToShortString());
                confirmationData.put("data", confirmation.getDataString() == null ? "" : confirmation.getDataString());
                confirmationData.put("flagsBefore", confirmation.getFlags());
            } catch (Exception ignored) {}
            UpdateDiagnostics.record(context, "receiver.pending.intent", "system provided install confirmation intent", confirmationData);

            confirmation.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try {
                UpdateDiagnostics.record(context, "receiver.confirmation.launch.start", "starting system install confirmation activity", confirmationData);
                context.startActivity(confirmation);
                UpdateDiagnostics.record(context, "receiver.confirmation.launch.returned", "startActivity returned without exception", confirmationData);
            } catch (Exception error) {
                UpdateDiagnostics.recordException(context, "receiver.confirmation.launch.failure", error);
                Toast.makeText(context, "无法打开系统安装确认。请打开“更新诊断”复制报告。", Toast.LENGTH_LONG).show();
            }
            return;
        }

        if (status == PackageInstaller.STATUS_SUCCESS) {
            UpdateDiagnostics.record(context, "receiver.install.success", "PackageInstaller reported install success", callback);
            Toast.makeText(context, "Water Sort Solver 更新安装完成。", Toast.LENGTH_SHORT).show();
            return;
        }

        UpdateDiagnostics.record(context, "receiver.install.failure", "PackageInstaller reported install failure", callback);
        String detail = message == null || message.trim().isEmpty() ? "状态码 " + status : message;
        Toast.makeText(context, "更新安装失败：" + detail + "。请打开“更新诊断”复制报告。", Toast.LENGTH_LONG).show();
    }
}
