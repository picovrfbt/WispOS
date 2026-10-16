plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

// What Drive Mode reads from the phone and records: the sensors, the rules
// that turn the drive into the mix, and the drive recordings. Shared by the
// Wisp Companion and the Wisp Drive Recorder, so both record the same way.
android {
    namespace = "dev.carthingfw.drive"
    compileSdk = 35

    defaultConfig {
        minSdk = 29
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
    testImplementation("junit:junit:4.13.2")
}
