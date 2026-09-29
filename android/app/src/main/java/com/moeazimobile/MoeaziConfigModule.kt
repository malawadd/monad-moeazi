package com.moeazi.mobile

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule

class MoeaziConfigModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "MoeaziConfig"

  override fun getConstants() = mapOf(
    "apiBaseUrl" to BuildConfig.MOEAZI_API_BASE_URL,
    "magicPublishableKey" to BuildConfig.MOEAZI_MAGIC_PUBLISHABLE_KEY,
    "arbitrumRpcUrl" to BuildConfig.MOEAZI_ARBITRUM_RPC_URL,
  )
}
