package dev.carthingfw.nav

import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager

/**
 * The launcher icon, chosen in the app: each icon is an activity-alias of
 * MainActivity in the manifest, and exactly one is enabled. Switching enables
 * the new one before disabling the old, so the app never drops off the
 * launcher; the launcher picks the change up in a moment.
 */
object AppIcons {
    data class Icon(val alias: String, val label: String, val preview: Int)

    val ALL = listOf(
        Icon(".IconDark", "Wisp", R.mipmap.ic_launcher_dark),
        Icon(".IconGreen", "Green", R.mipmap.ic_launcher_green),
        Icon(".IconLight", "Light", R.mipmap.ic_launcher_light),
        Icon(".IconClassic", "Classic", R.mipmap.ic_launcher),
    )

    private fun component(ctx: Context, alias: String) = ComponentName(ctx.packageName, ctx.packageName + alias)

    /** the icon on the launcher now (the manifest's default when none has been chosen) */
    fun current(ctx: Context): Icon {
        val pm = ctx.packageManager
        return ALL.firstOrNull { icon ->
            when (pm.getComponentEnabledSetting(component(ctx, icon.alias))) {
                PackageManager.COMPONENT_ENABLED_STATE_ENABLED -> true
                // never chosen: the manifest says, and only the first is enabled there
                PackageManager.COMPONENT_ENABLED_STATE_DEFAULT -> icon === ALL[0] && ALL.drop(1).none {
                    pm.getComponentEnabledSetting(component(ctx, it.alias)) == PackageManager.COMPONENT_ENABLED_STATE_ENABLED
                }
                else -> false
            }
        } ?: ALL[0]
    }

    fun set(ctx: Context, chosen: Icon) {
        val pm = ctx.packageManager
        val old = current(ctx)
        if (old == chosen) return
        pm.setComponentEnabledSetting(
            component(ctx, chosen.alias),
            PackageManager.COMPONENT_ENABLED_STATE_ENABLED, PackageManager.DONT_KILL_APP,
        )
        for (icon in ALL) {
            if (icon == chosen) continue
            pm.setComponentEnabledSetting(
                component(ctx, icon.alias),
                PackageManager.COMPONENT_ENABLED_STATE_DISABLED, PackageManager.DONT_KILL_APP,
            )
        }
    }
}
