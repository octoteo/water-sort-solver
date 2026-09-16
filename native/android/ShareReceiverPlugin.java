package com.octoteo.watersortsolver;

import android.app.Activity;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.OpenableColumns;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;

@CapacitorPlugin(name = "ShareReceiver")
public class ShareReceiverPlugin extends Plugin {
    private static final Object LOCK = new Object();
    private static volatile ShareReceiverPlugin activePlugin;
    private static String pendingUri;
    private static String pendingMimeType;
    private static String pendingName;
    private static File pendingFile;

    @Override
    public void load() {
        activePlugin = this;
    }

    public static void captureIntent(Activity activity, Intent intent) {
        if (activity == null || intent == null) return;
        if (!Intent.ACTION_SEND.equals(intent.getAction())) return;

        final String mimeType = intent.getType();
        if (mimeType == null || !mimeType.startsWith("image/")) return;

        Uri source = null;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            source = intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class);
        } else {
            //noinspection deprecation
            source = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        }
        if (source == null) {
            ClipData clipData = intent.getClipData();
            if (clipData != null && clipData.getItemCount() > 0) {
                source = clipData.getItemAt(0).getUri();
            }
        }
        if (source == null) return;

        final ContentResolver resolver = activity.getContentResolver();
        final String displayName = resolveDisplayName(resolver, source);
        final String extension = extensionForMime(mimeType);
        final File shareDir = new File(activity.getCacheDir(), "shared-images");
        if (!shareDir.exists() && !shareDir.mkdirs()) return;
        final File target = new File(shareDir, "share-" + System.currentTimeMillis() + extension);

        try (InputStream input = resolver.openInputStream(source);
             FileOutputStream output = new FileOutputStream(target)) {
            if (input == null) return;
            byte[] buffer = new byte[32 * 1024];
            int read;
            while ((read = input.read(buffer)) >= 0) {
                if (read > 0) output.write(buffer, 0, read);
            }
            output.flush();
        } catch (Exception ignored) {
            // The web UI keeps its normal file picker fallback if an external app
            // grants a broken or expired content URI.
            //noinspection ResultOfMethodCallIgnored
            target.delete();
            return;
        }

        JSObject payload;
        synchronized (LOCK) {
            if (pendingFile != null && pendingFile.exists() && !pendingFile.equals(target)) {
                //noinspection ResultOfMethodCallIgnored
                pendingFile.delete();
            }
            pendingFile = target;
            pendingUri = Uri.fromFile(target).toString();
            pendingMimeType = mimeType;
            pendingName = displayName != null ? displayName : "shared-screenshot" + extension;
            payload = makePayload();
        }

        ShareReceiverPlugin plugin = activePlugin;
        if (plugin != null) {
            plugin.notifyListeners("shareReceived", payload);
        }
    }

    @PluginMethod
    public void getPendingShare(PluginCall call) {
        synchronized (LOCK) {
            call.resolve(makePayload());
        }
    }

    @PluginMethod
    public void clearPendingShare(PluginCall call) {
        synchronized (LOCK) {
            if (pendingFile != null && pendingFile.exists()) {
                //noinspection ResultOfMethodCallIgnored
                pendingFile.delete();
            }
            pendingFile = null;
            pendingUri = null;
            pendingMimeType = null;
            pendingName = null;
        }
        call.resolve();
    }

    private static JSObject makePayload() {
        JSObject result = new JSObject();
        if (pendingUri != null) result.put("uri", pendingUri);
        if (pendingMimeType != null) result.put("mimeType", pendingMimeType);
        if (pendingName != null) result.put("name", pendingName);
        return result;
    }

    private static String resolveDisplayName(ContentResolver resolver, Uri uri) {
        try (Cursor cursor = resolver.query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (index >= 0) return cursor.getString(index);
            }
        } catch (Exception ignored) {
            // Fall back to a generated local name.
        }
        return null;
    }

    private static String extensionForMime(String mimeType) {
        if ("image/png".equals(mimeType)) return ".png";
        if ("image/webp".equals(mimeType)) return ".webp";
        if ("image/gif".equals(mimeType)) return ".gif";
        if ("image/heic".equals(mimeType) || "image/heif".equals(mimeType)) return ".heic";
        return ".jpg";
    }
}
