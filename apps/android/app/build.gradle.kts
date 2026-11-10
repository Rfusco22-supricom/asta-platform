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
        // El de Google Play: no se puede cambiar una vez publicada. El `namespace`
        // (el paquete del código) no sale en ningún sitio y se queda.
        applicationId = "com.supricom.asta"
        // Android 8: lo que corre en cualquier tablet que se compre hoy para esto.
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "1.0.0"
        // En el emulador, 10.0.2.2 es el `localhost` de la máquina anfitriona.
        buildConfigField("String", "ASTA_API_BASE", cadena(local.getProperty("asta.apiBase", "http://10.0.2.2:3001")))
        buildConfigField("String", "ASTA_API_KEY", cadena(local.getProperty("asta.apiKey", "")))
    }

    // La firma de subida a Google Play, de `keystore.properties` (no se versiona,
    // como la clave): ver docs/14-TIENDAS.md. Sin él, el .aab sale sin firmar.
    val firma = Properties().apply {
        val f = rootProject.file("keystore.properties")
        if (f.exists()) f.inputStream().use { load(it) }
    }
    if (firma.getProperty("storeFile") != null) {
        signingConfigs {
            create("subida") {
                storeFile = rootProject.file(firma.getProperty("storeFile"))
                storePassword = firma.getProperty("storePassword")
                keyAlias = firma.getProperty("keyAlias")
                keyPassword = firma.getProperty("keyPassword")
            }
        }
        buildTypes {
            getByName("release") { signingConfig = signingConfigs.getByName("subida") }
        }
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
    // El lector del QR del código de vinculación: lo pone Google Play services, sin permiso de cámara.
    implementation("com.google.android.gms:play-services-code-scanner:16.1.0")
    debugImplementation("androidx.compose.ui:ui-tooling")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.11.0")
}
