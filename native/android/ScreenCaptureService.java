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
    static final String EXTRA_RESULT_CODE = "resultCode";
    static final String EXTRA_RESULT_DATA = "resultData";
    static final String EXTRA_APP_LEFT = "appLeft";
    static final String EXTRA_APP_TOP = "appTop";
    static final String EXTRA_APP_RIGHT = "appRight";
    static final String EXTRA_APP_BOTTOM = "appBottom";
    static final String EXTRA_CALLBACK_ID = "callbackId";

    private static final String CHANNEL_ID = "water-sort-screen-capture";
    private static final int NOTIFICATION_ID = 7021;

    private MediaProjection projection;
    private VirtualDisplay virtualDisplay;
    private ImageReader imageReader;
    private HandlerThread captureThread;
    private Handler captureHandler;
    private boolean completed;
    private String callbackId;

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) {
            stopSelf();
            return START_NOT_STICKY;
        }

        callbackId = intent.getStringExtra(EXTRA_CALLBACK_ID);
        createChannel();
        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_camera)
            .setContentTitle("Water Sort 分屏截图")
            .setContentText("正在读取另一侧游戏画面，仅在本机处理")
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
            fail("没有收到 Android 截屏授权数据，请重试。");
            return START_NOT_STICKY;
        }

        Rect appBounds = new Rect(
            intent.getIntExtra(EXTRA_APP_LEFT, 0),
            intent.getIntExtra(EXTRA_APP_TOP, 0),
            intent.getIntExtra(EXTRA_APP_RIGHT, 0),
            intent.getIntExtra(EXTRA_APP_BOTTOM, 0)
        );

        try {
            startProjection(resultCode, resultData, appBounds);
        } catch (Exception error) {
            fail("分屏截图启动失败：" + error.getMessage());
        }
        return START_NOT_STICKY;
    }

    private void startProjection(int resultCode, Intent resultData, Rect appBounds) {
        WindowManager windowManager = (WindowManager) getSystemService(Context.WINDOW_SERVICE);
        if (windowManager == null) throw new IllegalStateException("WindowManager unavailable");

        int screenWidth;
        int screenHeight;
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

        Rect crop = computeOtherPane(appBounds, screenWidth, screenHeight);
        if (crop == null || crop.width() < 120 || crop.height() < 180) {
            fail("没有检测到有效分屏。请先让 Water Sort 与淘特处于上下或左右分屏，再点“分屏截图”。");
            return;
        }

        MediaProjectionManager manager = (MediaProjectionManager) getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        if (manager == null) throw new IllegalStateException("MediaProjectionManager unavailable");

        projection = manager.getMediaProjection(resultCode, resultData);
        if (projection == null) throw new IllegalStateException("MediaProjection unavailable");

        captureThread = new HandlerThread("water-sort-capture");
        captureThread.start();
        captureHandler = new Handler(captureThread.getLooper());

        projection.registerCallback(new MediaProjection.Callback() {
            @Override
            public void onStop() {
                if (!completed) fail("系统已结束本次截屏授权，请重新点“分屏截图”。");
                else cleanup(false);
            }
        }, captureHandler);

        imageReader = ImageReader.newInstance(screenWidth, screenHeight, PixelFormat.RGBA_8888, 2);
        imageReader.setOnImageAvailableListener(reader -> {
            if (completed) return;
            Image image = null;
            try {
                image = reader.acquireLatestImage();
                if (image == null) return;
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
                completed = true;
                Handler main = new Handler(Looper.getMainLooper());
                main.post(() -> ScreenCapturePlugin.completeCapture(callbackId, target, resultWidth, resultHeight, crop));
                cleanup(true);
            } catch (Exception error) {
                fail("读取分屏画面失败：" + error.getMessage());
            } finally {
                if (image != null) image.close();
            }
        }, captureHandler);

        virtualDisplay = projection.createVirtualDisplay(
            "WaterSortSplitCapture",
            screenWidth,
            screenHeight,
            densityDpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            imageReader.getSurface(),
            null,
            captureHandler
        );
    }

    private Rect computeOtherPane(Rect appBounds, int screenWidth, int screenHeight) {
        Rect app = new Rect(
            Math.max(0, Math.min(screenWidth, appBounds.left)),
            Math.max(0, Math.min(screenHeight, appBounds.top)),
            Math.max(0, Math.min(screenWidth, appBounds.right)),
            Math.max(0, Math.min(screenHeight, appBounds.bottom))
        );
        int gap = Math.max(6, Math.round(getResources().getDisplayMetrics().density * 6));

        boolean horizontalDivider = app.width() >= screenWidth * 0.65f && app.height() < screenHeight * 0.86f;
        if (horizontalDivider) {
            if (app.centerY() <= screenHeight / 2) {
                int top = Math.min(screenHeight, app.bottom + gap);
                return new Rect(0, top, screenWidth, screenHeight);
            }
            int bottom = Math.max(0, app.top - gap);
            return new Rect(0, 0, screenWidth, bottom);
        }

        boolean verticalDivider = app.height() >= screenHeight * 0.65f && app.width() < screenWidth * 0.86f;
        if (verticalDivider) {
            if (app.centerX() <= screenWidth / 2) {
                int left = Math.min(screenWidth, app.right + gap);
                return new Rect(left, 0, screenWidth, screenHeight);
            }
            int right = Math.max(0, app.left - gap);
            return new Rect(0, 0, right, screenHeight);
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
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "分屏截图", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("仅在用户主动授权时读取分屏画面用于本地识别");
        manager.createNotificationChannel(channel);
    }

    private void fail(String message) {
        if (completed) return;
        completed = true;
        Handler main = new Handler(Looper.getMainLooper());
        main.post(() -> ScreenCapturePlugin.failCapture(callbackId, message));
        cleanup(true);
    }

    private synchronized void cleanup(boolean stopProjection) {
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
        stopSelf();
    }
}
