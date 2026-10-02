package com.supricom.asta.kiosco.dominio

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * La sesión de un cliente frente a la tablet (#41). La misma regla que
 * `apps/mobile/src/sesion.ts`.
 *
 * La tablet es un dispositivo COMPARTIDO: lo que quedó en pantalla es de la
 * persona anterior. Por eso la sesión se cierra sola, y al cerrarse no queda
 * nada suyo en pantalla.
 *
 * Dos relojes: a los 3:30 sin tocar aparece el aviso con «Sigo aquí»; a los
 * 4:00, se cierra. Cerrarle la sesión sin aviso a alguien que está comparando
 * dos tóners parece una avería. Cualquier toque reinicia los dos.
 *
 * Con corrutinas: los tests prueban los cuatro minutos con tiempo virtual.
 */
class Sesion(
    private val alcance: CoroutineScope,
    private val duracionMs: Long = DURACION_MS,
    private val avisoAntesMs: Long = AVISO_ANTES_MS,
    private val alAvisar: (Boolean) -> Unit,
    private val alCerrar: (Motivo) -> Unit,
) {
    enum class Motivo { TIMEOUT, LOGOUT }

    private var reloj: Job? = null
    private var avisando = false
    var viva = true
        private set

    init {
        armar()
    }

    /** Cada interacción del cliente. «Sigo aquí» es un toque como otro. */
    fun tocar() {
        if (!viva) return
        ocultarAviso()
        armar()
    }

    /** El cliente cierra a mano con «Terminar». */
    fun terminar() {
        if (!viva) return
        acabar()
        alCerrar(Motivo.LOGOUT)
    }

    /** Se acabó la sesión desde fuera, sin avisar a nadie. */
    fun parar() = acabar()

    private fun acabar() {
        viva = false
        reloj?.cancel()
        ocultarAviso()
    }

    private fun ocultarAviso() {
        if (!avisando) return
        avisando = false
        alAvisar(false)
    }

    private fun armar() {
        reloj?.cancel()
        val hastaAviso = maxOf(0L, duracionMs - avisoAntesMs)
        reloj = alcance.launch {
            delay(hastaAviso)
            if (!viva) return@launch
            avisando = true
            alAvisar(true)
            delay(duracionMs - hastaAviso)
            if (!viva) return@launch
            acabar()
            alCerrar(Motivo.TIMEOUT)
        }
    }

    companion object {
        const val DURACION_MS = 4 * 60_000L
        const val AVISO_ANTES_MS = 30_000L
    }
}
