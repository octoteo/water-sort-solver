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

    @Override
    public void load() {
        activePlugin = this;
    }

    @PluginMethod
    public void getCaptureSessionStatus(PluginCall call) {
        Activity activity = getActivity();
        JSObject result = new JSObject();
        result.put("active", ScreenCaptureService.isSessionActive());
        result.put("inMultiWindow", activity != null && activity.isInMultiWindowMode());
        call.resolve(result);
    }

    @PluginMethod
    public void startCaptureSession(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("当前 Activity 不可用，请重新打开应用后再试。");
            return;
        }

        if (ScreenCaptureService.isSessionActive()) {
            JSObject result = new JSObject();
            result.put("active", true);
            result.put("inMultiWindow", activity.isInMultiWindowMode());
            call.resolve(result);
            return;
        }

        MediaProjectionManager manager = (MediaProjectionManager) activity.getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        if (manager == null) {
            call.reject("当前 Android 系统不支持屏幕捕获。");
            return;
        }

        Intent permissionIntent = manager.createScreenCaptureIntent();
        startActivityForResult(call, permissionIntent, "captureSessionPermissionResult");
    }

    @ActivityCallback
    private void captureSessionPermissionResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != RESULT_OK || result.getData() == null) {
            call.reject("已取消分屏截图授权。");
            return;
        }

        getBridge().saveCall(call);
        Intent serviceIntent = new Intent(getContext(), ScreenCaptureService.class);
        serviceIntent.setAction(ScreenCaptureService.ACTION_START_SESSION);
        serviceIntent.putExtra(ScreenCaptureService.EXTRA_RESULT_CODE, result.getResultCode());
        serviceIntent.putExtra(ScreenCaptureService.EXTRA_RESULT_DATA, result.getData());
        serviceIntent.putExtra(ScreenCaptureService.EXTRA_CALLBACK_ID, call.getCallbackId());

        try {
            ContextCompat.startForegroundService(getContext(), serviceIntent);
        } catch (Exception error) {
            getBridge().releaseCall(call);
            call.reject("无法启动连续分屏截图服务：" + error.getMessage());
        }
    }

    @PluginMethod
    public void captureOtherPane(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("当前 Activity 不可用，请重新打开应用后再试。");
            return;
        }
        if (!ScreenCaptureService.isSessionActive()) {
            call.reject("连续分屏截图会话尚未开启，请先点“开始分屏求解”。");
            return;
        }

        Rect bounds = getActivityBounds(activity);
        getBridge().saveCall(call);
        boolean queued = ScreenCaptureService.requestCapture(call.getCallbackId(), bounds);
        if (!queued) {
            getBridge().releaseCall(call);
            call.reject("连续截图会话已结束，请重新开启。");
        }
    }

    @PluginMethod
    public void stopCaptureSession(PluginCall call) {
        ScreenCaptureService.stopSession();
        JSObject result = new JSObject();
        result.put("active", false);
        call.resolve(result);
    }

    private Rect getActivityBounds(Activity activity) {
        View decor = activity.getWindow().getDecorView();
        int[] location = new int[2];
        decor.getLocationOnScreen(location);
        return new Rect(
            location[0],
            location[1],
            location[0] + Math.max(1, decor.getWidth()),
            location[1] + Math.max(1, decor.getHeight())
        );
    }

    static void completeSessionStart(String callbackId) {
        ScreenCapturePlugin plugin = activePlugin;
        if (plugin == null || callbackId == null) return;
        PluginCall call = plugin.getBridge().getSavedCall(callbackId);
        if (call == null) return;
        Activity activity = plugin.getActivity();
        JSObject result = new JSObject();
        result.put("active", true);
        result.put("inMultiWindow", activity != null && activity.isInMultiWindowMode());
        plugin.getBridge().releaseCall(call);
        call.resolve(result);
        notifySessionState(true, "连续分屏截图已开启");
    }

    static void failSessionStart(String callbackId, String message) {
        ScreenCapturePlugin plugin = activePlugin;
        if (plugin != null && callbackId != null) {
            PluginCall call = plugin.getBridge().getSavedCall(callbackId);
            if (call != null) {
                plugin.getBridge().releaseCall(call);
                call.reject(message);
            }
        }
        notifySessionState(false, message);
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

    static void notifySessionState(boolean active, String reason) {
        ScreenCapturePlugin plugin = activePlugin;
        if (plugin == null) return;
        JSObject payload = new JSObject();
        payload.put("active", active);
        payload.put("reason", reason == null ? "" : reason);
        plugin.notifyListeners("captureSessionChanged", payload);
    }
}
