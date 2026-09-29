package com.moeazi.mobile

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
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
    loadReactNative(this)
  }
}
