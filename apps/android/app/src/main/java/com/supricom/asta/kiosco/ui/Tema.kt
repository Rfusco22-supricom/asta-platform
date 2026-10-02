package com.supricom.asta.kiosco.ui

import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.clickable
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.supricom.asta.kiosco.R
import com.supricom.asta.kiosco.dominio.EstadoStock

/**
 * Identidad visual del kiosco (#40). La misma que
 * `apps/ios/AstaKiosco/Vistas/Tema.swift`.
 *
 * Del logo de Asta: el azul (#0E8FDA) y sus letras de trazo grueso, cortes
 * rectos y esquinas apenas redondeadas. Archivo en los títulos y JetBrains Mono
 * en modelos y códigos de cartucho, como vienen impresos en la etiqueta. Fondo
 * claro: en una tienda iluminada se lee mejor que uno oscuro.
 *
 * Se usa DE PIE y a distancia de brazo: el cuerpo base son 24 sp y ningún texto
 * que el cliente tenga que leer baja de 20. Los botones miden 72 dp de alto.
 */
object Tema {
    val azul = Color(0xFF0E8FDA)
    val azulHondo = Color(0xFF0A6FAD)
    val azulSuave = Color(0xFFE3F2FC)
    /** Texto secundario sobre el azul de marca. */
    val sobreAzul = Color(0xFFCFEAFB)

    val papel = Color(0xFFF2F5F8)
    val superficie = Color.White
    val linea = Color(0xFFD8E0E8)
    val tecla = Color(0xFFE6ECF2)

    val tinta = Color(0xFF0B1F33)
    val tintaSuave = Color(0xFF46596B)
    val tintaTenue = Color(0xFF7E8E9E)

    val disponible = Color(0xFF12805C)
    val disponibleSuave = Color(0xFFE2F4EC)
    val bajo = Color(0xFF9A5800)
    val bajoSuave = Color(0xFFFDF0D9)
    val agotado = Color(0xFFB42318)
    val agotadoSuave = Color(0xFFFCE9E7)

    val alturaBoton = 72.dp
    /** Esquinas cortas, como las del logo. */
    val radio = 6.dp

    private val archivo = FontFamily(
        Font(R.font.archivo_medium, FontWeight.Medium),
        Font(R.font.archivo_semibold, FontWeight.SemiBold),
        Font(R.font.archivo_bold, FontWeight.Bold),
        Font(R.font.archivo_extrabold, FontWeight.ExtraBold),
    )
    private val mono = FontFamily(
        Font(R.font.jetbrains_mono_medium, FontWeight.Medium),
        Font(R.font.jetbrains_mono_bold, FontWeight.Bold),
        Font(R.font.jetbrains_mono_extrabold, FontWeight.ExtraBold),
    )

    // En sp, pero la actividad fija la escala de letra a 1: el tamaño del sistema
    // lo puso alguien en una tablet compartida, no el cliente (ver MainActivity).
    fun titulo(t: Int, c: Color = tinta) = TextStyle(fontFamily = archivo, fontWeight = FontWeight.ExtraBold, fontSize = t.sp, color = c)
    fun fuerte(t: Int, c: Color = tinta) = TextStyle(fontFamily = archivo, fontWeight = FontWeight.Bold, fontSize = t.sp, color = c)
    fun medio(t: Int, c: Color = tinta) = TextStyle(fontFamily = archivo, fontWeight = FontWeight.SemiBold, fontSize = t.sp, color = c)
    fun cuerpo(t: Int, c: Color = tinta) = TextStyle(fontFamily = archivo, fontWeight = FontWeight.Medium, fontSize = t.sp, color = c)
    fun codigo(t: Int, c: Color = tinta) = TextStyle(fontFamily = mono, fontWeight = FontWeight.ExtraBold, fontSize = t.sp, color = c)
    fun codigoFuerte(t: Int, c: Color = tinta) = TextStyle(fontFamily = mono, fontWeight = FontWeight.Bold, fontSize = t.sp, color = c)
    fun codigoCuerpo(t: Int, c: Color = tinta) = TextStyle(fontFamily = mono, fontWeight = FontWeight.Medium, fontSize = t.sp, color = c)

    fun colores(stock: EstadoStock): Pair<Color, Color> = when (stock) {
        EstadoStock.DISPONIBLE -> disponible to disponibleSuave
        EstadoStock.BAJO -> bajo to bajoSuave
        EstadoStock.AGOTADO -> agotado to agotadoSuave
    }
}

/**
 * Un objetivo táctil sin la onda de Material: con el nuestro. `contenido` recibe
 * si está pulsado, y ese es todo el estado visual del botón.
 */
@Composable
fun Pulsable(
    alPulsar: () -> Unit,
    modifier: Modifier = Modifier,
    habilitado: Boolean = true,
    descripcion: String? = null,
    contenido: @Composable (pulsado: Boolean) -> Unit,
) {
    val interaccion = remember { MutableInteractionSource() }
    val pulsado = interaccion.collectIsPressedAsState().value
    androidx.compose.foundation.layout.Box(
        modifier.clickable(interactionSource = interaccion, indication = null, enabled = habilitado, onClickLabel = descripcion, onClick = alPulsar),
    ) { contenido(pulsado && habilitado) }
}

