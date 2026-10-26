package com.supricom.asta.kiosco

import android.content.Context
import android.content.res.Configuration
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.lifecycle.lifecycleScope
import com.supricom.asta.kiosco.dominio.Activacion
import com.supricom.asta.kiosco.dominio.AlmacenCodigoSeguro
import com.supricom.asta.kiosco.dominio.AlmacenPreferencias
import com.supricom.asta.kiosco.dominio.CacheLocal
import com.supricom.asta.kiosco.dominio.ClienteApi
import com.supricom.asta.kiosco.dominio.Datos
import com.supricom.asta.kiosco.dominio.EstadoActivacion
import com.supricom.asta.kiosco.dominio.EstadoToken
import com.supricom.asta.kiosco.ui.Kiosco
import com.supricom.asta.kiosco.ui.PantallaActivacion
import com.supricom.asta.kiosco.ui.Raiz
import kotlinx.coroutines.delay

/**
 * Kiosco de Asta para tablets Android (#40).
 *
 * Lo que lo hace un kiosco, aparte de la interfaz:
 *
 *   · horizontal (`screenOrientation` en el manifiesto): la tablet va en un soporte;
 *   · a pantalla completa, con las barras del sistema ocultas (modo inmersivo);
 *   · la pantalla no se apaga durante la jornada (`FLAG_KEEP_SCREEN_ON`);
 *   · el tamaño de letra no sigue al del sistema: el kiosco ya es grande, y el
 *     ajuste lo puso alguien en una tablet compartida, no el cliente.
 *
 * Eso NO impide salirse de la app: para eso, fijar la pantalla o el modo
 * dispositivo dedicado. Ver `apps/android/README.md`.
 *
 * Sin token compilado, la primera vez pide el código de 6 dígitos que da el
 * panel (`Activacion`): así la misma app sirve para todas las tablets cuando se
 * instala desde la tienda de apps.
 */
private const val LATIDO_MS = 10 * 60 * 1000L

class MainActivity : ComponentActivity() {
    private lateinit var activacion: Activacion

    override fun attachBaseContext(base: Context) {
        val config = Configuration(base.resources.configuration).apply { fontScale = 1f }
        super.attachBaseContext(base.createConfigurationContext(config))
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        ocultarBarras()

        activacion = Activacion(
            claveCompilada = BuildConfig.ASTA_API_KEY,
            almacen = AlmacenCodigoSeguro(getSharedPreferences("asta.activacion", MODE_PRIVATE)),
            base = BuildConfig.ASTA_API_BASE,
            version = BuildConfig.VERSION_NAME,
            modelo = "${Build.MANUFACTURER} ${Build.MODEL} · Android ${Build.VERSION.RELEASE}",
        )
        setContent {
            when (val estado = activacion.estado) {
                // Un token distinto es otra tablet: se empieza de cero.
                is EstadoActivacion.Activa -> key(estado.apiKey) { KioscoActivo(estado.apiKey) }
                EstadoActivacion.Pendiente -> PantallaActivacion(activacion)
            }
        }
    }

    private fun api(clave: String) = ClienteApi(BuildConfig.ASTA_API_BASE, clave, version = BuildConfig.VERSION_NAME)

    /** La app de la tienda, con la tablet ya activada. */
    @Composable
    private fun KioscoActivo(clave: String) {
        val api = remember { api(clave) }
        val kiosco = remember {
            Kiosco(
                Datos(api, CacheLocal(AlmacenPreferencias(getSharedPreferences("asta.kiosco", MODE_PRIVATE)))),
                lifecycleScope,
            )
        }
        // Señal de vida cada 10 min mientras la app está abierta (#46): menos que el
        // umbral de la alerta «kiosco mudo» (30 min), con margen para un latido
        // perdido. Y de paso dice si el token sigue valiendo: un 401 es que la
        // desactivaron en el panel (o se renovó), y la tablet vuelve a pedir un código.
        LaunchedEffect(clave) {
            while (true) {
                if (clave.startsWith("asta_kio_")) {
                    if (api.comprobar() == EstadoToken.RECHAZADO) {
                        activacion.rechazado()
                        return@LaunchedEffect
                    }
                } else {
                    api.latir()
                }
                delay(LATIDO_MS)
            }
        }
        Raiz(kiosco)
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        // Un gesto desde el borde las enseña un momento; al volver, se esconden otra vez.
        if (hasFocus) ocultarBarras()
    }

    private fun ocultarBarras() {
        WindowCompat.getInsetsController(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
    }
}
