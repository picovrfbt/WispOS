plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Wisp Drive Recorder: records a drive the way Drive Mode reads it (speed,
// braking, turns), nothing else, so testers without a Car Thing can send
// drives to tune Drive Mode with
android {
    namespace = "dev.carthingfw.driverecorder"
    compileSdk = 35

    defaultConfig {
        applicationId = "dev.carthingfw.driverecorder"
        minSdk = 29
        targetSdk = 35
        versionCode = 3
        versionName = "1.2"
    }

    // the same release key as the companion app (see app/build.gradle.kts)
    signingConfigs {
        wispSetting("keystore", "WISP_KEYSTORE")?.let { path ->
            create("wisp") {
                storeFile = file(path)
                storePassword = wispSetting("keystorePassword", "WISP_KEYSTORE_PASSWORD")
                keyAlias = wispSetting("keyAlias", "WISP_KEY_ALIAS") ?: "wisp"
                keyPassword = wispSetting("keyPassword", "WISP_KEY_PASSWORD")
                    ?: wispSetting("keystorePassword", "WISP_KEYSTORE_PASSWORD")
            }
        }
    }
    buildTypes {
        getByName("release") {
            signingConfigs.findByName("wisp")?.let { signingConfig = it }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation(project(":drive-core"))
}

/** a signing setting from Gradle properties (wisp.<name>) or the environment */
fun wispSetting(name: String, env: String): String? =
    (findProperty("wisp.$name") as String?) ?: System.getenv(env)
