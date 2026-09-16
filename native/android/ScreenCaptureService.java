package com.octoteo.watersortsolver;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.Looper;
import android.util.DisplayMetrics;
import android.view.WindowManager;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.ByteBuffer;

public class ScreenCaptureService extends Service {
    static final String ACTION_START_SESSION = "com.octoteo.watersortsolver.START_CAPTURE_SESSION";
    static final String EXTRA_RESULT_CODE = "resultCode";
    static final String EXTRA_RESULT_DATA = "resultData";
    static final String EXTRA_CALLBACK_ID = "callbackId";

    private static final String CHANNEL_ID = "water-sort-screen-capture";
    private static final int NOTIFICATION_ID = 7021;
    private static volatile ScreenCaptureService activeService;

    private MediaProjection projection;
    private VirtualDisplay virtualDisplay;
    private ImageReader imageReader;
    private HandlerThread captureThread;
    private Handler captureHandler;
    private int screenWidth;
    private int screenHeight;
    private boolean destroying;
    private String pendingCaptureCallbackId;
    private Rect pendingAppBounds;

    @Override
    public void onCreate() {
        super.onCreate();
        activeService = this;
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    static boolean isSessionActive() {
        ScreenCaptureService service = activeService;
        return service != null && service.projection != null && service.virtualDisplay != null && service.captureHandler != null && !service.destroying;
    }

    static boolean requestCapture(String callbackId, Rect appBounds) {
        ScreenCaptureService service = activeService;
        if (service == null || callbackId == null || appBounds == null || !isSessionActive()) return false;
        Handler handler = service.captureHandler;
        if (handler == null) return false;
        handler.post(() -> service.queueCapture(callbackId, new Rect(appBounds)));
        return true;
    }

    static void stopSession() {
        ScreenCaptureService service = activeService;
        if (service == null) return;
        Handler handler = service.captureHandler;
        if (handler != null) handler.post(() -> service.finishSession("用户已结束连续分屏截图", true));
        else service.stopSelf();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || !ACTION_START_SESSION.equals(intent.getAction())) {
            stopSelf();
            return START_NOT_STICKY;
        }

        String startCallbackId = intent.getStringExtra(EXTRA_CALLBACK_ID);
        if (isSessionActive()) {
            ScreenCapturePlugin.completeSessionStart(startCallbackId);
            return START_NOT_STICKY;
        }

        createChannel();
        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_camera)
            .setContentTitle("Water Sort 连续分屏求解")
            .setContentText("截图会话已开启；游戏画面仅在本机处理")
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }

        int resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, 0);
        Intent resultData;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            resultData = intent.getParcelableExtra(EXTRA_RESULT_DATA, Intent.class);
        } else {
            //noinspection deprecation
            resultData = intent.getParcelableExtra(EXTRA_RESULT_DATA);
        }
        if (resultData == null) {
            failStart(startCallbackId, "没有收到 Android 截屏授权数据，请重试。");
            return START_NOT_STICKY;
        }

        try {
            startProjection(resultCode, resultData);
            ScreenCapturePlugin.completeSessionStart(startCallbackId);
        } catch (Exception error) {
            failStart(startCallbackId, "连续分屏截图启动失败：" + error.getMessage());
        }
        return START_NOT_STICKY;
    }

    private void startProjection(int resultCode, Intent resultData) {
        WindowManager windowManager = (WindowManager) getSystemService(Context.WINDOW_SERVICE);
        if (windowManager == null) throw new IllegalStateException("WindowManager unavailable");

        int densityDpi;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            Rect bounds = windowManager.getMaximumWindowMetrics().getBounds();
            screenWidth = bounds.width();
            screenHeight = bounds.height();
            densityDpi = getResources().getDisplayMetrics().densityDpi;
        } else {
            DisplayMetrics metrics = new DisplayMetrics();
            //noinspection deprecation
            windowManager.getDefaultDisplay().getRealMetrics(metrics);
            screenWidth = metrics.widthPixels;
            screenHeight = metrics.heightPixels;
            densityDpi = metrics.densityDpi;
        }

        MediaProjectionManager manager = (MediaProjectionManager) getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        if (manager == null) throw new IllegalStateException("MediaProjectionManager unavailable");
        projection = manager.getMediaProjection(resultCode, resultData);
        if (projection == null) throw new IllegalStateException("MediaProjection unavailable");

        captureThread = new HandlerThread("water-sort-continuous-capture");
        captureThread.start();
        captureHandler = new Handler(captureThread.getLooper());

        projection.registerCallback(new MediaProjection.Callback() {
            @Override
            public void onStop() {
                if (!destroying) finishSession("系统已结束本次截屏授权", false);
            }
        }, captureHandler);

        imageReader = ImageReader.newInstance(screenWidth, screenHeight, PixelFormat.RGBA_8888, 2);
        imageReader.setOnImageAvailableListener(reader -> {
            Image image = null;
            try {
                image = reader.acquireLatestImage();
                if (image == null) return;
                String callbackId = pendingCaptureCallbackId;
                Rect appBounds = pendingAppBounds;
                if (callbackId == null || appBounds == null) return;
                pendingCaptureCallbackId = null;
                pendingAppBounds = null;
                captureImage(image, callbackId, appBounds);
            } catch (Exception error) {
                String callbackId = pendingCaptureCallbackId;
                pendingCaptureCallbackId = null;
                pendingAppBounds = null;
                if (callbackId != null) failCapture(callbackId, "读取分屏画面失败：" + error.getMessage());
            } finally {
                if (image != null) image.close();
            }
        }, captureHandler);

        virtualDisplay = projection.createVirtualDisplay(
            "WaterSortContinuousCapture",
            screenWidth,
            screenHeight,
            densityDpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            imageReader.getSurface(),
            null,
            captureHandler
        );
    }

    private void queueCapture(String callbackId, Rect appBounds) {
        if (!isSessionActive()) {
            failCapture(callbackId, "连续截图会话已结束，请重新开启。");
            return;
        }
        if (pendingCaptureCallbackId != null) {
            failCapture(callbackId, "上一张分屏截图仍在处理中，请稍后再试。");
            return;
        }
        Rect crop = computeOtherPane(appBounds, screenWidth, screenHeight);
        if (crop == null || crop.width() < 120 || crop.height() < 180) {
            failCapture(callbackId, "没有检测到有效分屏。请先让 Water Sort 与淘特处于上下或左右分屏，再点“连续截图”。");
            return;
        }
        pendingCaptureCallbackId = callbackId;
        pendingAppBounds = appBounds;
        captureHandler.postDelayed(() -> {
            if (!callbackId.equals(pendingCaptureCallbackId)) return;
            pendingCaptureCallbackId = null;
            pendingAppBounds = null;
            failCapture(callbackId, "等待屏幕画面超时，请确认授权的是“整个屏幕”后重试。");
        }, 3000L);
    }

    private void captureImage(Image image, String callbackId, Rect appBounds) throws Exception {
        Rect crop = computeOtherPane(appBounds, screenWidth, screenHeight);
        if (crop == null || crop.width() < 120 || crop.height() < 180) {
            failCapture(callbackId, "当前已经不在有效分屏状态，请重新进入分屏。");
            return;
        }

        Bitmap full = imageToBitmap(image, screenWidth, screenHeight);
        Bitmap cropped = Bitmap.createBitmap(full, crop.left, crop.top, crop.width(), crop.height());
        full.recycle();

        File dir = new File(getCacheDir(), "split-captures");
        if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("无法创建截图缓存目录");
        purgeOldCaptures(dir);
        File target = new File(dir, "split-" + System.currentTimeMillis() + ".jpg");
        try (FileOutputStream output = new FileOutputStream(target)) {
            if (!cropped.compress(Bitmap.CompressFormat.JPEG, 95, output)) {
                throw new IllegalStateException("截图压缩失败");
            }
            output.flush();
        }
        int resultWidth = cropped.getWidth();
        int resultHeight = cropped.getHeight();
        cropped.recycle();

        Handler main = new Handler(Looper.getMainLooper());
        main.post(() -> ScreenCapturePlugin.completeCapture(callbackId, target, resultWidth, resultHeight, crop));
    }

    private Rect computeOtherPane(Rect appBounds, int fullWidth, int fullHeight) {
        Rect app = new Rect(
            Math.max(0, Math.min(fullWidth, appBounds.left)),
            Math.max(0, Math.min(fullHeight, appBounds.top)),
            Math.max(0, Math.min(fullWidth, appBounds.right)),
            Math.max(0, Math.min(fullHeight, appBounds.bottom))
        );
        int gap = Math.max(6, Math.round(getResources().getDisplayMetrics().density * 6));

        boolean horizontalDivider = app.width() >= fullWidth * 0.65f && app.height() < fullHeight * 0.86f;
        if (horizontalDivider) {
            if (app.centerY() <= fullHeight / 2) {
                int top = Math.min(fullHeight, app.bottom + gap);
                return new Rect(0, top, fullWidth, fullHeight);
            }
            int bottom = Math.max(0, app.top - gap);
            return new Rect(0, 0, fullWidth, bottom);
        }

        boolean verticalDivider = app.height() >= fullHeight * 0.65f && app.width() < fullWidth * 0.86f;
        if (verticalDivider) {
            if (app.centerX() <= fullWidth / 2) {
                int left = Math.min(fullWidth, app.right + gap);
                return new Rect(left, 0, fullWidth, fullHeight);
            }
            int right = Math.max(0, app.left - gap);
            return new Rect(0, 0, right, fullHeight);
        }
        return null;
    }

    private Bitmap imageToBitmap(Image image, int expectedWidth, int expectedHeight) {
        Image.Plane plane = image.getPlanes()[0];
        ByteBuffer buffer = plane.getBuffer();
        int pixelStride = plane.getPixelStride();
        int rowStride = plane.getRowStride();
        int rowPadding = rowStride - pixelStride * expectedWidth;
        int bitmapWidth = expectedWidth + rowPadding / pixelStride;
        Bitmap padded = Bitmap.createBitmap(bitmapWidth, expectedHeight, Bitmap.Config.ARGB_8888);
        padded.copyPixelsFromBuffer(buffer);
        Bitmap exact = Bitmap.createBitmap(padded, 0, 0, expectedWidth, expectedHeight);
        if (exact != padded) padded.recycle();
        return exact;
    }

    private void purgeOldCaptures(File dir) {
        File[] files = dir.listFiles();
        if (files == null) return;
        long cutoff = System.currentTimeMillis() - 60L * 60L * 1000L;
        for (File file : files) {
            if (file.lastModified() < cutoff) {
                //noinspection ResultOfMethodCallIgnored
                file.delete();
            }
        }
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "连续分屏截图", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("用户授权后，在本次求解会话中连续读取另一侧游戏画面");
        manager.createNotificationChannel(channel);
    }

    private void failStart(String callbackId, String message) {
        Handler main = new Handler(Looper.getMainLooper());
        main.post(() -> ScreenCapturePlugin.failSessionStart(callbackId, message));
        finishSession(message, true);
    }

    private void failCapture(String callbackId, String message) {
        Handler main = new Handler(Looper.getMainLooper());
        main.post(() -> ScreenCapturePlugin.failCapture(callbackId, message));
    }

    private synchronized void finishSession(String reason, boolean stopProjection) {
        if (destroying) return;
        destroying = true;
        String pending = pendingCaptureCallbackId;
        pendingCaptureCallbackId = null;
        pendingAppBounds = null;
        if (pending != null) failCapture(pending, reason);

        try {
            if (virtualDisplay != null) virtualDisplay.release();
        } catch (Exception ignored) {}
        virtualDisplay = null;
        try {
            if (imageReader != null) imageReader.close();
        } catch (Exception ignored) {}
        imageReader = null;
        if (stopProjection) {
            try {
                if (projection != null) projection.stop();
            } catch (Exception ignored) {}
        }
        projection = null;
        if (captureThread != null) {
            captureThread.quitSafely();
            captureThread = null;
            captureHandler = null;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) stopForeground(STOP_FOREGROUND_REMOVE);
        else {
            //noinspection deprecation
            stopForeground(true);
        }
        activeService = null;
        ScreenCapturePlugin.notifySessionState(false, reason);
        stopSelf();
    }

    @Override
    public void onDestroy() {
        if (!destroying) finishSession("连续分屏截图会话已结束", true);
        super.onDestroy();
    }
}
