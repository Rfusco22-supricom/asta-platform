package com.supricom.asta.kiosco.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput

/** La pantalla entera: la que toque según [Kiosco.pantalla], con su barra y el aviso de sesión encima. */
@Composable
fun Raiz(kiosco: Kiosco) {
    val estado by kiosco.vigilante.estado.collectAsState()
    Box(Modifier.fillMaxSize()) {
        when (val p = kiosco.pantalla) {
            Kiosco.Pantalla.Atraccion -> Atraccion(estado) { kiosco.empezar() }
            else -> key(kiosco.claveSesion) {
                Column(
                    Modifier
                        .fillMaxSize()
                        .background(Tema.papel)
                        // Cualquier toque, en cualquier sitio, cuenta como actividad (#41).
                        // En la pasada inicial y sin consumirlo: el botón tocado lo recibe igual.
                        .pointerInput(Unit) {
                            awaitPointerEventScope {
                                while (true) {
                                    awaitPointerEvent(PointerEventPass.Initial)
                                    kiosco.tocar()
                                }
                            }
                        },
                ) {
                    Barra(paso = if (p is Kiosco.Pantalla.Buscar) 1 else 2, estado = estado) { kiosco.terminar() }
                    when (p) {
                        is Kiosco.Pantalla.Resultados -> Resultados(kiosco, p.impresora, p.busquedaId)
                        else -> Buscar(kiosco)
                    }
                }
            }
        }
        AnimatedVisibility(kiosco.avisando, enter = fadeIn(), exit = fadeOut()) {
            AvisoSesion(alSeguir = { kiosco.tocar() }, alTerminar = { kiosco.terminar() })
        }
    }
}
