package dev.carthingfw.nav

import android.annotation.SuppressLint
import android.app.Activity
import android.os.Bundle
import android.webkit.CookieManager
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast

/**
 * Signs in to SoundCloud: soundcloud.com's own sign-in page, inside this app.
 * You type your details into SoundCloud's page; this only keeps the sign-in
 * token soundcloud.com sets once you're in, on this phone, so SoundCloud.kt can
 * read your library. Nothing is sent anywhere but to SoundCloud itself.
 */
class SoundCloudSignInActivity : Activity() {
    private lateinit var web: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val cookies = CookieManager.getInstance()
        cookies.setAcceptCookie(true)
        web = WebView(this).apply {
            prepare(this)
            webViewClient = object : WebViewClient() {
                override fun onPageFinished(view: WebView, url: String) {
                    checkSignedIn()
                }
            }
        }
        setContentView(web)
        web.loadUrl("https://soundcloud.com/signin")
        // Google refuses its sign-in inside apps ("this browser or app may not be secure")
        Toast.makeText(this, "Sign in with your email and password; Google sign-in doesn't work inside apps", Toast.LENGTH_LONG).show()
        // signing in through Google's pop-up sets the cookie without always reloading this page
        handler.postDelayed(poll, 1000)
    }

    private val handler = android.os.Handler(android.os.Looper.getMainLooper())
    private val poll = object : Runnable {
        override fun run() {
            if (!checkSignedIn()) handler.postDelayed(this, 1000)
        }
    }

    override fun onDestroy() {
        handler.removeCallbacks(poll)
        super.onDestroy()
    }

    private var done = false

    // signed in once soundcloud.com has its token cookie
    private fun checkSignedIn(): Boolean {
        if (done) return true
        val cookies = CookieManager.getInstance()
        val token = SIGNIN_HOSTS.firstNotNullOfOrNull { tokenIn(cookies.getCookie(it).orEmpty()) } ?: return false
        done = true
        Prefs.setScToken(this, token)
        Prefs.setScUser(this, "")
        cookies.flush()
        Toast.makeText(this, "Signed in to SoundCloud", Toast.LENGTH_SHORT).show()
        YtMusicLink.signedInChanged(applicationContext)
        finish()
        return true
    }

    override fun onBackPressed() {
        val top = popups.lastOrNull()
        when {
            top != null && top.canGoBack() -> top.goBack()
            top != null -> closePopup(top)
            web.canGoBack() -> web.goBack()
            else -> super.onBackPressed()
        }
    }

    // "Continue with Google" opens Google's sign-in in a pop-up; WebView shows
    // none unless asked to, which left a white page. Each pop-up opens over
    // the page here, and closes back to it once the sign-in is done
    private val popups = mutableListOf<WebView>()

    @SuppressLint("SetJavaScriptEnabled")
    private fun prepare(view: WebView) {
        val cookies = CookieManager.getInstance()
        view.settings.javaScriptEnabled = true
        view.settings.domStorageEnabled = true
        view.settings.javaScriptCanOpenWindowsAutomatically = true
        view.settings.setSupportMultipleWindows(true)
        // sign-in providers turn away pages they can tell are in an embedded view
        view.settings.userAgentString = view.settings.userAgentString.replace("; wv", "")
        cookies.setAcceptThirdPartyCookies(view, true)
        view.webChromeClient = object : android.webkit.WebChromeClient() {
            override fun onCreateWindow(
                parent: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: android.os.Message,
            ): Boolean {
                val popup = WebView(this@SoundCloudSignInActivity)
                prepare(popup)
                popup.webViewClient = WebViewClient()
                popups += popup
                addContentView(
                    popup,
                    android.view.ViewGroup.LayoutParams(
                        android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                        android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                    ),
                )
                (resultMsg.obj as WebView.WebViewTransport).webView = popup
                resultMsg.sendToTarget()
                return true
            }

            override fun onCloseWindow(window: WebView) = closePopup(window)
        }
    }

    private fun closePopup(popup: WebView) {
        popups.remove(popup)
        (popup.parent as? android.view.ViewGroup)?.removeView(popup)
        popup.destroy()
    }

    companion object {
        // where soundcloud.com's sign-in leaves its token, depending on how you signed in
        private val SIGNIN_HOSTS = listOf(
            "https://soundcloud.com", "https://m.soundcloud.com", "https://secure.soundcloud.com",
            "https://api-auth.soundcloud.com", "https://api-v2.soundcloud.com",
        )

        /** the oauth_token cookie's value, if signed in */
        fun tokenIn(jar: String): String? = jar.split(';').map { it.trim() }
            .firstOrNull { it.startsWith("oauth_token=") }
            ?.removePrefix("oauth_token=")?.takeIf { it.length > 8 }
    }
}
