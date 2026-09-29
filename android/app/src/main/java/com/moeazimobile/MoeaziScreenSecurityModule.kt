package com.moeazi.mobile

import android.view.WindowManager
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class MoeaziScreenSecurityModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "MoeaziScreenSecurity"

  @ReactMethod
  fun setSecure(enabled: Boolean) {
    val activity = context.currentActivity ?: return
    activity.runOnUiThread {
      if (enabled) activity.window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
      else activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
    }
  }
}
