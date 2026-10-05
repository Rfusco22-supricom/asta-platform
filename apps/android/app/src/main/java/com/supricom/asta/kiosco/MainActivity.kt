package com.supricom.asta.kiosco

import android.content.Context
import android.content.res.Configuration
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.lifecycleScope
import com.supricom.asta.kiosco.dominio.AlmacenPreferencias
import com.supricom.asta.kiosco.dominio.CacheLocal
import com.supricom.asta.kiosco.dominio.ClienteApi
import com.supricom.asta.kiosco.dominio.Datos
import com.supricom.asta.kiosco.ui.Kiosco
import com.supricom.asta.kiosco.ui.Raiz

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
 */
class MainActivity : ComponentActivity() {
    private lateinit var kiosco: Kiosco

    override fun attachBaseContext(base: Context) {
        val config = Configuration(base.resources.configuration).apply { fontScale = 1f }
        super.attachBaseContext(base.createConfigurationContext(config))
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        ocultarBarras()

        kiosco = Kiosco(
            Datos(
                ClienteApi(BuildConfig.ASTA_API_BASE, BuildConfig.ASTA_API_KEY, version = BuildConfig.VERSION_NAME),
                CacheLocal(AlmacenPreferencias(getSharedPreferences("asta.kiosco", MODE_PRIVATE))),
            ),
            lifecycleScope,
        )
        setContent { Raiz(kiosco) }
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
