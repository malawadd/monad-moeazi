package com.moeazi.mobile

import android.app.Application
import android.os.Build
import android.graphics.Typeface
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.common.assets.ReactFontManager
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      useDevSupport = BuildConfig.DEBUG,
      packageList =
        PackageList(this).packages.apply {
          add(MoeaziHapticsPackage())
          add(MoeaziConfigPackage())
          add(MoeaziQrScannerPackage())
          add(MoeaziScreenSecurityPackage())
          add(MoeaziCheckoutPackage())
        },
    ).also { host ->
      if (BuildConfig.DEBUG) {
        // The development launcher establishes adb reverse before opening the app.
        // Avoid the emulator's host-network route, which may be unavailable at boot.
        host.devSupportManager?.devSettings?.packagerConnectionSettings?.debugServerHost =
          "127.0.0.1:8082"
      }
    }
  }

  override fun onCreate() {
    super.onCreate()
    val fontManager = ReactFontManager.getInstance()
    registerVariableUserFont(fontManager, "MoeaziUserSyne", "fonts/Syne.ttf", 400, 800)
    registerVariableUserFont(fontManager, "MoeaziUserJakarta", "fonts/PlusJakartaSans.ttf", 500, 800)
    val plex = Typeface.createFromAsset(assets, "fonts/IBMPlexMono-Regular.ttf")
    fontManager.setTypeface("MoeaziUserPlex", Typeface.NORMAL, plex)
    fontManager.setTypeface("MoeaziUserPlex", Typeface.BOLD, Typeface.create(plex, Typeface.BOLD))
    loadReactNative(this)
  }

  private fun registerVariableUserFont(
    fontManager: ReactFontManager,
    family: String,
    assetPath: String,
    regularWeight: Int,
    boldWeight: Int,
  ) {
    fontManager.setTypeface(family, Typeface.NORMAL, createVariableTypeface(assetPath, regularWeight))
    fontManager.setTypeface(family, Typeface.BOLD, createVariableTypeface(assetPath, boldWeight))
  }

  private fun createVariableTypeface(assetPath: String, weight: Int): Typeface {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      try {
        return Typeface.Builder(assets, assetPath)
          .setFontVariationSettings("'wght' $weight")
          .setWeight(weight)
          .build()
      } catch (_: RuntimeException) {
        // Keep User Mode readable if an Android image cannot load the variable axis.
      }
    }
    val regular = Typeface.createFromAsset(assets, assetPath)
    return if (weight >= 700) Typeface.create(regular, Typeface.BOLD) else regular
  }
}
