package app.winzal.android;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.media.MediaMetadata;
import android.media.session.MediaController;
import android.media.session.MediaSessionManager;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.SeekBar;
import android.widget.TextView;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONObject;

/**
 * The Android "Dynamic Island": a small floating pill above other apps.
 *
 * Tap the pill to expand music controls; tap the compact pill again to collapse.
 * It deliberately avoids a full-screen overlay: only the pill's own bounds catch
 * touches, everything around it stays usable.
 */
public class IslandService extends Service {

    public static volatile boolean isRunning = false;

    private static final int BG = Color.BLACK;
    private static final int CARD = Color.rgb(24, 25, 28);
    private static final int TEXT = Color.rgb(245, 245, 247);
    private static final int TEXT_2 = Color.rgb(170, 171, 176);
    private static final int TEXT_3 = Color.rgb(115, 116, 122);
    private static final int GREEN = Color.rgb(48, 209, 88);
    private static final int RED = Color.rgb(255, 69, 58);

    private WindowManager windowManager;
    private View root;
    private WindowManager.LayoutParams params;
    private LinearLayout compact;
    private LinearLayout expanded;
    private TextView clock, title, artist, play, open, close;
    private ImageView art;
    private SeekBar seek;
    private EqualizerView equalizer;
    private boolean expandedState;
    private boolean seeking;

    private MediaSessionManager sessions;
    private ComponentName listener;
    private MediaController controller;
    private final HashMap<String, Long> playingSince = new HashMap<>();
    private String lastMeta = "";

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final SimpleDateFormat timeFormat = new SimpleDateFormat("h:mm", Locale.ENGLISH);

    private final Runnable clockTick = new Runnable() {
        @Override public void run() {
            Date now = new Date();
            String t = timeFormat.format(now);
            android.text.SpannableString span = new android.text.SpannableString(t);
            span.setSpan(new android.text.style.ForegroundColorSpan(RED), 0, Math.min(1, t.length()), android.text.Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            clock.setText(span);
            handler.postDelayed(this, 1000);
        }
    };

    private final Runnable mediaTick = new Runnable() {
        @Override public void run() {
            pollMedia();
            handler.postDelayed(this, 1000);
        }
    };

    private final Runnable collapse = new Runnable() {
        @Override public void run() { setExpanded(false); }
    };

    @Override public void onCreate() {
        super.onCreate();
        isRunning = true;
        sessions = (MediaSessionManager) getSystemService(Context.MEDIA_SESSION_SERVICE);
        listener = new ComponentName(this, MediaListenerService.class);
        createChannel();
        Notification n = new Notification.Builder(this, "winzal_island")
                .setContentTitle("WinZal floating island")
                .setContentText("Tap the pill to open music controls")
                .setSmallIcon(android.R.drawable.ic_media_play)
                .setOngoing(true)
                .build();
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        } else {
            startForeground(1, n);
        }
        windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
        buildOverlay();
        handler.post(clockTick);
        handler.post(mediaTick);
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && "expand".equals(intent.getAction())) {
            handler.post(() -> setExpanded(true));
        }
        return START_STICKY;
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override public void onDestroy() {
        isRunning = false;
        handler.removeCallbacksAndMessages(null);
        if (root != null && root.getParent() != null) {
            try { windowManager.removeView(root); } catch (Exception ignored) { }
        }
        getSharedPreferences("winzal", MODE_PRIVATE).edit().putBoolean("island", false).apply();
        super.onDestroy();
    }

    private void createChannel() {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        NotificationChannel c = new NotificationChannel("winzal_island", "WinZal floating island", NotificationManager.IMPORTANCE_LOW);
        c.setShowBadge(false);
        nm.createNotificationChannel(c);
    }

    private void buildOverlay() {
        root = new LinearLayout(this);
        ((LinearLayout) root).setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(10), dp(8), dp(10), dp(8));
        root.setBackground(round(BG, 22));
        root.setElevation(dp(14));

        compact = new LinearLayout(this);
        compact.setOrientation(LinearLayout.HORIZONTAL);
        compact.setGravity(Gravity.CENTER_VERTICAL);
        clock = label("9:41", 14, TEXT, Typeface.BOLD);
        clock.setPadding(dp(2), 0, dp(4), 0);
        compact.addView(clock);
        art = new ImageView(this);
        art.setScaleType(ImageView.ScaleType.CENTER_CROP);
        art.setBackground(round(CARD, 7));
        art.setClipToOutline(true);
        art.setVisibility(View.GONE);
        compact.addView(art, new LinearLayout.LayoutParams(dp(26), dp(26)));
        title = label("Nothing playing", 11, TEXT, Typeface.BOLD);
        title.setMaxLines(1);
        title.setEllipsize(android.text.TextUtils.TruncateAt.END);
        title.setPadding(dp(8), 0, dp(6), 0);
        title.setVisibility(View.GONE);
        compact.addView(title, new LinearLayout.LayoutParams(0, -2, 1f));
        equalizer = new EqualizerView(this);
        equalizer.setVisibility(View.GONE);
        compact.addView(equalizer, new LinearLayout.LayoutParams(dp(24), dp(16)));
        compact.setOnClickListener(v -> {
            setExpanded(!expandedState);
            if (expandedState) handler.postDelayed(collapse, 9000);
        });
        ((LinearLayout) root).addView(compact);

        expanded = new LinearLayout(this);
        expanded.setOrientation(LinearLayout.VERTICAL);
        expanded.setPadding(0, dp(10), 0, 0);
        expanded.setVisibility(View.GONE);
        TextView big = label("Nothing playing", 15, TEXT, Typeface.BOLD);
        big.setMaxLines(1);
        big.setEllipsize(android.text.TextUtils.TruncateAt.END);
        big.setId(View.generateViewId());
        expanded.addView(big);
        artist = label("", 11, TEXT_2, Typeface.NORMAL);
        artist.setMaxLines(1);
        artist.setEllipsize(android.text.TextUtils.TruncateAt.END);
        artist.setId(View.generateViewId());
        expanded.addView(artist);

        seek = new SeekBar(this);
        seek.setMax(1000);
        seek.setPadding(0, dp(4), 0, dp(2));
        seek.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override public void onProgressChanged(SeekBar s, int p, boolean user) { }
            @Override public void onStartTrackingTouch(SeekBar s) { seeking = true; }
            @Override public void onStopTrackingTouch(SeekBar s) {
                seeking = false;
                long dur = durationMs();
                if (controller != null && dur > 0) controller.getTransportControls().seekTo((long) (dur * s.getProgress() / 1000.0));
            }
        });
        expanded.addView(seek);

        LinearLayout controls = new LinearLayout(this);
        controls.setGravity(Gravity.CENTER);
        controls.setPadding(0, dp(2), 0, 0);
        controls.addView(button("⏮", v -> control("previous")), size(dp(34)));
        play = button("▶", v -> control("toggle"));
        controls.addView(play, size(dp(44)));
        controls.addView(button("⏭", v -> control("next")), size(dp(34)));
        expanded.addView(controls);

        LinearLayout bottom = new LinearLayout(this);
        bottom.setGravity(Gravity.CENTER);
        bottom.setPadding(0, dp(4), 0, 0);
        open = button("Media access", v -> {
            Intent i = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
            setExpanded(false);
        });
        open.setTextSize(10);
        open.setPadding(dp(12), dp(5), dp(12), dp(5));
        bottom.addView(open);
        close = button("Close", v -> stopSelf());
        close.setTextSize(10);
        close.setPadding(dp(12), dp(5), dp(12), dp(5));
        bottom.addView(close);
        expanded.addView(bottom);
        ((LinearLayout) root).addView(expanded);

        params = new WindowManager.LayoutParams(
                dp(210), WindowManager.LayoutParams.WRAP_CONTENT,
                Build.VERSION.SDK_INT >= 26 ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY : WindowManager.LayoutParams.TYPE_PHONE,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS
                        | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                        | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
                PixelFormat.TRANSLUCENT);
        params.gravity = Gravity.TOP | Gravity.CENTER_HORIZONTAL;
        params.y = statusBarHeight() + dp(6);
        try {
            windowManager.addView(root, params);
        } catch (Exception e) {
            stopSelf();
        }
        updateCompact();
    }

    private void setExpanded(boolean on) {
        if (on == expandedState) return;
        expandedState = on;
        handler.removeCallbacks(collapse);
        expanded.setVisibility(on ? View.VISIBLE : View.GONE);
        params.width = dp(on ? 310 : 210);
        try { windowManager.updateViewLayout(root, params); } catch (Exception ignored) { }
        root.animate().cancel();
        root.setAlpha(0.85f);
        root.animate().alpha(1f).setDuration(140).start();
        if (on) {
            expanded.setAlpha(0f);
            expanded.setTranslationY(-dp(4));
            expanded.animate().alpha(1f).translationY(0f).setDuration(160).start();
            handler.postDelayed(collapse, 9000);
        }
    }

    private void updateCompact() {
        boolean has = title.getText().length() > 0 && !"Nothing playing".contentEquals(title.getText());
        clock.setVisibility(has ? View.GONE : View.VISIBLE);
        art.setVisibility(has ? View.VISIBLE : View.GONE);
        title.setVisibility(has ? View.VISIBLE : View.GONE);
        equalizer.setVisibility(has ? View.VISIBLE : View.GONE);
    }

    private void pollMedia() {
        if (!hasNotificationAccess()) {
            title.setText("Notification access needed");
            artist.setText("Open WinZal to grant it");
            updateCompact();
            return;
        }
        try {
            List<MediaController> list = sessions.getActiveSessions(listener);
            long now = SystemClock.elapsedRealtime();
            Set<String> playing = new HashSet<>();
            MediaController first = null;
            long firstAt = Long.MAX_VALUE;
            for (MediaController c : list) {
                PlaybackState st = c.getPlaybackState();
                boolean on = st != null && st.getState() == PlaybackState.STATE_PLAYING;
                String pkg = c.getPackageName();
                if (on) {
                    playing.add(pkg);
                    playingSince.putIfAbsent(pkg, now);
                    long at = playingSince.get(pkg);
                    if (at < firstAt) { firstAt = at; first = c; }
                }
            }
            playingSince.keySet().retainAll(playing);
            if (first == null && controller != null) {
                for (MediaController c : list) if (c.getPackageName().equals(controller.getPackageName())) first = c;
            }
            if (first == null && !list.isEmpty()) first = list.get(0);
            if (first == null) {
                controller = null;
                title.setText("Nothing playing");
                artist.setText("Play something");
                ((TextView) expanded.getChildAt(0)).setText("Nothing playing");
                updateCompact();
                equalizer.setPlaying(false);
                return;
            }
            controller = first;
            MediaMetadata md = controller.getMetadata();
            PlaybackState st = controller.getPlaybackState();
            String t = md == null ? "" : md.getString(MediaMetadata.METADATA_KEY_TITLE);
            String a = md == null ? "" : md.getString(MediaMetadata.METADATA_KEY_ARTIST);
            if (a == null || a.isEmpty()) a = controller.getPackageName();
            if (t == null) t = "";
            title.setText(t.isEmpty() ? "Nothing playing" : t);
            artist.setText(a);
            ((TextView) expanded.getChildAt(0)).setText(t.isEmpty() ? "Nothing playing" : t);
            updateCompact();
            Bitmap bmp = md == null ? null : md.getBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART);
            if (bmp == null && md != null) bmp = md.getBitmap(MediaMetadata.METADATA_KEY_ART);
            if (bmp != null) art.setImageBitmap(bmp); else art.setImageResource(R.drawable.app_icon);
            boolean on = st != null && st.getState() == PlaybackState.STATE_PLAYING;
            play.setText(on ? "⏸" : "▶");
            equalizer.setPlaying(on);
            if (!seeking) {
                long dur = durationMs();
                if (dur > 0) {
                    long pos = st == null ? 0 : st.getPosition();
                    if (on) pos += SystemClock.elapsedRealtime() - st.getLastPositionUpdateTime();
                    seek.setProgress((int) Math.min(1000, pos * 1000 / dur));
                }
            }
        } catch (Exception ignored) { }
    }

    private void control(String action) {
        if (controller == null) return;
        MediaController.TransportControls t = controller.getTransportControls();
        if ("toggle".equals(action)) {
            PlaybackState st = controller.getPlaybackState();
            if (st != null && st.getState() == PlaybackState.STATE_PLAYING) t.pause(); else t.play();
        } else if ("next".equals(action)) t.skipToNext();
        else if ("previous".equals(action)) t.skipToPrevious();
        handler.removeCallbacks(collapse);
        handler.postDelayed(collapse, 9000);
    }

    private long durationMs() {
        MediaMetadata md = controller == null ? null : controller.getMetadata();
        return md == null ? 0 : md.getLong(MediaMetadata.METADATA_KEY_DURATION);
    }

    private boolean hasNotificationAccess() {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 27) return nm.isNotificationListenerAccessGranted(listener);
        String enabled = Settings.Secure.getString(getContentResolver(), "enabled_notification_listeners");
        return enabled != null && enabled.contains(getPackageName());
    }

    private int statusBarHeight() {
        int id = getResources().getIdentifier("status_bar_height", "dimen", "android");
        return id > 0 ? getResources().getDimensionPixelSize(id) : dp(24);
    }

    private TextView label(String s, float size, int color, int style) {
        TextView v = new TextView(this);
        v.setText(s);
        v.setTextSize(size);
        v.setTextColor(color);
        v.setTypeface(Typeface.create("sans-serif", style));
        v.setIncludeFontPadding(false);
        return v;
    }

    private TextView button(String s, View.OnClickListener click) {
        TextView v = label(s, 12, TEXT, Typeface.BOLD);
        v.setGravity(Gravity.CENTER);
        v.setBackground(round(CARD, 16));
        v.setPadding(dp(8), dp(4), dp(8), dp(4));
        v.setOnClickListener(click);
        return v;
    }

    private GradientDrawable round(int color, float radius) {
        GradientDrawable d = new GradientDrawable();
        d.setColor(color);
        d.setCornerRadius(dp(radius));
        return d;
    }

    private LinearLayout.LayoutParams size(int px) {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(px, px);
        p.setMargins(dp(6), 0, dp(6), 0);
        return p;
    }

    private int dp(float v) { return Math.round(v * getResources().getDisplayMetrics().density); }

    /** Tiny 30 fps bars; sleeps when paused. */
    private static class EqualizerView extends View {
        private final android.graphics.Paint paint = new android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG);
        private final float[] level = {0.3f, 0.55f, 0.4f, 0.7f};
        private boolean playing;
        private long last;
        private float phase;

        EqualizerView(Context context) {
            super(context);
            paint.setColor(GREEN);
            paint.setStrokeCap(android.graphics.Paint.Cap.ROUND);
        }

        void setPlaying(boolean on) {
            playing = on;
            if (on) { last = 0; postInvalidateDelayed(33); }
            else invalidate();
        }

        @Override protected void onDraw(android.graphics.Canvas canvas) {
            long now = SystemClock.uptimeMillis();
            if (last == 0) last = now;
            float dt = Math.min(0.05f, (now - last) / 1000f);
            last = now;
            float bar = getWidth() / 4f;
            for (int i = 0; i < 4; i++) {
                float target = playing ? (0.25f + 0.7f * (float) (0.5 + 0.5 * Math.sin(phase * (4 + i) + i * 1.7))) : 0.25f;
                level[i] += (target - level[i]) * Math.min(1f, dt * 8f);
                float h = Math.max(dp(2), getHeight() * level[i]);
                float x = bar * i + bar / 2f;
                canvas.drawLine(x, getHeight() / 2f - h / 2f, x, getHeight() / 2f + h / 2f, paint);
            }
            phase += dt;
            if (playing) postInvalidateDelayed(33);
        }

        private float dp(float v) { return v * getResources().getDisplayMetrics().density; }
    }
}
