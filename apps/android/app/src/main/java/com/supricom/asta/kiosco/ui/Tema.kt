package com.supricom.asta.kiosco.ui

import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.clickable
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.supricom.asta.kiosco.R
import com.supricom.asta.kiosco.dominio.EstadoStock

/**
 * Identidad visual del kiosco: la misma «Cristal» del panel (`apps/web`), y la
 * misma que `apps/ios/AstaKiosco/Vistas/Tema.swift`.
 *
 * Fondo claro con las luces de la marca (cian del logo, violeta y rosa),
 * tarjetas blancas de esquinas redondeadas y el degradado de la marca en lo que
 * se toca. Sora en los textos y DM Mono en modelos y códigos de cartucho, como
 * vienen impresos en la etiqueta. Fondo claro: en una tienda iluminada se lee
 * mejor que uno oscuro.
 *
 * Se usa DE PIE y a distancia de brazo: el cuerpo base son 24 sp y ningún texto
 * que el cliente tenga que leer baja de 20. Los botones miden 72 dp de alto.
 */
object Tema {
    /** El azul de los botones y lo activo: entre el cian del logo y el azul del degradado. */
    val azul = Color(0xFF2A86F0)
    val azulHondo = Color(0xFF1B63C9)
    val azulSuave = Color(0xFFE6F2FD)
    /** Texto secundario sobre el degradado de marca. */
    val sobreAzul = Color(0xFFE4F1FF)

    val cian = Color(0xFF27A9F1)
    val violeta = Color(0xFF7C5CFF)
    val rosa = Color(0xFFFF5C93)
    /** El degradado de la marca: cian → azul → violeta, en diagonal. */
    val degradado = Brush.linearGradient(listOf(cian, Color(0xFF4F86F7), violeta))
    /** El mismo, un poco más oscuro: un botón pulsado. */
    val degradadoPulsado = Brush.linearGradient(listOf(Color(0xFF1C8CD0), Color(0xFF3C6FE0), Color(0xFF6447E6)))

    val papel = Color(0xFFEDF2F8)
    val superficie = Color.White
    val linea = Color(0xFFDCE5EF)
    val tecla = Color(0xFFE8EEF5)

    val tinta = Color(0xFF0F2236)
    val tintaSuave = Color(0xFF44546A)
    val tintaTenue = Color(0xFF66768B)

    val disponible = Color(0xFF0E8A55)
    val disponibleSuave = Color(0xFFE2F5EC)
    val bajo = Color(0xFF9A6200)
    val bajoSuave = Color(0xFFFFF3DC)
    val agotado = Color(0xFFC8304F)
    val agotadoSuave = Color(0xFFFFE9EE)

    val alturaBoton = 72.dp
    /** Esquinas de vidrio: redondeadas, como las tarjetas del panel. */
    val radio = 18.dp
    /** La sombra larga y suave de las tarjetas. */
    val sombra = Color(0xFF123460)

    private val sora = FontFamily(
        Font(R.font.sora_regular, FontWeight.Normal),
        Font(R.font.sora_medium, FontWeight.Medium),
        Font(R.font.sora_semibold, FontWeight.SemiBold),
        Font(R.font.sora_bold, FontWeight.Bold),
    )
    private val mono = FontFamily(
        Font(R.font.dm_mono_regular, FontWeight.Normal),
        Font(R.font.dm_mono_medium, FontWeight.Medium),
    )

    // En sp, pero la actividad fija la escala de letra a 1: el tamaño del sistema
    // lo puso alguien en una tablet compartida, no el cliente (ver MainActivity).
    fun titulo(t: Int, c: Color = tinta) = TextStyle(fontFamily = sora, fontWeight = FontWeight.Bold, fontSize = t.sp, color = c)
    fun fuerte(t: Int, c: Color = tinta) = TextStyle(fontFamily = sora, fontWeight = FontWeight.SemiBold, fontSize = t.sp, color = c)
    fun medio(t: Int, c: Color = tinta) = TextStyle(fontFamily = sora, fontWeight = FontWeight.Medium, fontSize = t.sp, color = c)
    fun cuerpo(t: Int, c: Color = tinta) = TextStyle(fontFamily = sora, fontWeight = FontWeight.Normal, fontSize = t.sp, color = c)
    fun codigo(t: Int, c: Color = tinta) = TextStyle(fontFamily = mono, fontWeight = FontWeight.Medium, fontSize = t.sp, color = c)
    fun codigoFuerte(t: Int, c: Color = tinta) = TextStyle(fontFamily = mono, fontWeight = FontWeight.Medium, fontSize = t.sp, color = c)
    fun codigoCuerpo(t: Int, c: Color = tinta) = TextStyle(fontFamily = mono, fontWeight = FontWeight.Normal, fontSize = t.sp, color = c)

    fun colores(stock: EstadoStock): Pair<Color, Color> = when (stock) {
        EstadoStock.DISPONIBLE -> disponible to disponibleSuave
        EstadoStock.BAJO -> bajo to bajoSuave
        EstadoStock.AGOTADO -> agotado to agotadoSuave
    }
}

/**
 * El fondo de las pantallas con sesión: el tono base y tres luces difusas de la
 * marca, como el fondo del panel. Son degradados: no cuestan nada.
 */
fun Modifier.fondoCristal(): Modifier = drawBehind {
    drawRect(Tema.papel)
    fun luz(color: Color, x: Float, y: Float, radio: Float) =
        drawCircle(Brush.radialGradient(listOf(color, color.copy(alpha = 0f)), center = Offset(x, y), radius = radio), radio, Offset(x, y))
    luz(Tema.cian.copy(alpha = 0.34f), size.width * 0.04f, -size.height * 0.08f, size.width * 0.5f)
    luz(Tema.violeta.copy(alpha = 0.22f), size.width * 1.02f, size.height * 0.02f, size.width * 0.45f)
    luz(Tema.rosa.copy(alpha = 0.16f), size.width * 0.72f, size.height * 1.1f, size.width * 0.5f)
}

/** Una tarjeta: sombra larga y suave bajo su forma. Va antes del `background`. */
fun Modifier.tarjeta(forma: Shape = RoundedCornerShape(Tema.radio)): Modifier =
    shadow(18.dp, forma, ambientColor = Tema.sombra.copy(alpha = 0.18f), spotColor = Tema.sombra.copy(alpha = 0.22f))

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

