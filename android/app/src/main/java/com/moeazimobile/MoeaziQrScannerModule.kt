package com.moeazi.mobile

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning

class MoeaziQrScannerModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "MoeaziQrScanner"

  @ReactMethod
  fun scan(promise: Promise) {
    val activity = context.currentActivity
    if (activity == null) {
      promise.reject("SCANNER_UNAVAILABLE", "The QR scanner is not available right now.")
      return
    }
    val options = GmsBarcodeScannerOptions.Builder()
      .setBarcodeFormats(Barcode.FORMAT_QR_CODE)
      .enableAutoZoom()
      .build()
    GmsBarcodeScanning.getClient(activity, options).startScan()
      .addOnSuccessListener { barcode ->
        val value = barcode.rawValue
        if (value.isNullOrBlank()) promise.reject("EMPTY_QR", "This QR code does not contain a wallet address.")
        else promise.resolve(value)
      }
      .addOnCanceledListener { promise.reject("SCAN_CANCELLED", "QR scanning was cancelled.") }
      .addOnFailureListener { error ->
        promise.reject("SCANNER_UNAVAILABLE", "The QR scanner could not start. Enter or paste the address instead.", error)
      }
  }
}
