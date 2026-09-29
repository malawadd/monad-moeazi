package com.moeazi.mobile

import android.os.Build
import android.view.HapticFeedbackConstants
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class MoeaziHapticsModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "MoeaziHaptics"

  private fun perform(constant: Int, fallback: Int) {
    val activity = context.currentActivity ?: return
    activity.runOnUiThread {
      val effect = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) constant else fallback
      activity.window.decorView.performHapticFeedback(effect)
    }
  }

  @ReactMethod
  fun selection() = perform(HapticFeedbackConstants.CLOCK_TICK, HapticFeedbackConstants.VIRTUAL_KEY)

  @ReactMethod
  fun confirm() = perform(HapticFeedbackConstants.CONFIRM, HapticFeedbackConstants.VIRTUAL_KEY)

  @ReactMethod
  fun reject() = perform(HapticFeedbackConstants.REJECT, HapticFeedbackConstants.LONG_PRESS)
}
