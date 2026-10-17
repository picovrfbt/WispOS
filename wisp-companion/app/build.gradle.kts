plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "dev.carthingfw.nav"
    compileSdk = 35

    defaultConfig {
        applicationId = "dev.carthingfw.nav"
        minSdk = 29
        targetSdk = 35
        versionCode = 34
        versionName = "0.9.22"

        // YouTube Music's sign-in at google.com/device (YtSignIn): a Google OAuth
        // client of the "TVs and Limited Input devices" kind, from Gradle
        // properties (wisp.googleClientId, wisp.googleClientSecret) or the
        // environment. Without one the app builds, and the sign-in says so
        buildConfigField("String", "GOOGLE_CLIENT_ID", quoted(wispSetting("googleClientId", "WISP_GOOGLE_CLIENT_ID")))
        buildConfigField("String", "GOOGLE_CLIENT_SECRET", quoted(wispSetting("googleClientSecret", "WISP_GOOGLE_CLIENT_SECRET")))
    }
    buildFeatures {
        buildConfig = true
    }
    // every phone this app supports is 64-bit ARM: the voice and the language
    // models' native code ship for that alone (about 50 MB lighter)
    defaultConfig {
        ndk {
            abiFilters += "arm64-v8a"
        }
    }

    // Android only installs an update signed by the same key as the app already
    // there, so releases are always signed with Wisp's release key: on the
    // maintainer's PC from ~/.gradle/gradle.properties (wisp.keystore,
    // wisp.keystorePassword, wisp.keyAlias, wisp.keyPassword; made by
    // scripts/make-release-key.ps1), in the release workflow from secrets.
    // Without the key, release builds are left unsigned and debug builds use the
    // usual debug key, so anyone can still build and run the app
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
    // Drive Mode's sensors, rules and recordings, shared with the Drive Recorder
    implementation(project(":drive-core"))
    // the WebSocket server the Car Thing connects to
    implementation("org.java-websocket:Java-WebSocket:1.5.7")
    // Wisp's spoken voice: sherpa-onnx runs the Piper "Alan" model on the phone.
    // The official 1.13.8 AAR with only the arm64 libraries kept (every phone
    // this app supports is 64-bit), which keeps the app about 35 MB lighter
    implementation(files("libs/sherpa-onnx-1.13.8-arm64.aar"))
    // Wisp's thinking (WispThink.kt): Gemini Nano on the phone, through Android's AICore
    implementation("com.google.mlkit:genai-prompt:1.0.0-beta4")
    // ...and on phones without Gemini Nano, a downloaded open model (OpenModel.kt) through LiteRT-LM
    implementation("com.google.ai.edge.litertlm:litertlm-android:0.18.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    testImplementation("junit:junit:4.13.2")
    // Android's own org.json is a stub in plain JVM tests
    testImplementation("org.json:json:20240303")
}

/** a signing setting from Gradle properties (wisp.<name>) or the environment */
fun wispSetting(name: String, env: String): String? =
    (findProperty("wisp.$name") as String?) ?: System.getenv(env)

/** a Kotlin string literal for a BuildConfig field ("" when unset) */
fun quoted(v: String?): String = "\"" + (v ?: "").replace("\\", "\\\\").replace("\"", "\\\"") + "\""

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}
