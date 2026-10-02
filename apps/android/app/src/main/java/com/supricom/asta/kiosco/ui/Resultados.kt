package com.supricom.asta.kiosco.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.supricom.asta.kiosco.dominio.ConCache
import com.supricom.asta.kiosco.dominio.EstadoStock
import com.supricom.asta.kiosco.dominio.Impresora
import com.supricom.asta.kiosco.dominio.MotivoFallo
import com.supricom.asta.kiosco.dominio.ProductoCompatible
import com.supricom.asta.kiosco.dominio.codigosDeCartucho
import com.supricom.asta.kiosco.dominio.esAsta
import com.supricom.asta.kiosco.dominio.esPolvo
import com.supricom.asta.kiosco.dominio.ordenarParaRecomendar
import com.supricom.asta.kiosco.dominio.recomendado
import com.supricom.asta.kiosco.dominio.texto
import com.supricom.asta.kiosco.dominio.titulo

/**
 * Qué le sirve a la impresora del cliente, y si lo hay aquí (#40, sobre #39).
 *
 * Solo salen compatibilidades verificadas por una persona; de eso se encarga el
 * servidor. De arriba abajo: la respuesta corta, el código del cartucho; las
 * opciones, lo que hay en tienda primero; y al tocar una, el pie dice qué pedir
 * en el mostrador, para que el dependiente no tenga que adivinar cuál.
 *
 * Sin precios: la tarifa del cliente es #31. Decirlos mal en piso de venta es
 * peor que no decirlos.
 */
private sealed interface EstadoResultados {
    data object Cargando : EstadoResultados
    data class Listo(val productos: List<ProductoCompatible>, val guardadoEn: Long?) : EstadoResultados
    data class Fallo(val texto: String) : EstadoResultados
}

@Composable
fun Resultados(kiosco: Kiosco, impresora: Impresora, busquedaId: String?) {
    var estado by remember { mutableStateOf<EstadoResultados>(EstadoResultados.Cargando) }
    var elegido by remember { mutableStateOf<Int?>(null) }
    val recargas by kiosco.vigilante.recargas.collectAsState()

    // `recargas` cambia cuando vuelve la red: se vuelve a pedir lo mismo, en vivo (#42).
    LaunchedEffect(impresora.id, recargas) {
        estado = when (val r = kiosco.datos.compatibles(impresora.id, busquedaId, kiosco::informar)) {
            is ConCache.Ok -> EstadoResultados.Listo(ordenarParaRecomendar(r.datos), r.guardadoEn)
            is ConCache.Fallo -> EstadoResultados.Fallo(
                if (r.motivo == MotivoFallo.RED || r.motivo == MotivoFallo.ERP) {
                    "Ahora mismo no podemos consultar esta impresora, y no la habíamos consultado antes. Pregunta en el mostrador."
                } else {
                    "No pudimos consultarlo ahora mismo."
                },
            )
        }
    }

    Column(Modifier.fillMaxSize().padding(start = 40.dp, end = 40.dp, top = 8.dp, bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(24.dp)) {
        Cabecera(impresora) { kiosco.volverABuscar() }
        when (val e = estado) {
            EstadoResultados.Cargando -> Box(Modifier.fillMaxWidth().padding(top = 64.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = Tema.azul) }
            is EstadoResultados.Fallo -> Text(e.texto, style = Tema.fuerte(24, Tema.bajo), modifier = Modifier.padding(top = 40.dp))
            is EstadoResultados.Listo -> if (e.productos.isEmpty()) {
                e.guardadoEn?.let { AvisoDatosGuardados(it) }
                SinTonerCargado(impresora)
            } else {
                val sugerido = recomendado(e.productos)
                Row(Modifier.fillMaxSize(), horizontalArrangement = Arrangement.spacedBy(40.dp)) {
                    Respuesta(e.productos, sugerido, impresora)
                    Column(Modifier.weight(1f).fillMaxHeight(), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                        LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                            e.guardadoEn?.let { g -> item { AvisoDatosGuardados(g) } }
                            items(e.productos, key = { it.id }) { p ->
                                Etiqueta(p, impresora, p.id == elegido, recomendado = p.id == sugerido?.id) {
                                    // Sin conexión no se registra: el clic se perdería y no merece
                                    // una cola que sobreviva a la sesión (#41).
                                    if (e.guardadoEn == null && p.id != elegido) kiosco.datos.api.registrarClic(kiosco.alcance, busquedaId, p.id)
                                    elegido = p.id
                                }
                            }
                        }
                        Pie(e.productos.firstOrNull { it.id == elegido }, impresora)
                    }
                }
            }
        }
    }
}

@Composable
private fun Cabecera(impresora: Impresora, alVolver: () -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(24.dp)) {
        Pulsable(alVolver, Modifier.semantics { contentDescription = "Buscar otra impresora" }) { pulsado ->
            Box(
                Modifier.height(Tema.alturaBoton - 8.dp)
                    .background(if (pulsado) Tema.azulSuave else Tema.superficie, RoundedCornerShape(Tema.radio))
                    .border(BorderStroke(2.dp, Tema.azul), RoundedCornerShape(Tema.radio)).padding(horizontal = 24.dp),
                contentAlignment = Alignment.Center,
            ) { Text("‹ Buscar otra", style = Tema.titulo(20, Tema.azulHondo)) }
        }
        Column {
            Text("PARA TU IMPRESORA", style = Tema.fuerte(18, Tema.tintaTenue).copy(letterSpacing = 1.5.sp))
            Text(
                buildAnnotatedString {
                    withStyle(Tema.titulo(40, Tema.tintaSuave).toSpanStyle()) { append(impresora.marca + " ") }
                    withStyle(Tema.codigo(40).toSpanStyle()) { append(impresora.nombre) }
                },
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

/** La respuesta corta, a la izquierda: no se mueve al desplazar la lista. */
@Composable
private fun Respuesta(productos: List<ProductoCompatible>, sugerido: ProductoCompatible?, impresora: Impresora) {
    val codigos = codigosDeCartucho(productos)
    val enTienda = productos.count { it.stock != EstadoStock.AGOTADO }
    Column(Modifier.width(340.dp).background(Tema.azul, RoundedCornerShape(Tema.radio)).padding(24.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(if (codigos.size == 1) "USA EL CARTUCHO" else "USA LOS CARTUCHOS", style = Tema.fuerte(16, Tema.sobreAzul).copy(letterSpacing = 2.5.sp))
        codigos.forEach { Text(it, style = Tema.codigo(56, Tema.superficie), maxLines = 1) }
        Box(Modifier.padding(vertical = 8.dp).fillMaxWidth().height(2.dp).background(Color.White.copy(alpha = 0.28f)))
        Text(
            buildAnnotatedString {
                withStyle(Tema.titulo(20, Tema.superficie).toSpanStyle()) { append("${productos.size} ${if (productos.size == 1) "opción" else "opciones"}") }
                append(if (enTienda > 0) " · $enTienda en tienda" else " · ninguna en tienda ahora: se puede encargar")
            },
            style = Tema.cuerpo(20, Tema.sobreAzul),
        )
        // Lo que la tienda quiere vender, dicho donde el cliente mira primero.
        if (sugerido != null) {
            Column(
                Modifier.padding(top = 16.dp).fillMaxWidth().background(Tema.superficie, RoundedCornerShape(Tema.radio)).padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Text("TE RECOMENDAMOS", style = Tema.fuerte(14, Tema.azulHondo).copy(letterSpacing = 2.sp))
                Text(sugerido.titulo(impresora), style = Tema.titulo(22))
                Text(sugerido.stock.texto, style = Tema.fuerte(18, Tema.disponible))
            }
        }
    }
}

@Composable
private fun Pie(elegido: ProductoCompatible?, impresora: Impresora) {
    Column(Modifier.fillMaxWidth().heightIn(min = 56.dp)) {
        val color = if (elegido == null) Tema.linea else Tema.azul
        Canvas(Modifier.fillMaxWidth().height(2.dp)) {
            drawLine(color, Offset(0f, size.height / 2), Offset(size.width, size.height / 2), strokeWidth = size.height, pathEffect = PathEffect.dashPathEffect(floatArrayOf(12f, 8f)))
        }
        if (elegido != null) {
            Text(
                buildAnnotatedString {
                    append("Enseña esta pantalla en el mostrador y pide ")
                    withStyle(SpanStyle(fontFamily = Tema.codigo(20).fontFamily, fontWeight = Tema.codigo(20).fontWeight, color = Tema.azulHondo)) {
                        append(elegido.sku ?: elegido.titulo(impresora))
                    }
                },
                style = Tema.medio(20),
                modifier = Modifier.padding(top = 16.dp),
            )
        } else {
            Text("Toca el que quieras llevarte y enséñale la pantalla al mostrador.", style = Tema.medio(20, Tema.tintaSuave), modifier = Modifier.padding(top = 16.dp))
        }
    }
}

/**
 * Pasa con las impresoras que vendemos y cuyo tóner aún no se ha validado: el
 * kiosco las encuentra, pero no recomienda nada sin verificar. Que se lea como
 * un paso, no como un error.
 */
@Composable
private fun SinTonerCargado(impresora: Impresora) {
    Row(Modifier.padding(top = 24.dp).widthIn(max = 820.dp).height(IntrinsicSize.Min).background(Tema.superficie, RoundedCornerShape(Tema.radio))) {
        Box(Modifier.width(10.dp).fillMaxHeight().background(Tema.azul))
        Column(Modifier.padding(40.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Text("TE AYUDAMOS EN EL MOSTRADOR", style = Tema.fuerte(16, Tema.azulHondo).copy(letterSpacing = 2.5.sp))
            Text("Aún no tenemos cargado en el kiosco qué tóner le sirve a esta impresora.", style = Tema.titulo(28))
            Text(
                buildAnnotatedString {
                    append("Enseña esta pantalla en el mostrador y te decimos cuál es y si lo tenemos: ")
                    withStyle(Tema.codigoFuerte(24).toSpanStyle()) { append("${impresora.marca} ${impresora.nombre}") }
                },
                style = Tema.cuerpo(24, Tema.tintaSuave),
            )
        }
    }
}

/** Un producto, con la forma de la etiqueta de una caja de tóner. */
@Composable
private fun Etiqueta(p: ProductoCompatible, impresora: Impresora, elegido: Boolean, recomendado: Boolean, alPulsar: () -> Unit) {
    val (color, fondo) = Tema.colores(p.stock)
    Pulsable(alPulsar, Modifier.fillMaxWidth().semantics { contentDescription = "${p.titulo(impresora)}, ${p.stock.texto}" }) { pulsado ->
        Row(
            Modifier.fillMaxWidth().height(IntrinsicSize.Min).heightIn(min = 112.dp)
                .background(if ((pulsado && !elegido) || recomendado) Tema.azulSuave else Tema.superficie, RoundedCornerShape(Tema.radio))
                .border(3.dp, if (elegido) Tema.azul else Color.Transparent, RoundedCornerShape(Tema.radio)),
        ) {
            Box(Modifier.width(10.dp).fillMaxHeight().background(color))
            Column(
                Modifier.weight(1f).padding(horizontal = 24.dp, vertical = 16.dp).alpha(if (p.stock == EstadoStock.AGOTADO) 0.62f else 1f),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    // El que la tienda recomienda (`recomendado`): sello y fondo propios.
                    if (recomendado) Sello("★ RECOMENDADO", Tema.superficie, fondo = Tema.azulHondo)
                    if (p.esAsta) {
                        Sello("ASTA", Tema.superficie, fondo = Tema.azul)
                    } else {
                        Sello(if (p.tipo == ProductoCompatible.Tipo.ORIGINAL) "ORIGINAL" else "COMPATIBLE", Tema.tinta, borde = Tema.tinta)
                    }
                    if (p.esPolvo) Sello("PARA RECARGAR", Tema.tintaSuave, fondo = Tema.tecla)
                }
                Text(p.titulo(impresora), style = Tema.titulo(24), maxLines = 1)
                Text(p.nombre, style = Tema.codigoCuerpo(16, Tema.tintaTenue), maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Column(Modifier.width(220.dp).fillMaxHeight().background(fondo), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
                Text(p.stock.texto, style = Tema.titulo(20, color))
                if (elegido) Text("✓ Elegido", style = Tema.fuerte(16, Tema.azulHondo))
            }
        }
    }
}

@Composable
private fun Sello(texto: String, color: Color, fondo: Color = Color.Transparent, borde: Color? = null) {
    Text(
        texto,
        style = Tema.titulo(14, color).copy(letterSpacing = 1.5.sp),
        modifier = Modifier.background(fondo, RoundedCornerShape(3.dp))
            .then(if (borde != null) Modifier.border(2.dp, borde, RoundedCornerShape(3.dp)) else Modifier)
            .padding(horizontal = 8.dp, vertical = 2.dp),
    )
}
