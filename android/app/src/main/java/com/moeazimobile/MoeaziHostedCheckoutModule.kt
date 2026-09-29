package com.moeazi.mobile

import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class MoeaziHostedCheckoutModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "MoeaziHostedCheckout"
  @ReactMethod
  fun open(url: String, promise: Promise) {
    val activity = context.currentActivity
    val uri = Uri.parse(url)
    if (activity == null || url.length > 8192 || uri.scheme != "https" || uri.host.isNullOrBlank() || uri.userInfo != null) {
      promise.reject("CHECKOUT_UNAVAILABLE", "Secure browser checkout is unavailable.")
      return
    }
    activity.runOnUiThread {
      try {
        CustomTabsIntent.Builder().setShowTitle(true).build().launchUrl(activity, uri)
        promise.resolve(null)
      } catch (_: Exception) {
        promise.reject("CHECKOUT_UNAVAILABLE", "Install a compatible browser or transfer USDC instead.")
      }
    }
  }
}
