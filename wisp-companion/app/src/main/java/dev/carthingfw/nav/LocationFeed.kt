package dev.carthingfw.nav

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Looper
import android.util.Log

/** GPS at 1 Hz while a Car Thing is connected, for the map's position puck */
object LocationFeed : LocationListener {
    private var manager: LocationManager? = null

    @SuppressLint("MissingPermission") // checked just below
    @Synchronized
    fun start(ctx: Context) {
        if (manager != null) return
        if (ctx.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            Log.w("CarThingNav", "no location permission; the map will not follow")
            return
        }
        val lm = ctx.getSystemService(LocationManager::class.java) ?: return
        lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000L, 0f, this, Looper.getMainLooper())
        lm.getLastKnownLocation(LocationManager.GPS_PROVIDER)?.let(::onLocationChanged)
        manager = lm
    }

    @Synchronized
    fun stop() {
        manager?.removeUpdates(this)
        manager = null
    }

    val running: Boolean get() = manager != null

    override fun onLocationChanged(l: Location) {
        NavStore.setFix(
            NavStore.Fix(
                lat = l.latitude,
                lng = l.longitude,
                bearing = if (l.hasBearing()) l.bearing else 0f,
                speed = if (l.hasSpeed()) l.speed else 0f,
                accuracy = if (l.hasAccuracy()) l.accuracy else 0f,
            ),
        )
    }

    // older Android calls these and crashes on the default abstract-ish impls
    @Deprecated("Deprecated in Java")
    override fun onStatusChanged(provider: String?, status: Int, extras: android.os.Bundle?) {}
    override fun onProviderEnabled(provider: String) {}
    override fun onProviderDisabled(provider: String) {}
}
