plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Wisp Phone: Wisp on a phone alone, no Car Thing. The app runs the same
// wisp-daemon and shows the same screens (wisp-ui, in phone mode), both built
// fresh by scripts/phone-parts.sh before every build (wispParts below)
android {
    namespace = "dev.carthingfw.phone"
    compileSdk = 35

    defaultConfig {
        applicationId = "dev.carthingfw.wispphone"
        minSdk = 29
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
        ndk {
            abiFilters += "arm64-v8a"
        }
    }

    // the daemon ships as libwispd.so so Android unpacks it where an app may
    // run programs (nativeLibraryDir)
    packaging {
        jniLibs.useLegacyPackaging = true
    }

    // the same release key as the Wisp app (see app/build.gradle.kts)
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
}

dependencies {
    // serves the screens from the app's assets to its WebView
    implementation("androidx.webkit:webkit:1.12.1")
    testImplementation("junit:junit:4.13.2")
}

/** a signing setting from Gradle properties (wisp.<name>) or the environment */
fun wispSetting(name: String, env: String): String? =
    (findProperty("wisp.$name") as String?) ?: System.getenv(env)

// builds the daemon for Android and the screens, into this module's jniLibs and
// assets (both left out of git), when this app is what's being built: the Wisp
// app's builds (and every module's tests) don't need Go or Node for it.
// -Pwisp.skipParts uses what's already there
val wispParts by tasks.registering(Exec::class) {
    onlyIf {
        !project.hasProperty("wisp.skipParts") &&
            gradle.startParameter.taskNames.any { it.startsWith(":phone:") }
    }
    workingDir = rootDir
    commandLine("sh", "scripts/phone-parts.sh")
}
tasks.named("preBuild") { dependsOn(wispParts) }

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}
