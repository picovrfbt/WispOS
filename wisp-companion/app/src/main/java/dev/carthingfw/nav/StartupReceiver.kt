package dev.carthingfw.nav

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Starts the Wisp link again after the app updated itself (Android stops the
 * old one) and after the phone restarts, so the Car Thing finds it without
 * the app being opened.
 */
class StartupReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_MY_PACKAGE_REPLACED, Intent.ACTION_BOOT_COMPLETED -> LinkService.start(ctx)
        }
    }
}
