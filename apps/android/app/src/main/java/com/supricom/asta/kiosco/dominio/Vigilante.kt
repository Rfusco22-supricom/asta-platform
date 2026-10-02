package com.supricom.asta.kiosco.dominio

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * Lo que el personal necesita distinguir (#42):
 *   · `CONECTADO`       todo en vivo;
 *   · `SIN_CONEXION`    la tablet no llega al middleware: wifi o servidor;
 *   · `SIN_DATOS_VIVOS` el middleware contesta y el ERP no. Buscar impresoras
 *     sigue funcionando; lo que no se sabe es la existencia.
 */
enum class EstadoConexion { CONECTADO, SIN_CONEXION, SIN_DATOS_VIVOS }

/**
 * Estado de la conexión y reintento en segundo plano (#42). La misma regla que
 * `apps/mobile/src/conexion.ts`: el personal ve siempre si la tablet está
 * conectada, y al volver la red la pantalla se pone al día sola.
 *
 * Se sabe por lo que pasa con las peticiones de verdad ([reportar]), no por el
 * estado del wifi. Mientras algo está caído se comprueba cada 15 s con `/health`;
 * con todo bien no se sondea.
 */
class Vigilante(
    private val alcance: CoroutineScope,
    private val intervaloMs: Long = REINTENTO_MS,
    private val comprobar: suspend () -> Boolean,
) {
    private val _estado = MutableStateFlow(EstadoConexion.CONECTADO)
    val estado: StateFlow<EstadoConexion> = _estado

    private val _recargas = MutableStateFlow(0)
    /** Sube cada vez que vuelve la red: las pantallas lo miran para volver a pedir. */
    val recargas: StateFlow<Int> = _recargas

    private var sondeo: Job? = null

    fun reportar(informe: Informe) = pasarA(
        when (informe) {
            Informe.OK -> EstadoConexion.CONECTADO
            Informe.SIN_RED -> EstadoConexion.SIN_CONEXION
            Informe.SIN_ERP -> EstadoConexion.SIN_DATOS_VIVOS
        },
    )

    fun parar() {
        sondeo?.cancel()
        sondeo = null
    }

    private fun pasarA(nuevo: EstadoConexion) {
        val antes = _estado.value
        if (nuevo == antes) return
        _estado.value = nuevo
        parar()
        if (nuevo != EstadoConexion.CONECTADO) {
            // Con el ERP caído también se sondea: `/health` comprueba Odoo y MySQL.
            sondeo = alcance.launch {
                while (isActive) {
                    delay(intervaloMs)
                    if (comprobar()) {
                        pasarA(EstadoConexion.CONECTADO)
                        return@launch
                    }
                }
            }
        } else {
            _recargas.value += 1
        }
    }

    companion object {
        const val REINTENTO_MS = 15_000L
    }
}
