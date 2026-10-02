package com.supricom.asta.kiosco.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.supricom.asta.kiosco.dominio.Datos
import com.supricom.asta.kiosco.dominio.Impresora
import com.supricom.asta.kiosco.dominio.Informe
import com.supricom.asta.kiosco.dominio.Sesion
import com.supricom.asta.kiosco.dominio.Vigilante
import kotlinx.coroutines.CoroutineScope

/**
 * El estado del kiosco: qué pantalla se ve, la sesión y la conexión (#40, #41, #42).
 *
 * Tres pantallas: atracción → buscar → resultados. Nada más: quien lo usa está
 * de pie, con prisa y a veces con el dependiente esperando.
 *
 * Al tocar la atracción empieza una sesión que se cierra sola a los cuatro
 * minutos sin uso, avisando 30 s antes, y que el cliente puede cerrar con
 * «Terminar». Al cerrarse **no queda nada suyo**: [claveSesion] cambia y con
 * ella se rehacen las pantallas, que es donde viven la búsqueda, el modelo
 * elegido y los resultados.
 */
class Kiosco(val datos: Datos, val alcance: CoroutineScope) {
    sealed interface Pantalla {
        data object Atraccion : Pantalla
        data object Buscar : Pantalla
        data class Resultados(val impresora: Impresora, val busquedaId: String?) : Pantalla
    }

    var pantalla: Pantalla by mutableStateOf(Pantalla.Atraccion)
        private set
    var avisando by mutableStateOf(false)
        private set
    /** Cambia en cada sesión: rehace las pantallas y con eso borra su estado. */
    var claveSesion by mutableIntStateOf(0)
        private set

    val vigilante = Vigilante(alcance) { datos.api.estaVivo() }
    private var sesion: Sesion? = null

    fun empezar() {
        sesion?.parar()
        sesion = Sesion(alcance, alAvisar = { avisando = it }, alCerrar = { cerrarSesion() })
        pantalla = Pantalla.Buscar
    }

    fun tocar() {
        sesion?.tocar()
    }

    fun terminar() {
        sesion?.terminar()
    }

    fun elegir(impresora: Impresora, busquedaId: String?) {
        tocar()
        pantalla = Pantalla.Resultados(impresora, busquedaId)
    }

    fun volverABuscar() {
        tocar()
        pantalla = Pantalla.Buscar
    }

    fun informar(informe: Informe) = vigilante.reportar(informe)

    private fun cerrarSesion() {
        sesion?.parar()
        sesion = null
        avisando = false
        claveSesion += 1
        pantalla = Pantalla.Atraccion
    }
}
