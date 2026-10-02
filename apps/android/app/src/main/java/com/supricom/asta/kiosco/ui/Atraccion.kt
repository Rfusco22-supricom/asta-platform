package com.supricom.asta.kiosco.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.scale
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.supricom.asta.kiosco.dominio.EstadoConexion
import kotlinx.coroutines.delay

private val EJEMPLOS = listOf(
    "HP LaserJet Professional" to "P1606dn",
    "Canon i-SENSYS" to "MF4570dn",
    "Brother" to "HL-L2350DW",
    "Samsung Xpress" to "M2020W",
)

/**
 * Lo que se ve cuando nadie está usando la tablet (#40).
 *
 * Que alguien que pasa por delante entienda en dos segundos qué hace y la toque:
 * una frase grande, una instrucción, y toda la pantalla es el botón.
 *
 * A la derecha, la placa de una impresora con el modelo marcado, rotando entre
 * marcas. Responde a la duda que de verdad frena a la gente —«¿y cuál es mi
 * modelo?»— y enseña que basta con el código.
 */
@Composable
fun Atraccion(estado: EstadoConexion, alEmpezar: () -> Unit) {
    var indice by remember { mutableIntStateOf(0) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(3_200)
            indice = (indice + 1) % EJEMPLOS.size
        }
    }
    // Un pulso lento en el botón: algo que se mueve se ve desde el pasillo, y
    // lento para que no parezca un anuncio.
    val latido by rememberInfiniteTransition(label = "latido")
        .animateFloat(1f, 1.035f, infiniteRepeatable(tween(1_100), RepeatMode.Reverse), label = "escala")

    Pulsable(alEmpezar, Modifier.fillMaxSize().semantics { contentDescription = "Empezar a buscar tu tóner" }) {
        Box(Modifier.fillMaxSize().background(Tema.azul)) {
            BoxWithConstraints(Modifier.fillMaxSize().padding(horizontal = 64.dp, vertical = 40.dp)) {
                // Proporción fija: con el título largo la izquierda se lo comía todo.
                val separacion = minOf(64.dp, maxWidth * 0.05f)
                val util = maxWidth - separacion
                Row(Modifier.fillMaxSize(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(separacion)) {
                    Column(Modifier.width(util * 0.56f), verticalArrangement = Arrangement.spacedBy(40.dp)) {
                        Logo(210.dp, Tema.superficie)
                        Column(verticalArrangement = Arrangement.spacedBy(24.dp)) {
                            Text("¿Qué tóner necesita tu impresora?", style = Tema.titulo(72, Tema.superficie).copy(lineHeight = 74.sp, letterSpacing = (-1.5).sp))
                            Text(
                                "Escribe el modelo y te decimos cuál le sirve y si lo tenemos en la tienda.",
                                style = Tema.cuerpo(28, Tema.sobreAzul).copy(lineHeight = 36.sp),
                                modifier = Modifier.widthIn(max = 620.dp),
                            )
                        }
                        Row(
                            Modifier.scale(latido).height(Tema.alturaBoton + 16.dp)
                                .background(Tema.superficie, RoundedCornerShape(Tema.radio)).padding(horizontal = 40.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(24.dp),
                        ) {
                            Text("Toca para empezar", style = Tema.titulo(34, Tema.azulHondo))
                            Text("→", style = Tema.titulo(40, Tema.azul))
                        }
                    }
                    Placa(indice, Modifier.width(util * 0.44f))
                }
            }
            Box(Modifier.align(Alignment.TopEnd).padding(top = 16.dp, end = 40.dp)) { IndicadorConexion(estado, sobreAzul = true) }
        }
    }
}

/** El frente de una impresora, con su placa. */
@Composable
private fun Placa(indice: Int, modifier: Modifier) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(24.dp)) {
        Text("DÓNDE ESTÁ TU MODELO", style = Tema.fuerte(18, Tema.sobreAzul).copy(letterSpacing = 2.5.sp))
        Column(
            Modifier.fillMaxWidth()
                .shadow(24.dp, RoundedCornerShape(14.dp), ambientColor = Color(0xFF062E4A), spotColor = Color(0xFF062E4A))
                .background(Color(0xFFE9EEF2), RoundedCornerShape(14.dp)).padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(24.dp),
        ) {
            Box(Modifier.fillMaxWidth().padding(horizontal = 40.dp).height(18.dp).background(Color(0xFFC9D3DC), RoundedCornerShape(9.dp)))
            Box(Modifier.fillMaxWidth().heightIn(min = 150.dp).background(Color(0xFF2A3440), RoundedCornerShape(6.dp)).padding(24.dp), contentAlignment = Alignment.CenterStart) {
                AnimatedContent(indice, transitionSpec = { fadeIn(tween(320)) togetherWith fadeOut(tween(220)) }, label = "ejemplo") { i ->
                    val (linea, modelo) = EJEMPLOS[i]
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(linea, style = Tema.medio(20, Color(0xFFAEB9C4)), maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(
                            modelo,
                            style = Tema.codigo(48, Tema.superficie),
                            maxLines = 1,
                            modifier = Modifier.background(Tema.azul.copy(alpha = 0.18f)).border(4.dp, Tema.azul, RoundedCornerShape(4.dp))
                                .padding(horizontal = 16.dp, vertical = 2.dp),
                        )
                    }
                }
            }
            Box(Modifier.fillMaxWidth().padding(horizontal = 64.dp).height(14.dp).background(Color(0xFF1D252E), RoundedCornerShape(7.dp)))
        }
        Text("Suele estar impreso en el frente o en la tapa. Basta con las letras y los números.", style = Tema.cuerpo(20, Tema.sobreAzul))
    }
}
