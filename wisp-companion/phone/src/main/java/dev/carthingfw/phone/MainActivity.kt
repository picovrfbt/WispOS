package dev.carthingfw.phone

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader

/**
 * Wisp's screens, filling the phone held sideways. They're the Car Thing's
 * own (wisp-ui, in phone mode), served from the app and talking to the
 * background program (WispService) on this phone.
 */
class MainActivity : Activity() {

    private lateinit var web: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WispService.start(this)
        // the running notification needs it on Android 13 and up
        if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
        }
        // a screen in the car stays on
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        // served as http://127.0.0.1/, the same host as the background program
        // (127.0.0.1:3678): a page from anywhere else may not talk to a program
        // on the phone itself. Never fetched: the loader answers from the assets
        val assets = WebViewAssetLoader.Builder()
            .setDomain(ASSET_HOST)
            .setHttpAllowed(true)
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
        web = WebView(this).apply {
            setBackgroundColor(0xFF121212.toInt())
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            // what the screens can ask of the app (window.WispPhone)
            addJavascriptInterface(Bridge(), "WispPhone")
            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                    assets.shouldInterceptRequest(request.url)

                // Spotify's sign-in and any other link: the phone's browser
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    if (request.url.host == ASSET_HOST && request.url.port == -1) return false
                    openOutside(request.url)
                    return true
                }
            }
        }
        setContentView(web)
        web.loadUrl("http://$ASSET_HOST/assets/ui/index.html?phone")
    }

    override fun onResume() {
        super.onResume()
        hideBars()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideBars()
    }

    // the phone's back is Wisp's Back, as on the Car Thing
    @Deprecated("Wisp handles back itself")
    override fun onBackPressed() {
        web.evaluateJavascript(
            "window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape'}))",
            null,
        )
    }

    override fun onDestroy() {
        web.destroy()
        super.onDestroy()
    }

    // the whole screen for Wisp: the phone's bars come back with a swipe
    private fun hideBars() {
        window.insetsController?.let {
            it.hide(WindowInsets.Type.systemBars())
            it.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
    }

    inner class Bridge {
        /** the end of the background program's log, when it won't start */
        @JavascriptInterface
        fun daemonLog(): String = WispService.logTail(this@MainActivity)
    }

    private fun openOutside(uri: Uri) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, uri))
        } catch (e: Exception) {
            // nothing on the phone opens it
        }
    }

    companion object {
        private const val ASSET_HOST = "127.0.0.1"
    }
}
