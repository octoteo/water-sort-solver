package com.octoteo.watersortsolver;

import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ShareReceiverPlugin.class);
        registerPlugin(ScreenCapturePlugin.class);
        registerPlugin(NativeUpdaterPlugin.class);
        super.onCreate(savedInstanceState);
        UpdateDiagnostics.record(this, "activity.create", "MainActivity created");
        ShareReceiverPlugin.captureIntent(this, getIntent());
    }

    @Override
    public void onResume() {
        super.onResume();
        UpdateDiagnostics.record(this, "activity.resume", "MainActivity resumed");
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        UpdateDiagnostics.record(this, "activity.new_intent", intent == null ? "null intent" : String.valueOf(intent.getAction()));
        ShareReceiverPlugin.captureIntent(this, intent);
    }
}
