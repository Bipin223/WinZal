package app.winzal.android;

import android.service.notification.NotificationListenerService;

/**
 * Exists so Android lets the app read the active media sessions (and therefore show
 * the playing song). The user grants Notification Access once in system settings.
 */
public class MediaListenerService extends NotificationListenerService {
}
