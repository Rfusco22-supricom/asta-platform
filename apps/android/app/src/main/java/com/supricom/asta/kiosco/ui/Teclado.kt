package com.supricom.asta.kiosco.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp

/**
 * Teclado propio del kiosco, para escribir modelos de impresora (#40).
 *
 * ── Por qué no el del sistema ────────────────────────────────────────────────
 *
 * El del sistema tapa media pantalla justo donde salen los resultados, cambia de
 * una tablet a otra, trae emojis, dictado y autocorrección —que convierte
 * «MF4100» en otra cosa— y se cierra si el cliente toca fuera. Un modelo de
 * impresora son letras, números y guiones: con eso, en teclas grandes y siempre
 * en el mismo sitio, basta. Sin minúsculas: los modelos vienen en mayúsculas.
 *
 * QWERTY escalonado, como uno físico: es el que la gente tiene en la cabeza.
 * Las teclas crecen con el hueco, con un tope para que no salgan de un palmo.
 */
private sealed interface Pieza {
    val peso: Float
    data class Letra(val t: String, override val peso: Float = 1f) : Pieza
    data class Hueco(override val peso: Float) : Pieza
    data object Borrar : Pieza { override val peso = 1.5f }
    data object Espacio : Pieza { override val peso = 4f }
    data object Buscar : Pieza { override val peso = 4.5f }
}

private val FILAS: List<List<Pieza>> = listOf(
    "1234567890".map { Pieza.Letra(it.toString()) },
    "QWERTYUIOP".map { Pieza.Letra(it.toString()) },
    listOf(Pieza.Hueco(0.5f)) + "ASDFGHJKL".map { Pieza.Letra(it.toString()) } + Pieza.Hueco(0.5f),
    listOf(Pieza.Hueco(1.5f)) + "ZXCVBNM".map { Pieza.Letra(it.toString()) } + Pieza.Borrar,
    listOf(Pieza.Letra("-", 1.5f), Pieza.Espacio, Pieza.Buscar),
)

private val SEPARACION = 10.dp
private val ALTO_MAXIMO = 88.dp

@Composable
fun Teclado(alEscribir: (String) -> Unit, alBorrar: () -> Unit, alBuscar: () -> Unit, puedeBuscar: Boolean, modifier: Modifier = Modifier) {
    BoxWithConstraints(modifier.fillMaxWidth().heightIn(min = 48.dp * 5 + SEPARACION * 4 + 28.dp, max = ALTO_MAXIMO * 5 + SEPARACION * 4 + 28.dp)) {
        val alto = minOf(ALTO_MAXIMO, (maxHeight - 28.dp - SEPARACION * 4) / 5)
        Column(
            Modifier.fillMaxWidth().background(Tema.tecla, RoundedCornerShape(Tema.radio + 4.dp)).padding(14.dp).align(Alignment.BottomCenter),
            verticalArrangement = Arrangement.spacedBy(SEPARACION),
        ) {
            for (fila in FILAS) {
                Row(Modifier.fillMaxWidth().height(alto), horizontalArrangement = Arrangement.spacedBy(SEPARACION)) {
                    for (pieza in fila) {
                        val m = Modifier.weight(pieza.peso).fillMaxSize()
                        when (pieza) {
                            is Pieza.Letra -> Tecla(pieza.t, if (pieza.t == "-") "Guion" else pieza.t, m) { alEscribir(pieza.t) }
                            is Pieza.Hueco -> Spacer(m)
                            Pieza.Borrar -> Tecla("⌫ Borrar", "Borrar", m, secundaria = true, pequena = true, alPulsar = alBorrar)
                            Pieza.Espacio -> Tecla("espacio", "Espacio", m, secundaria = true, pequena = true) { alEscribir(" ") }
                            Pieza.Buscar -> Pulsable(alBuscar, m.semantics { contentDescription = "Buscar" }, habilitado = puedeBuscar) { pulsado ->
                                Canto(
                                    relleno = if (!puedeBuscar) Color(0xFF9FCDEB) else if (pulsado) Tema.azulHondo else Tema.azul,
                                    canto = if (puedeBuscar) Tema.azulHondo else Color(0xFF8ABFE2),
                                ) { Text("Buscar  →", style = Tema.titulo(28, Tema.superficie)) }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun Tecla(etiqueta: String, accesible: String, modifier: Modifier, secundaria: Boolean = false, pequena: Boolean = false, alPulsar: () -> Unit) {
    Pulsable(alPulsar, modifier.semantics { contentDescription = accesible }) { pulsado ->
        Canto(
            relleno = if (pulsado) Tema.azul else if (secundaria) Color(0xFFD3DCE5) else Tema.superficie,
            canto = if (pulsado) Tema.azulHondo else if (secundaria) Color(0xFFB9C5D1) else Tema.linea,
        ) {
            val color = if (pulsado) Tema.superficie else if (pequena) Tema.tintaSuave else Tema.tinta
            Text(etiqueta, style = if (pequena) Tema.fuerte(20, color) else Tema.codigoFuerte(32, color))
        }
    }
}

/**
 * El canto inferior de una tecla física: sin él, una cuadrícula blanca no se lee
 * como algo que se pulsa.
 */
@Composable
private fun Canto(relleno: Color, canto: Color, contenido: @Composable () -> Unit) {
    Box(Modifier.fillMaxSize().background(canto, RoundedCornerShape(Tema.radio))) {
        Box(Modifier.fillMaxSize().padding(bottom = 4.dp).background(relleno, RoundedCornerShape(Tema.radio)), contentAlignment = Alignment.Center) {
            contenido()
        }
    }
}
