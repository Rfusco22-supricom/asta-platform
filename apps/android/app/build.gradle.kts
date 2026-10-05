import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

// La URL del middleware y la API key de la tienda, de `local.properties`, que no
// se versiona (ver README). La credencial es el token de la tablet (panel → Kioscos).
val local = Properties().apply {
    val f = rootProject.file("local.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
fun cadena(valor: String) = "\"" + valor.replace("\\", "\\\\").replace("\"", "\\\"") + "\""

android {
    namespace = "com.supricom.asta.kiosco"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.supricom.asta.kiosco"
        // Android 8: lo que corre en cualquier tablet que se compre hoy para esto.
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
        // En el emulador, 10.0.2.2 es el `localhost` de la máquina anfitriona.
        buildConfigField("String", "ASTA_API_BASE", cadena(local.getProperty("asta.apiBase", "http://10.0.2.2:3001")))
        buildConfigField("String", "ASTA_API_KEY", cadena(local.getProperty("asta.apiKey", "")))
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    jvmToolchain(17)
}

dependencies {
    val bom = platform("androidx.compose:compose-bom:2026.09.00")
    implementation(bom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.11.0")
    implementation("androidx.core:core-ktx:1.17.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.11.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.11.0")
    debugImplementation("androidx.compose.ui:ui-tooling")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.11.0")
}
