package com.moeazi.mobile

import android.os.Build
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class MoeaziDeviceSecurityModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private var pending = false
  override fun getName() = "MoeaziDeviceSecurity"
  @ReactMethod
  fun confirm(reason: String, promise: Promise) {
    val activity = context.currentActivity as? FragmentActivity
    if (activity == null || Build.VERSION.SDK_INT < 30 || pending) {
      promise.reject("SECURITY_UNAVAILABLE", "Secure confirmation requires Android 11 or later and an unlocked app.")
      return
    }
    activity.runOnUiThread {
      val allowed = BiometricManager.Authenticators.BIOMETRIC_STRONG or BiometricManager.Authenticators.DEVICE_CREDENTIAL
      if (BiometricManager.from(activity).canAuthenticate(allowed) != BiometricManager.BIOMETRIC_SUCCESS) {
        promise.reject("SECURITY_NOT_CONFIGURED", "Set up a secure device lock or strong biometrics before sending.")
        return@runOnUiThread
      }
      pending = true
      val prompt = BiometricPrompt(activity, ContextCompat.getMainExecutor(activity), object : BiometricPrompt.AuthenticationCallback() {
        override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
          pending = false; promise.resolve(true)
        }
        override fun onAuthenticationError(code: Int, message: CharSequence) {
          pending = false; promise.resolve(false)
        }
      })
      prompt.authenticate(BiometricPrompt.PromptInfo.Builder()
        .setTitle("Confirm with device security").setSubtitle(reason.take(160))
        .setAllowedAuthenticators(allowed).build())
    }
  }
}
