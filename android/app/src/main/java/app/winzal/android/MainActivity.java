package app.winzal.android;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.widget.Toast;

/**
 * WinZal for Android is the floating island, not an app screen.
 *
 * The launcher only asks for the two Android permissions the island needs, starts
 * IslandService, and finishes immediately. After that the translucent island pill
 * lives above other apps.
 */
public class MainActivity extends Activity {

    private boolean askedOverlay;
    private boolean askedNotifications;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        if (Build.VERSION.SDK_INT >= 21) {
            getWindow().setStatusBarColor(android.graphics.Color.TRANSPARENT);
            getWindow().setNavigationBarColor(android.graphics.Color.TRANSPARENT);
        }
        startIsland();
    }

    @Override protected void onResume() {
        super.onResume();
        if (askedOverlay) {
            askedOverlay = false;
            if (Settings.canDrawOverlays(this)) {
                startIsland();
            } else {
                Toast.makeText(this, "Overlay permission is needed for the floating island.", Toast.LENGTH_LONG).show();
                finish();
            }
        }
    }

    private void startIsland() {
        if (!Settings.canDrawOverlays(this)) {
            if (askedOverlay) {
                Toast.makeText(this, "Overlay permission is needed for the floating island.", Toast.LENGTH_LONG).show();
                finish();
                return;
            }
            askedOverlay = true;
            try {
                startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getPackageName())));
            } catch (Exception e) {
                startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION));
            }
            return;
        }

        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED
                && !askedNotifications) {
            askedNotifications = true;
            requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 42);
            return;
        }

        SharedPreferences prefs = getSharedPreferences("winzal", MODE_PRIVATE);
        prefs.edit().putBoolean("island", true).apply();
        Intent service = new Intent(this, IslandService.class);
        service.setAction("expand");
        startForegroundService(service);
        finish();
    }

    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        // The island still runs without the notification permission; it just has no
        // visible foreground-service notification.
        startIsland();
    }
}
