package sk.stanislav.sosactv

import android.annotation.SuppressLint
import android.app.AlertDialog
import android.graphics.Color
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

class MainActivity : AppCompatActivity() {
    private lateinit var webView: WebView
    private lateinit var overlay: LinearLayout
    private lateinit var titleText: TextView
    private var customView: View? = null
    private var customViewCallback: WebChromeClient.CustomViewCallback? = null
    private var logoClicks = 0

    private val homeUrl = "https://tv.sosac.tv/cs/"
    private val loginUrl = "https://tv.sosac.tv/cs/registration"

    private val prefs by lazy {
        val masterKey = MasterKey.Builder(this)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()

        EncryptedSharedPreferences.create(
            this,
            "sosac_secure_settings",
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        hideSystemUi()

        CookieManager.getInstance().setAcceptCookie(true)

        val root = FrameLayout(this).apply {
            setBackgroundColor(Color.rgb(7, 10, 18))
        }

        webView = WebView(this).apply {
            setBackgroundColor(Color.rgb(7, 10, 18))
            isFocusable = true
            isFocusableInTouchMode = true
            requestFocus()

            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.databaseEnabled = true
            settings.loadsImagesAutomatically = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.cacheMode = WebSettings.LOAD_DEFAULT
            settings.useWideViewPort = true
            settings.loadWithOverviewMode = true
            settings.builtInZoomControls = false
            settings.displayZoomControls = false
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
            settings.userAgentString = settings.userAgentString + " SosacModernTV/0.3"

            webViewClient = object : WebViewClient() {
                override fun onPageFinished(view: WebView, url: String) {
                    CookieManager.getInstance().flush()
                    titleText.text = if (url.contains("registration")) "Prihlásenie" else "Sosac TV"
                    injectUiPolish()
                }
            }

            webChromeClient = object : WebChromeClient() {
                override fun onShowCustomView(view: View, callback: CustomViewCallback) {
                    showFullscreenVideo(view, callback)
                }

                override fun onHideCustomView() {
                    hideFullscreenVideo()
                }
            }

            loadUrl(homeUrl)
        }

        root.addView(webView, FrameLayout.LayoutParams(-1, -1))

        overlay = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(22, 14, 22, 14)
            setBackgroundColor(Color.argb(185, 7, 10, 18))
            alpha = 0.96f
        }

        val logo = TextView(this).apply {
            text = "S"
            textSize = 23f
            gravity = Gravity.CENTER
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.rgb(124, 58, 237))
            isFocusable = true
            setOnClickListener { onLogoClick() }
            setOnKeyListener { _, keyCode, event ->
                if (event.action == KeyEvent.ACTION_UP && (keyCode == KeyEvent.KEYCODE_DPAD_CENTER || keyCode == KeyEvent.KEYCODE_ENTER)) {
                    onLogoClick()
                    true
                } else false
            }
        }
        overlay.addView(logo, LinearLayout.LayoutParams(58, 58))

        titleText = TextView(this).apply {
            text = "Sosac TV"
            textSize = 18f
            setTextColor(Color.WHITE)
            setPadding(18, 0, 0, 0)
        }
        overlay.addView(titleText, LinearLayout.LayoutParams(0, -2, 1f))

        val hint = TextView(this).apply {
            text = "logo 5× = login"
            textSize = 13f
            setTextColor(Color.argb(210, 255, 255, 255))
        }
        overlay.addView(hint)

        root.addView(overlay, FrameLayout.LayoutParams(-1, 88, Gravity.TOP))
        setContentView(root)
    }

    private fun onLogoClick() {
        logoClicks++
        if (logoClicks >= 5) {
            logoClicks = 0
            showHiddenMenu()
        } else {
            Toast.makeText(this, "Ešte ${5 - logoClicks}×", Toast.LENGTH_SHORT).show()
        }
    }

    private fun showHiddenMenu() {
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(36, 16, 36, 0)
        }

        val userInput = EditText(this).apply {
            hint = "Používateľ / e-mail"
            singleLine()
            setText(prefs.getString("username", ""))
        }

        val passInput = EditText(this).apply {
            hint = "Heslo"
            singleLine()
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            setText(prefs.getString("password", ""))
        }

        val info = TextView(this).apply {
            text = "Údaje sa ukladajú šifrovane v zariadení. WebView si zároveň pamätá cookies, takže po úspešnom prihlásení sa appka otvorí už prihlásená."
            setPadding(0, 20, 0, 0)
        }

        box.addView(userInput)
        box.addView(passInput)
        box.addView(info)

        AlertDialog.Builder(this)
            .setTitle("Skryté prihlásenie")
            .setView(box)
            .setPositiveButton("Uložiť a prihlásiť") { _, _ ->
                val username = userInput.text.toString().trim()
                val password = passInput.text.toString()
                prefs.edit()
                    .putString("username", username)
                    .putString("password", password)
                    .apply()
                openLoginAndAutofill(username, password)
            }
            .setNeutralButton("Otvoriť domov") { _, _ -> webView.loadUrl(homeUrl) }
            .setNegativeButton("Vymazať") { _, _ ->
                prefs.edit().clear().apply()
                CookieManager.getInstance().removeAllCookies(null)
                CookieManager.getInstance().flush()
                Toast.makeText(this, "Login a cookies vymazané", Toast.LENGTH_LONG).show()
                webView.loadUrl(homeUrl)
            }
            .show()
    }

    private fun openLoginAndAutofill(username: String, password: String) {
        titleText.text = "Otváram prihlásenie…"
        webView.loadUrl(loginUrl)
        webView.postDelayed({ autofillLogin(username, password) }, 1800)
        webView.postDelayed({ autofillLogin(username, password) }, 3600)
    }

    private fun autofillLogin(username: String, password: String) {
        val js = """
            (function(){
                const u = ${username.toJsString()};
                const p = ${password.toJsString()};
                const inputs = Array.from(document.querySelectorAll('input'));
                const user = inputs.find(i => /user|login|name|username|email/i.test((i.name || '') + ' ' + (i.id || '') + ' ' + (i.placeholder || ''))) || inputs.find(i => (i.type || '').toLowerCase() !== 'password');
                const pass = inputs.find(i => (i.type || '').toLowerCase() === 'password');
                const remember = inputs.find(i => (i.type || '').toLowerCase() === 'checkbox');
                function setValue(el, value){
                    if(!el) return;
                    el.focus();
                    el.value = value;
                    el.dispatchEvent(new Event('input', {bubbles:true}));
                    el.dispatchEvent(new Event('change', {bubbles:true}));
                }
                setValue(user, u);
                setValue(pass, p);
                if(remember && !remember.checked) remember.click();
            })();
        """.trimIndent()
        webView.evaluateJavascript(js, null)
    }

    private fun injectUiPolish() {
        val js = """
            (function(){
                if (window.__sosacModernTvPolish) return;
                window.__sosacModernTvPolish = true;
                const style = document.createElement('style');
                style.innerHTML = `
                    html, body { background:#070a12 !important; }
                    video { max-width:100% !important; }
                    a, button, input, select, textarea { outline-color:#8b5cf6 !important; }
                `;
                document.head.appendChild(style);
            })();
        """.trimIndent()
        webView.evaluateJavascript(js, null)
    }

    private fun showFullscreenVideo(view: View, callback: WebChromeClient.CustomViewCallback) {
        if (customView != null) {
            callback.onCustomViewHidden()
            return
        }
        customView = view
        customViewCallback = callback
        overlay.visibility = View.GONE
        webView.visibility = View.GONE
        (window.decorView as FrameLayout).addView(
            view,
            FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        )
        hideSystemUi()
    }

    private fun hideFullscreenVideo() {
        val view = customView ?: return
        (window.decorView as FrameLayout).removeView(view)
        customView = null
        customViewCallback?.onCustomViewHidden()
        customViewCallback = null
        webView.visibility = View.VISIBLE
        overlay.visibility = View.VISIBLE
        hideSystemUi()
    }

    private fun hideSystemUi() {
        window.decorView.post {
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
                window.insetsController?.let {
                    it.hide(WindowInsets.Type.statusBars() or WindowInsets.Type.navigationBars())
                    it.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                }
            } else {
                @Suppress("DEPRECATION")
                window.decorView.systemUiVisibility =
                    View.SYSTEM_UI_FLAG_FULLSCREEN or
                    View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or
                    View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
                    View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or
                    View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            }
        }
    }

    override fun onBackPressed() {
        when {
            customView != null -> hideFullscreenVideo()
            webView.canGoBack() -> webView.goBack()
            else -> super.onBackPressed()
        }
    }

    override fun onPause() {
        CookieManager.getInstance().flush()
        webView.onPause()
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
        hideSystemUi()
    }
}

private fun String.toJsString(): String {
    return "'" + this
        .replace("\\", "\\\\")
        .replace("'", "\\'")
        .replace("\n", "\\n")
        .replace("\r", "") + "'"
}
