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
        ShareReceiverPlugin.captureIntent(this, getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        ShareReceiverPlugin.captureIntent(this, intent);
    }
}
