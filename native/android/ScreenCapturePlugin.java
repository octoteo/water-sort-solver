package com.octoteo.watersortsolver;

import static android.app.Activity.RESULT_OK;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.graphics.Rect;
import android.media.projection.MediaProjectionManager;
import android.view.View;

import androidx.activity.result.ActivityResult;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;

@CapacitorPlugin(name = "ScreenCapture")
public class ScreenCapturePlugin extends Plugin {
    private static volatile ScreenCapturePlugin activePlugin;
    private Rect pendingAppBounds;

    @Override
    public void load() {
        activePlugin = this;
    }

    @PluginMethod
    public void captureOtherPane(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("当前 Activity 不可用，请重新打开应用后再试。");
            return;
        }

        View decor = activity.getWindow().getDecorView();
        int[] location = new int[2];
        decor.getLocationOnScreen(location);
        pendingAppBounds = new Rect(
            location[0],
            location[1],
            location[0] + Math.max(1, decor.getWidth()),
            location[1] + Math.max(1, decor.getHeight())
        );

        MediaProjectionManager manager = (MediaProjectionManager) activity.getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        if (manager == null) {
            call.reject("当前 Android 系统不支持屏幕捕获。");
            return;
        }

        // Android 14+ intentionally requires fresh user consent for every
        // MediaProjection capture session. Do not cache or reuse this Intent.
        Intent permissionIntent = manager.createScreenCaptureIntent();
        startActivityForResult(call, permissionIntent, "capturePermissionResult");
    }

    @ActivityCallback
    private void capturePermissionResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != RESULT_OK || result.getData() == null) {
            call.reject("已取消分屏截图授权。");
            return;
        }

        Rect bounds = pendingAppBounds;
        if (bounds == null) {
            call.reject("无法确定当前分屏位置，请重新进入分屏后再试。");
            return;
        }

        getBridge().saveCall(call);
        Intent serviceIntent = new Intent(getContext(), ScreenCaptureService.class);
        serviceIntent.putExtra(ScreenCaptureService.EXTRA_RESULT_CODE, result.getResultCode());
        serviceIntent.putExtra(ScreenCaptureService.EXTRA_RESULT_DATA, result.getData());
        serviceIntent.putExtra(ScreenCaptureService.EXTRA_APP_LEFT, bounds.left);
        serviceIntent.putExtra(ScreenCaptureService.EXTRA_APP_TOP, bounds.top);
        serviceIntent.putExtra(ScreenCaptureService.EXTRA_APP_RIGHT, bounds.right);
        serviceIntent.putExtra(ScreenCaptureService.EXTRA_APP_BOTTOM, bounds.bottom);
        serviceIntent.putExtra(ScreenCaptureService.EXTRA_CALLBACK_ID, call.getCallbackId());

        try {
            ContextCompat.startForegroundService(getContext(), serviceIntent);
        } catch (Exception error) {
            getBridge().releaseCall(call);
            call.reject("无法启动分屏截图服务：" + error.getMessage());
        }
    }

    static void completeCapture(String callbackId, File file, int width, int height, Rect cropRect) {
        ScreenCapturePlugin plugin = activePlugin;
        if (plugin == null || callbackId == null) return;
        PluginCall call = plugin.getBridge().getSavedCall(callbackId);
        if (call == null) return;

        JSObject result = new JSObject();
        result.put("uri", android.net.Uri.fromFile(file).toString());
        result.put("mimeType", "image/jpeg");
        result.put("name", file.getName());
        result.put("width", width);
        result.put("height", height);
        result.put("cropLeft", cropRect.left);
        result.put("cropTop", cropRect.top);
        result.put("cropRight", cropRect.right);
        result.put("cropBottom", cropRect.bottom);
        plugin.getBridge().releaseCall(call);
        call.resolve(result);
    }

    static void failCapture(String callbackId, String message) {
        ScreenCapturePlugin plugin = activePlugin;
        if (plugin == null || callbackId == null) return;
        PluginCall call = plugin.getBridge().getSavedCall(callbackId);
        if (call == null) return;
        plugin.getBridge().releaseCall(call);
        call.reject(message);
    }
}
