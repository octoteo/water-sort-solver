package com.octoteo.watersortsolver;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.os.Build;
import android.widget.Toast;

public class NativeInstallReceiver extends BroadcastReceiver {
    static final String ACTION_INSTALL_STATUS = "com.octoteo.watersortsolver.INSTALL_STATUS";
    static final String EXTRA_SESSION_ID = "sessionId";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !ACTION_INSTALL_STATUS.equals(intent.getAction())) return;

        int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        String message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);

        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            Intent confirmation;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                confirmation = intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent.class);
            } else {
                //noinspection deprecation
                confirmation = intent.getParcelableExtra(Intent.EXTRA_INTENT);
            }
            if (confirmation == null) {
                Toast.makeText(context, "系统安装确认页面不可用，请重试更新。", Toast.LENGTH_LONG).show();
                return;
            }
            confirmation.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try {
                context.startActivity(confirmation);
            } catch (Exception error) {
                Toast.makeText(context, "无法打开系统安装确认：" + error.getMessage(), Toast.LENGTH_LONG).show();
            }
            return;
        }

        if (status == PackageInstaller.STATUS_SUCCESS) {
            Toast.makeText(context, "Water Sort Solver 更新安装完成。", Toast.LENGTH_SHORT).show();
            return;
        }

        String detail = message == null || message.isBlank() ? "状态码 " + status : message;
        Toast.makeText(context, "更新安装失败：" + detail, Toast.LENGTH_LONG).show();
    }
}
