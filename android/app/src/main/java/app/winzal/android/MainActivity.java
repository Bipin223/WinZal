package app.winzal.android;

import android.app.Activity;
import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.media.MediaMetadata;
import android.media.session.MediaController;
import android.media.session.MediaSessionManager;
import android.media.session.PlaybackState;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.Settings;
import android.text.SpannableString;
import android.text.Spanned;
import android.text.TextUtils;
import android.text.style.ForegroundColorSpan;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.SeekBar;
import android.widget.TextView;

import org.json.JSONObject;

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

/**
 * WinZal for Android: a lean, island-style companion for the Windows notch app.
 *
 * Android has no system notch, so the island lives in the app (and could later be
 * mirrored as an overlay). Windows-only pieces are intentionally omitted: FPS/ETW,
 * Lenovo WMI, Discord local RPC, native Wi-Fi/Bluetooth toggles and the tray.
 */
public class MainActivity extends Activity {

    private static final int BG = Color.rgb(9, 10, 12);
    private static final int CARD = Color.rgb(22, 23, 26);
    private static final int CARD_2 = Color.rgb(30, 31, 35);
    private static final int TEXT = Color.rgb(245, 245, 247);
    private static final int TEXT_2 = Color.rgb(165, 166, 171);
    private static final int TEXT_3 = Color.rgb(112, 113, 119);
    private static final int GREEN = Color.rgb(48, 209, 88);
    private static final int RED = Color.rgb(255, 69, 58);

    private FrameLayout content;
    private LinearLayout nav;
    private final List<TextView> navItems = new ArrayList<>();
    private int tab = 0;

    private TextView clock, date, weatherTop, batteryTop, miniTitle, miniArtist, miniSource;
    private ImageView miniArt;
    private ImageView homeArt;
    private EqualizerView equalizer;
    private TextView homeTitle, homeArtist, homeLyrics;
    private TextView bigTitle, bigArtist, bigSource, lyricCurrent, lyricNext, lyricsHint, progressNow, progressEnd;
    private ImageView bigArt;
    private SeekBar progress;
    private TextView playButton, permissionButton;
    private TextView timerDisplay, timerHint, noteStatus;
    private EditText noteInput;

    private MediaSessionManager sessions;
    private ComponentName listener;
    private MediaController controller;
    private final HashMap<String, Long> playingSince = new HashMap<>();
    private String lyricKey = "";
    private String metaKey = "";
    private final List<Line> lyrics = new ArrayList<>();
    private int lyricIndex = -1;
    private long lyricLineStart = 0;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final SimpleDateFormat timeFormat = new SimpleDateFormat("h:mm a", Locale.ENGLISH);
    private final SimpleDateFormat dateFormat = new SimpleDateFormat("EEE d MMM", Locale.ENGLISH);
    private final Pattern stamp = Pattern.compile("\\[(\\d{1,2}):(\\d{2})(?:[.:](\\d{1,3}))?\\]");

    private android.os.CountDownTimer countdown;
    private long timerEndsAt = 0;
    private long timerRemaining = 25 * 60_000L;
    private boolean timerRunning = false;

    private final Runnable clockTick = new Runnable() {
        @Override public void run() {
            Date now = new Date();
            String t = timeFormat.format(now);
            SpannableString span = new SpannableString(t);
            if (!t.isEmpty()) span.setSpan(new ForegroundColorSpan(RED), 0, 1, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            clock.setText(span);
            date.setText(dateFormat.format(now));
            handler.postDelayed(this, 1000);
        }
    };

    private final Runnable mediaTick = new Runnable() {
        @Override public void run() {
            pollMedia();
            handler.postDelayed(this, 1000);
        }
    };

    private final Runnable lyricTick = new Runnable() {
        @Override public void run() {
            updateLyrics();
            handler.postDelayed(this, 250);
        }
    };

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        Window w = getWindow();
        w.setStatusBarColor(Color.BLACK);
        w.setNavigationBarColor(Color.BLACK);
        w.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        w.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);

        sessions = (MediaSessionManager) getSystemService(Context.MEDIA_SESSION_SERVICE);
        listener = new ComponentName(this, MediaListenerService.class);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(BG);
        content = new FrameLayout(this);
        root.addView(content, match());

        buildNav();
        FrameLayout.LayoutParams navParams = new FrameLayout.LayoutParams(-1, dp(62));
        navParams.gravity = Gravity.BOTTOM;
        root.addView(nav, navParams);

        content.addView(buildHome());
        content.addView(buildMusic());
        content.addView(buildTimer());
        content.addView(buildNotes());
        content.addView(buildAbout());
        showTab(0);
        setContentView(root);

        handler.post(clockTick);
        Intent battery = registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
        if (battery != null) {
            int level = battery.getIntExtra("level", -1);
            int scale = battery.getIntExtra("scale", 100);
            if (level >= 0) batteryTop.setText(Math.round(level * 100f / Math.max(1, scale)) + "%");
        }
        worker.execute(this::fetchWeather);
    }

    @Override protected void onResume() {
        super.onResume();
        handler.removeCallbacks(mediaTick);
        handler.removeCallbacks(lyricTick);
        handler.post(mediaTick);
        handler.post(lyricTick);
        if (!hasNotificationAccess()) {
            permissionButton.setVisibility(View.VISIBLE);
            miniTitle.setText("Notification access needed");
            miniArtist.setText("Tap to let WinZal read the playing song");
            bigTitle.setText("No media access");
            bigArtist.setText("Grant Notification Access to show the playing song and lyrics.");
        } else {
            permissionButton.setVisibility(View.GONE);
        }
    }

    @Override protected void onPause() {
        super.onPause();
        handler.removeCallbacks(mediaTick);
        handler.removeCallbacks(lyricTick);
    }

    @Override protected void onDestroy() {
        super.onDestroy();
        handler.removeCallbacksAndMessages(null);
        worker.shutdownNow();
    }

    // â”€â”€ UI â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    private View buildHome() {
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        LinearLayout box = column();
        box.setPadding(dp(16), dp(14), dp(16), dp(84));

        LinearLayout island = new LinearLayout(this);
        island.setOrientation(LinearLayout.VERTICAL);
        island.setPadding(dp(18), dp(14), dp(18), dp(14));
        island.setBackground(round(Color.BLACK, 24));
        island.setOnClickListener(v -> showTab(1));
        island.setElevation(dp(10));

        LinearLayout top = new LinearLayout(this);
        top.setOrientation(LinearLayout.HORIZONTAL);
        top.setGravity(Gravity.CENTER_VERTICAL);
        clock = label("9:41", 30, TEXT, Typeface.BOLD);
        clock.setFontFeatureSettings("tnum");
        date = label("Sat 24 Oct", 11, TEXT_3, Typeface.NORMAL);
        LinearLayout timeCol = column();
        timeCol.addView(clock);
        timeCol.addView(date);
        top.addView(timeCol, weight());
        LinearLayout right = column();
        right.setGravity(Gravity.END);
        weatherTop = label("â€”", 18, TEXT_2, Typeface.BOLD);
        batteryTop = label("â€”", 10, TEXT_3, Typeface.NORMAL);
        right.addView(weatherTop);
        right.addView(batteryTop);
        top.addView(right);
        island.addView(top);

        LinearLayout now = new LinearLayout(this);
        now.setOrientation(LinearLayout.HORIZONTAL);
        now.setGravity(Gravity.CENTER_VERTICAL);
        now.setPadding(0, dp(12), 0, 0);
        miniArt = new ImageView(this);
        miniArt.setScaleType(ImageView.ScaleType.CENTER_CROP);
        GradientDrawable artBg = round(CARD_2, 8);
        miniArt.setBackground(artBg);
        miniArt.setClipToOutline(true);
        now.addView(miniArt, new LinearLayout.LayoutParams(dp(30), dp(30)));
        LinearLayout meta = column();
        meta.setPadding(dp(10), 0, dp(8), 0);
        miniTitle = label("Nothing playing", 12, TEXT, Typeface.BOLD);
        miniArtist = label("Tap to open Now Playing", 10, TEXT_3, Typeface.NORMAL);
        miniSource = label("", 9, TEXT_3, Typeface.NORMAL);
        meta.addView(miniTitle);
        meta.addView(miniArtist);
        meta.addView(miniSource);
        now.addView(meta, weight());
        equalizer = new EqualizerView(this);
        now.addView(equalizer, new LinearLayout.LayoutParams(dp(26), dp(18)));
        island.addView(now);
        box.addView(island, block(0, 14));

        LinearLayout quick = new LinearLayout(this);
        quick.setOrientation(LinearLayout.HORIZONTAL);
        quick.addView(statCard("Now Playing", "Open the player", () -> showTab(1)), half(0, 6));
        quick.addView(statCard("Lyrics", "Synced from LRCLIB", () -> showTab(1)), half(6, 0));
        box.addView(quick, block(0, 10));

        box.addView(label("NOW PLAYING", 10, TEXT_3, Typeface.BOLD), block(0, 8));
        LinearLayout card = card();
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        ImageView art = new ImageView(this);
        art.setScaleType(ImageView.ScaleType.CENTER_CROP);
        art.setBackground(round(CARD_2, 12));
        art.setClipToOutline(true);
        homeArt = art;
        homeTitle = label("Nothing playing", 14, TEXT, Typeface.BOLD);
        homeArtist = label("Start a song in any player", 11, TEXT_3, Typeface.NORMAL);
        homeLyrics = label("", 11, TEXT_2, Typeface.NORMAL);
        homeLyrics.setMaxLines(2);
        homeLyrics.setEllipsize(TextUtils.TruncateAt.END);
        LinearLayout info = column();
        info.setPadding(dp(12), 0, 0, 0);
        info.addView(homeTitle);
        info.addView(homeArtist);
        info.addView(homeLyrics);
        row.addView(art, new LinearLayout.LayoutParams(dp(52), dp(52)));
        row.addView(info, weight());
        card.addView(row);
        card.setOnClickListener(v -> showTab(1));
        box.addView(card, block(0, 4));

        TextView tip = label("Android shows media from apps that expose a MediaSession.\nNotification Access is required once.", 10, TEXT_3, Typeface.NORMAL);
        tip.setLineSpacing(0, 1.25f);
        box.addView(tip, block(0, 18));

        scroll.addView(box);
        return scroll;
    }

    private View buildMusic() {
        ScrollView scroll = new ScrollView(this);
        LinearLayout box = column();
        box.setPadding(dp(16), dp(14), dp(16), dp(84));
        box.addView(label("NOW PLAYING", 10, TEXT_3, Typeface.BOLD), block(0, 10));

        bigArt = new ImageView(this);
        bigArt.setScaleType(ImageView.ScaleType.CENTER_CROP);
        bigArt.setBackground(round(CARD_2, 22));
        bigArt.setClipToOutline(true);
        FrameLayout artWrap = new FrameLayout(this);
        artWrap.addView(bigArt, new FrameLayout.LayoutParams(-1, -1));
        int side = Math.min(getResources().getDisplayMetrics().widthPixels - dp(80), dp(260));
        LinearLayout.LayoutParams artParams = new LinearLayout.LayoutParams(side, side);
        artParams.gravity = Gravity.CENTER_HORIZONTAL;
        box.addView(artWrap, artParams);

        bigTitle = label("Nothing playing", 20, TEXT, Typeface.BOLD);
        bigTitle.setGravity(Gravity.CENTER);
        bigTitle.setPadding(0, dp(18), 0, 0);
        bigArtist = label("Start a song in any player", 12, TEXT_2, Typeface.NORMAL);
        bigArtist.setGravity(Gravity.CENTER);
        bigSource = label("", 10, TEXT_3, Typeface.NORMAL);
        bigSource.setGravity(Gravity.CENTER);
        box.addView(bigTitle);
        box.addView(bigArtist);
        box.addView(bigSource);

        progress = new SeekBar(this);
        progress.setMax(1000);
        progress.setPadding(0, dp(12), 0, 0);
        progress.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override public void onProgressChanged(SeekBar s, int p, boolean fromUser) { }
            @Override public void onStartTrackingTouch(SeekBar s) { }
            @Override public void onStopTrackingTouch(SeekBar s) {
                if (controller == null) return;
                PlaybackState st = controller.getPlaybackState();
                if (st == null || durationMs() <= 0) return;
                controller.getTransportControls().seekTo((long) (durationMs() * s.getProgress() / 1000.0));
            }
        });
        box.addView(progress);
        LinearLayout times = new LinearLayout(this);
        times.setOrientation(LinearLayout.HORIZONTAL);
        progressNow = label("0:00", 10, TEXT_3, Typeface.NORMAL);
        progressEnd = label("0:00", 10, TEXT_3, Typeface.NORMAL);
        progressEnd.setGravity(Gravity.END);
        times.addView(progressNow, weight());
        times.addView(progressEnd, weight());
        box.addView(times);

        LinearLayout controls = new LinearLayout(this);
        controls.setGravity(Gravity.CENTER);
        controls.setPadding(0, dp(10), 0, dp(4));
        controls.addView(roundButton("â®", v -> control("previous")), size(dp(42)));
        playButton = roundButton("â–¶", v -> control("toggle"));
        controls.addView(playButton, size(dp(58)));
        controls.addView(roundButton("â­", v -> control("next")), size(dp(42)));
        box.addView(controls);

        permissionButton = label("Grant Notification Access", 12, Color.BLACK, Typeface.BOLD);
        permissionButton.setGravity(Gravity.CENTER);
        permissionButton.setPadding(0, dp(10), 0, dp(10));
        permissionButton.setBackground(round(GREEN, 18));
        permissionButton.setOnClickListener(v -> openNotificationAccess());
        box.addView(permissionButton, block(0, 8));

        box.addView(label("LYRICS", 10, TEXT_3, Typeface.BOLD), block(0, 14));
        LinearLayout lyr = card();
        lyricCurrent = label("Lyrics appear when the song has a synced LRCLIB entry.", 17, TEXT, Typeface.BOLD);
        lyricCurrent.setGravity(Gravity.CENTER);
        lyricCurrent.setLineSpacing(0, 1.2f);
        lyricNext = label("", 12, TEXT_3, Typeface.NORMAL);
        lyricNext.setGravity(Gravity.CENTER);
        lyricsHint = label("Line by line Â· LRCLIB", 9, TEXT_3, Typeface.NORMAL);
        lyricsHint.setGravity(Gravity.CENTER);
        lyr.addView(lyricCurrent, block(0, 4));
        lyr.addView(lyricNext, block(0, 6));
        lyr.addView(lyricsHint);
        box.addView(lyr);
        scroll.addView(box);
        return scroll;
    }

    private View buildTimer() {
        ScrollView scroll = new ScrollView(this);
        LinearLayout box = column();
        box.setPadding(dp(16), dp(18), dp(16), dp(84));
        box.addView(label("TIMER", 10, TEXT_3, Typeface.BOLD), block(0, 18));
        LinearLayout card = card();
        card.setGravity(Gravity.CENTER_HORIZONTAL);
        timerDisplay = label("25:00", 56, TEXT, Typeface.BOLD);
        timerDisplay.setFontFeatureSettings("tnum");
        timerDisplay.setGravity(Gravity.CENTER);
        timerHint = label("Focus session", 11, TEXT_3, Typeface.NORMAL);
        timerHint.setGravity(Gravity.CENTER);
        card.addView(timerDisplay);
        card.addView(timerHint, block(0, 4));
        LinearLayout controls = new LinearLayout(this);
        controls.setGravity(Gravity.CENTER);
        controls.setPadding(0, dp(20), 0, 0);
        controls.addView(roundButton("âˆ’5", v -> adjustTimer(-5 * 60_000L)), size(dp(48)));
        controls.addView(roundButton("â–¶", v -> toggleTimer()), size(dp(62)));
        controls.addView(roundButton("+5", v -> adjustTimer(5 * 60_000L)), size(dp(48)));
        card.addView(controls);
        TextView reset = label("Reset", 12, TEXT_2, Typeface.NORMAL);
        reset.setGravity(Gravity.CENTER);
        reset.setPadding(0, dp(18), 0, 0);
        reset.setOnClickListener(v -> resetTimer());
        card.addView(reset);
        box.addView(card, block(0, 8));
        scroll.addView(box);
        return scroll;
    }

    private View buildNotes() {
        ScrollView scroll = new ScrollView(this);
        LinearLayout box = column();
        box.setPadding(dp(16), dp(18), dp(16), dp(84));
        box.addView(label("NOTES", 10, TEXT_3, Typeface.BOLD), block(0, 10));
        LinearLayout card = card();
        noteInput = new EditText(this);
        noteInput.setBackgroundColor(Color.TRANSPARENT);
        noteInput.setTextColor(TEXT);
        noteInput.setHintTextColor(TEXT_3);
        noteInput.setHint("Write somethingâ€¦");
        noteInput.setTextSize(14);
        noteInput.setMinLines(7);
        noteInput.setGravity(Gravity.TOP);
        SharedPreferences prefs = getSharedPreferences("winzal", MODE_PRIVATE);
        noteInput.setText(prefs.getString("note", ""));
        card.addView(noteInput, new LinearLayout.LayoutParams(-1, -2));
        TextView save = label("Save note", 12, Color.BLACK, Typeface.BOLD);
        save.setGravity(Gravity.CENTER);
        save.setPadding(0, dp(10), 0, dp(10));
        save.setBackground(round(TEXT, 16));
        save.setOnClickListener(v -> {
            prefs.edit().putString("note", noteInput.getText().toString()).apply();
            noteStatus.setText("Saved");
            handler.postDelayed(() -> noteStatus.setText(""), 1500);
        });
        card.addView(save, block(0, 10));
        noteStatus = label("", 10, GREEN, Typeface.NORMAL);
        noteStatus.setGravity(Gravity.CENTER);
        card.addView(noteStatus);
        box.addView(card);
        scroll.addView(box);
        return scroll;
    }

    private View buildAbout() {
        ScrollView scroll = new ScrollView(this);
        LinearLayout box = column();
        box.setPadding(dp(16), dp(18), dp(16), dp(84));
        LinearLayout card = card();
        card.setGravity(Gravity.CENTER_HORIZONTAL);
        card.setPadding(dp(20), dp(22), dp(20), dp(22));
        TextView dev = label("DEVELOPED BY", 9, TEXT_3, Typeface.BOLD);
        dev.setLetterSpacing(0.12f);
        card.addView(dev, block(0, 10));
        ImageView photo = new ImageView(this);
        photo.setImageResource(R.drawable.bipin);
        photo.setScaleType(ImageView.ScaleType.CENTER_CROP);
        photo.setBackground(round(CARD_2, 24));
        photo.setClipToOutline(true);
        card.addView(photo, size(dp(96)));
        TextView name = label("Bipin Rizal", 22, TEXT, Typeface.BOLD);
        name.setPadding(0, dp(12), 0, 0);
        card.addView(name);
        TextView bio = label("Enthusiast, keen learner, curious designer & developer.", 11, TEXT_2, Typeface.NORMAL);
        bio.setGravity(Gravity.CENTER);
        bio.setPadding(dp(12), dp(6), dp(12), 0);
        card.addView(bio);
        LinearLayout links = new LinearLayout(this);
        links.setGravity(Gravity.CENTER);
        links.setPadding(0, dp(16), 0, 0);
        links.addView(roundButton("GitHub", v -> openUrl("https://github.com/Bipin223")), size(dp(84)));
        links.addView(roundButton("Website", v -> openUrl("https://bipin-rijal.vercel.app")), size(dp(84)));
        card.addView(links);
        TextView version = label("WinZal for Android Â· 1.0.0", 9, TEXT_3, Typeface.NORMAL);
        version.setPadding(0, dp(16), 0, 0);
        card.addView(version);
        box.addView(card);
        TextView note = label("Companion to WinZal for Windows.\nAndroid cannot read Lenovo sensors, ETW FPS or Discord's local RPC.", 10, TEXT_3, Typeface.NORMAL);
        note.setLineSpacing(0, 1.25f);
        box.addView(note, block(0, 14));
        scroll.addView(box);
        return scroll;
    }

    // â”€â”€ Media â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    private boolean hasNotificationAccess() {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 27) return nm.isNotificationListenerAccessGranted(listener);
        String enabled = Settings.Secure.getString(getContentResolver(), "enabled_notification_listeners");
        return enabled != null && enabled.contains(getPackageName());
    }

    private void openNotificationAccess() {
        try {
            startActivity(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS));
        } catch (Exception e) {
            startActivity(new Intent(Settings.ACTION_SETTINGS));
        }
    }

    private void pollMedia() {
        if (!hasNotificationAccess()) return;
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
            if (first == null) {
                // Nothing plays: keep the last app if it still exists, otherwise the first.
                if (controller != null) {
                    for (MediaController c : list) if (c.getPackageName().equals(controller.getPackageName())) first = c;
                }
                if (first == null && !list.isEmpty()) first = list.get(0);
            }
            if (first != null) {
                controller = first;
                bindController();
            } else {
                clearMedia();
            }
        } catch (SecurityException e) {
            permissionButton.setVisibility(View.VISIBLE);
        } catch (Exception ignored) { }
    }

    private long durationMs() {
        MediaMetadata md = controller == null ? null : controller.getMetadata();
        return md == null ? 0 : md.getLong(MediaMetadata.METADATA_KEY_DURATION);
    }

    private void bindController() {
        MediaMetadata md = controller.getMetadata();
        PlaybackState st = controller.getPlaybackState();
        String title = md == null ? "" : md.getString(MediaMetadata.METADATA_KEY_TITLE);
        String artist = md == null ? "" : md.getString(MediaMetadata.METADATA_KEY_ARTIST);
        if (artist == null || artist.trim().isEmpty()) artist = md == null ? "" : md.getString(MediaMetadata.METADATA_KEY_ALBUM_ARTIST);
        if (title == null) title = "";
        if (artist == null) artist = "";
        Bitmap art = md == null ? null : md.getBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART);
        if (art == null && md != null) art = md.getBitmap(MediaMetadata.METADATA_KEY_ART);
        String source = controller.getPackageName().replace(".exe", "");
        miniTitle.setText(title.isEmpty() ? "Nothing playing" : title);
        miniArtist.setText(artist.isEmpty() ? source : artist);
        miniSource.setText(source);
        homeTitle.setText(title.isEmpty() ? "Nothing playing" : title);
        homeArtist.setText(artist.isEmpty() ? source : artist);
        bigTitle.setText(title.isEmpty() ? "Nothing playing" : title);
        bigArtist.setText(artist.isEmpty() ? source : artist);
        bigSource.setText(source);
        if (art != null) {
            miniArt.setImageBitmap(art);
            homeArt.setImageBitmap(art);
            bigArt.setImageBitmap(art);
        } else {
            miniArt.setImageResource(R.drawable.app_icon);
            homeArt.setImageResource(R.drawable.app_icon);
            bigArt.setImageResource(R.drawable.app_icon);
        }
        boolean isPlaying = st != null && st.getState() == PlaybackState.STATE_PLAYING;
        playButton.setText(isPlaying ? "â¸" : "â–¶");
        equalizer.setPlaying(isPlaying);
        long duration = durationMs(); if (st != null && duration > 0) {
            int p = (int) Math.min(1000, st.getPosition() * 1000 / duration);
            if (progress != null) progress.setProgress(p);
            progressNow.setText(time(st.getPosition()));
            progressEnd.setText("-" + time(Math.max(0, duration - st.getPosition())));
        } else {
            progressNow.setText("--:--");
            progressEnd.setText("--:--");
        }
        String key = title + "\u0001" + artist;
        if (!key.equals(metaKey)) {
            metaKey = key;
            fetchLyrics(title, artist, durationMs());
        }
    }

    private void clearMedia() {
        metaKey = "";
        lyricKey = "";
        lyrics.clear();
        lyricIndex = -1;
        miniTitle.setText("Nothing playing");
        miniArtist.setText("Start a song in any player");
        miniSource.setText("");
        homeTitle.setText("Nothing playing");
        homeArtist.setText("Start a song in any player");
        homeLyrics.setText("");
        bigTitle.setText("Nothing playing");
        bigArtist.setText("Start a song in any player");
        bigSource.setText("");
        if (homeArt != null) homeArt.setImageResource(R.drawable.app_icon);
        lyricCurrent.setText("Lyrics appear when the song has a synced LRCLIB entry.");
        lyricNext.setText("");
        playButton.setText("â–¶");
        equalizer.setPlaying(false);
    }

    private void control(String action) {
        if (controller == null) return;
        MediaController.TransportControls t = controller.getTransportControls();
        if ("toggle".equals(action)) {
            PlaybackState st = controller.getPlaybackState();
            if (st != null && st.getState() == PlaybackState.STATE_PLAYING) t.pause(); else t.play();
        } else if ("next".equals(action)) t.skipToNext();
        else if ("previous".equals(action)) t.skipToPrevious();
    }

    private String time(long ms) {
        long s = Math.max(0, ms / 1000);
        return String.format(Locale.ENGLISH, "%d:%02d", s / 60, s % 60);
    }

    // â”€â”€ Lyrics â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    private void fetchLyrics(String title, String artist, long durationMs) {
        if (title == null || title.trim().isEmpty()) return;
        String key = title + "\u0001" + artist;
        if (key.equals(lyricKey)) return;
        lyricKey = key;
        lyrics.clear();
        lyricIndex = -1;
        lyricCurrent.setText("Loading lyricsâ€¦");
        lyricNext.setText("");
        lyricsHint.setText("LRCLIB");
        long duration = durationMs / 1000;
        worker.execute(() -> {
            List<Line> result = new ArrayList<>();
            try {
                String q = "https://lrclib.net/api/get?track_name=" + URLEncoder.encode(title, "UTF-8")
                        + "&artist_name=" + URLEncoder.encode(artist == null ? "" : artist, "UTF-8");
                if (duration > 0) q += "&duration=" + duration;
                HttpURLConnection c = (HttpURLConnection) new URL(q).openConnection();
                c.setConnectTimeout(8000);
                c.setReadTimeout(8000);
                c.setRequestProperty("User-Agent", "WinZal-Android/1.0");
                if (c.getResponseCode() == 200) {
                    String body = read(c.getInputStream());
                    JSONObject o = new JSONObject(body);
                    String synced = o.optString("syncedLyrics", "");
                    if (!synced.isEmpty()) result = parseLrc(synced);
                }
                c.disconnect();
                if (result.isEmpty()) {
                    String q2 = "https://lrclib.net/api/search?track_name=" + URLEncoder.encode(title, "UTF-8");
                    if (artist != null && !artist.isEmpty()) q2 += "&artist_name=" + URLEncoder.encode(artist, "UTF-8");
                    HttpURLConnection c2 = (HttpURLConnection) new URL(q2).openConnection();
                    c2.setConnectTimeout(8000);
                    c2.setReadTimeout(8000);
                    c2.setRequestProperty("User-Agent", "WinZal-Android/1.0");
                    if (c2.getResponseCode() == 200) {
                        String body = read(c2.getInputStream());
                        org.json.JSONArray arr = new org.json.JSONArray(body);
                        for (int i = 0; i < arr.length() && result.isEmpty(); i++) {
                            String synced = arr.getJSONObject(i).optString("syncedLyrics", "");
                            if (!synced.isEmpty()) result = parseLrc(synced);
                        }
                    }
                    c2.disconnect();
                }
            } catch (Exception ignored) { }
            List<Line> finalResult = result;
            runOnUiThread(() -> {
                lyrics.clear();
                lyrics.addAll(finalResult);
                lyricIndex = -1;
                if (lyrics.isEmpty()) {
                    lyricCurrent.setText("No synced lyrics found.");
                    lyricNext.setText(title);
                    lyricsHint.setText("LRCLIB Â· line by line");
                } else {
                    lyricCurrent.setText(lyrics.get(0).text);
                    lyricNext.setText(lyrics.size() > 1 ? lyrics.get(1).text : "");
                    lyricsHint.setText("LRCLIB Â· line by line");
                }
            });
        });
    }

    private List<Line> parseLrc(String text) {
        List<Line> out = new ArrayList<>();
        for (String row : text.split("\\r?\\n")) {
            Matcher m = stamp.matcher(row);
            List<Double> times = new ArrayList<>();
            while (m.find()) {
                double sec = Integer.parseInt(m.group(1)) * 60 + Integer.parseInt(m.group(2));
                if (m.group(3) != null) sec += Integer.parseInt((m.group(3) + "00").substring(0, 3)) / 1000.0;
                times.add(sec);
            }
            String content = row.replaceAll("\\[[^\\]]+\\]", "").trim();
            if (content.isEmpty()) continue;
            for (double t : times) out.add(new Line(t, content));
        }
        out.sort((a, b) -> Double.compare(a.at, b.at));
        return out;
    }

    private void updateLyrics() {
        if (controller == null || lyrics.isEmpty()) return;
        PlaybackState st = controller.getPlaybackState();
        if (st == null) return;
        long ms = st.getPosition();
        if (st.getState() == PlaybackState.STATE_PLAYING) ms += SystemClock.elapsedRealtime() - st.getLastPositionUpdateTime();
        double sec = ms / 1000.0;
        int idx = -1;
        for (int i = 0; i < lyrics.size(); i++) {
            if (lyrics.get(i).at <= sec) idx = i; else break;
        }
        homeLyrics.setText(idx >= 0 ? lyrics.get(idx).text : "");
        if (idx == lyricIndex) return;
        lyricIndex = idx;
        if (idx < 0) return;
        String current = lyrics.get(idx).text;
        String next = idx + 1 < lyrics.size() ? lyrics.get(idx + 1).text : "";
        lyricCurrent.animate().cancel();
        lyricCurrent.animate().alpha(0f).translationY(dp(4)).setDuration(90).withEndAction(() -> {
            lyricCurrent.setText(current);
            lyricCurrent.setAlpha(0f);
            lyricCurrent.setTranslationY(dp(4));
            lyricCurrent.animate().alpha(1f).translationY(0f).setDuration(190).start();
        }).start();
        lyricNext.setText(next);
        lyricNext.setAlpha(0.55f);
        lyricNext.animate().alpha(1f).setDuration(220).start();
    }

    private String read(InputStream in) throws Exception {
        StringBuilder s = new StringBuilder();
        try (BufferedReader r = new BufferedReader(new InputStreamReader(in))) {
            String line;
            while ((line = r.readLine()) != null) s.append(line);
        }
        return s.toString();
    }

    private static class Line {
        final double at;
        final String text;
        Line(double at, String text) { this.at = at; this.text = text; }
    }

    // â”€â”€ Weather / timer / helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    private void fetchWeather() {
        try {
            String q = "https://api.open-meteo.com/v1/forecast?latitude=26.65&longitude=87.27&current=temperature_2m,weather_code&timezone=auto";
            HttpURLConnection c = (HttpURLConnection) new URL(q).openConnection();
            c.setConnectTimeout(8000);
            c.setReadTimeout(8000);
            if (c.getResponseCode() == 200) {
                JSONObject o = new JSONObject(read(c.getInputStream())).getJSONObject("current");
                int t = (int) Math.round(o.getDouble("temperature_2m"));
                int code = o.optInt("weather_code", 0);
                String icon = code == 0 ? "â˜€" : code < 4 ? "â›…" : code < 70 ? "â˜" : "â˜‚";
                runOnUiThread(() -> weatherTop.setText(icon + " " + t + "Â°"));
            }
            c.disconnect();
        } catch (Exception ignored) { }
    }

    private void toggleTimer() {
        if (timerRunning) {
            if (countdown != null) countdown.cancel();
            timerRunning = false;
            timerHint.setText("Paused");
            return;
        }
        timerRunning = true;
        timerHint.setText("Focus session");
        countdown = new android.os.CountDownTimer(timerRemaining, 250) {
            @Override public void onTick(long ms) {
                timerRemaining = ms;
                timerDisplay.setText(String.format(Locale.ENGLISH, "%02d:%02d", ms / 60000, (ms / 1000) % 60));
            }
            @Override public void onFinish() {
                timerRunning = false;
                timerRemaining = 0;
                timerDisplay.setText("00:00");
                timerHint.setText("Time's up");
            }
        }.start();
    }

    private void adjustTimer(long delta) {
        if (timerRunning && countdown != null) countdown.cancel();
        timerRunning = false;
        timerRemaining = Math.max(60_000, timerRemaining + delta);
        timerDisplay.setText(String.format(Locale.ENGLISH, "%02d:%02d", timerRemaining / 60000, (timerRemaining / 1000) % 60));
        timerHint.setText("Focus session");
    }

    private void resetTimer() {
        if (countdown != null) countdown.cancel();
        timerRunning = false;
        timerRemaining = 25 * 60_000L;
        timerDisplay.setText("25:00");
        timerHint.setText("Focus session");
    }

    private void buildNav() {
        nav = new LinearLayout(this);
        nav.setOrientation(LinearLayout.HORIZONTAL);
        nav.setGravity(Gravity.CENTER);
        nav.setPadding(dp(6), dp(6), dp(6), dp(6));
        nav.setBackgroundColor(BG);
        String[] names = {"Home", "Music", "Timer", "Notes", "About"};
        for (int i = 0; i < names.length; i++) {
            final int index = i;
            TextView item = label(names[i], 10, TEXT_3, Typeface.BOLD);
            item.setGravity(Gravity.CENTER);
            item.setOnClickListener(v -> showTab(index));
            navItems.add(item);
            nav.addView(item, weight());
        }
    }

    private void showTab(int index) {
        tab = index;
        for (int i = 0; i < content.getChildCount(); i++) content.getChildAt(i).setVisibility(i == index ? View.VISIBLE : View.GONE);
        for (int i = 0; i < navItems.size(); i++) navItems.get(i).setTextColor(i == index ? TEXT : TEXT_3);
    }

    private View statCard(String title, String subtitle, Runnable click) {
        LinearLayout c = card();
        c.setPadding(dp(14), dp(12), dp(14), dp(12));
        c.addView(label(title, 12, TEXT, Typeface.BOLD));
        c.addView(label(subtitle, 10, TEXT_3, Typeface.NORMAL));
        c.setOnClickListener(v -> click.run());
        return c;
    }

    private LinearLayout card() {
        LinearLayout c = column();
        c.setPadding(dp(16), dp(16), dp(16), dp(16));
        c.setBackground(round(CARD, 18));
        return c;
    }

    private LinearLayout column() {
        LinearLayout l = new LinearLayout(this);
        l.setOrientation(LinearLayout.VERTICAL);
        return l;
    }

    private TextView label(String text, float size, int color, int style) {
        TextView v = new TextView(this);
        v.setText(text);
        v.setTextSize(size);
        v.setTextColor(color);
        v.setTypeface(Typeface.create("sans-serif", style));
        v.setIncludeFontPadding(false);
        return v;
    }

    private TextView roundButton(String text, View.OnClickListener click) {
        TextView v = label(text, 13, TEXT, Typeface.BOLD);
        v.setGravity(Gravity.CENTER);
        v.setBackground(round(CARD_2, 22));
        v.setOnClickListener(click);
        v.setPadding(dp(8), dp(4), dp(8), dp(4));
        return v;
    }

    private GradientDrawable round(int color, float radius) {
        GradientDrawable d = new GradientDrawable();
        d.setColor(color);
        d.setCornerRadius(dp(radius));
        return d;
    }

    private LinearLayout.LayoutParams block(int top, int bottom) {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-1, -2);
        p.setMargins(0, dp(top), 0, dp(bottom));
        return p;
    }

    private LinearLayout.LayoutParams half(int left, int right) {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(0, -2, 1f);
        p.setMargins(dp(left), 0, dp(right), 0);
        return p;
    }

    private LinearLayout.LayoutParams weight() {
        return new LinearLayout.LayoutParams(0, -2, 1f);
    }

    private LinearLayout.LayoutParams size(int size) {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(size, size);
        p.gravity = Gravity.CENTER;
        p.setMargins(dp(8), 0, dp(8), 0);
        return p;
    }

    private FrameLayout.LayoutParams match() {
        return new FrameLayout.LayoutParams(-1, -1);
    }

    private int dp(float value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private void openUrl(String url) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
        } catch (Exception ignored) { }
    }

    /** Tiny 4-bar equalizer; 30 fps and only while a session is playing. */
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
            if (on) { last = 0; postInvalidateOnAnimation(); }
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
            if (playing) postInvalidateOnAnimation();
        }

        private float dp(float v) { return v * getResources().getDisplayMetrics().density; }
    }
}

