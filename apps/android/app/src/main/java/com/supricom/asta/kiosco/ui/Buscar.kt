package com.supricom.asta.kiosco.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.min
import com.supricom.asta.kiosco.dominio.Busqueda
import com.supricom.asta.kiosco.dominio.ConCache
import com.supricom.asta.kiosco.dominio.Impresora
import com.supricom.asta.kiosco.dominio.MotivoFallo
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Buscar la impresora del cliente (#40, sobre la búsqueda de #38).
 *
 * ── Dos momentos, una pantalla ───────────────────────────────────────────────
 *
 * Arriba, a todo lo ancho, lo que se escribe. Debajo, una de dos cosas:
 * ESCRIBIENDO, el teclado del kiosco; ELIGIENDO, lo encontrado, en el sitio del
 * teclado y a dos columnas si cabe. Tocar el campo vuelve a sacar el teclado.
 *
 * Se busca al pulsar «Buscar» y no a cada tecla: buscar al teclear manda una
 * petición por pulsación y deja la lista saltando debajo del dedo.
 *
 * Cuando no hay coincidencias, la API devuelve parecidos aparte. Se PREGUNTA
 * («¿quisiste decir…?»), nunca se afirma: darle por bueno un modelo parecido es
 * venderle al cliente un tóner que no le entra.
 */
private sealed interface EstadoBusqueda {
    data object Vacio : EstadoBusqueda
    data object Buscando : EstadoBusqueda
    data class Resultados(val b: Busqueda, val consulta: String, val guardadoEn: Long?) : EstadoBusqueda
    data class Error(val motivo: MotivoFallo) : EstadoBusqueda
}

/** Ningún modelo se acerca a esto; más es alguien apoyado en el teclado. */
private const val MAX_LARGO = 24

@Composable
fun Buscar(kiosco: Kiosco) {
    var texto by remember { mutableStateOf("") }
    var estado by remember { mutableStateOf<EstadoBusqueda>(EstadoBusqueda.Vacio) }
    val escribiendo = estado == EstadoBusqueda.Vacio
    val puedeBuscar = texto.trim().length >= 2

    fun corregir() {
        estado = EstadoBusqueda.Vacio
    }

    fun buscar() {
        val consulta = texto.trim()
        if (consulta.length < 2) return
        kiosco.tocar()
        estado = EstadoBusqueda.Buscando
        kiosco.alcance.launch {
            estado = when (val r = kiosco.datos.buscar(consulta, kiosco::informar)) {
                is ConCache.Ok -> EstadoBusqueda.Resultados(r.datos, consulta, r.guardadoEn)
                is ConCache.Fallo -> EstadoBusqueda.Error(r.motivo)
            }
        }
    }

    BoxWithConstraints(Modifier.fillMaxSize().padding(start = 40.dp, end = 40.dp, top = 16.dp, bottom = 24.dp)) {
        val ancho = maxWidth
        val alto = maxHeight
        Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Text("¿Qué impresora tienes?", style = Tema.titulo(34))
            Campo(texto, ancho.value, alto.value, escribiendo, alTocar = ::corregir, alLimpiar = { texto = ""; corregir() })
            if (escribiendo) {
                // En una tablet baja el consejo le quitaría al teclado el alto que necesita.
                if (alto >= 560.dp) {
                    Text(
                        buildAnnotatedString {
                            append("Basta con las letras y los números: ")
                            withStyle(SpanStyle(fontFamily = Tema.codigoFuerte(18).fontFamily, fontWeight = Tema.codigoFuerte(18).fontWeight, color = Tema.tinta)) { append("P1606") }
                            append(", no «LaserJet Professional P1606dn». No importan guiones ni espacios.")
                        },
                        style = Tema.cuerpo(18, Tema.tintaSuave),
                    )
                }
                Spacer(Modifier.weight(1f))
                // El teclado abajo: es donde llega la mano de alguien de pie delante de un soporte.
                Teclado(
                    alEscribir = { letra ->
                        if (texto.length < MAX_LARGO && !(letra == " " && (texto.isEmpty() || texto.endsWith(" ")))) texto += letra
                    },
                    alBorrar = { texto = texto.dropLast(1) },
                    alBuscar = ::buscar,
                    puedeBuscar = puedeBuscar,
                )
            } else {
                Lista(estado, columnas = if (ancho >= 900.dp) 2 else 1, kiosco, ::corregir)
            }
        }
    }
}

/**
 * Lo escrito, en grande y en la letra de la placa, con su cursor. El tamaño sigue
 * a la pantalla: el modelo tiene que leerse desde un paso atrás en una tablet de
 * 8" y en una de 13".
 */
@Composable
private fun Campo(texto: String, ancho: Float, alto: Float, escribiendo: Boolean, alTocar: () -> Unit, alLimpiar: () -> Unit) {
    val letra = minOf(56f, maxOf(34f, minOf(ancho * 0.042f, alto * 0.08f))).toInt()
    var cursor by remember { mutableStateOf(true) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(530)
            cursor = !cursor
        }
    }
    val descripcion = if (texto.isEmpty()) "Modelo de la impresora, vacío" else "Modelo: $texto" + if (escribiendo) "" else ". Toca para corregir"
    Pulsable(alTocar, Modifier.fillMaxWidth().semantics { contentDescription = descripcion }) {
        Row(
            Modifier.fillMaxWidth().height((letra * 2).dp)
                .background(Tema.superficie, RoundedCornerShape(Tema.radio))
                .border(3.dp, if (escribiendo) Tema.azul else Tema.linea, RoundedCornerShape(Tema.radio))
                .padding(start = 24.dp, end = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (texto.isNotEmpty()) Text(texto, style = Tema.codigo(letra), maxLines = 1)
            if (escribiendo) Box(Modifier.padding(start = 3.dp).width(4.dp).height((letra * 1.1f).dp).alpha(if (cursor) 1f else 0f).background(Tema.azul, RoundedCornerShape(2.dp)))
            if (texto.isEmpty()) Text("P1606, MF4100, HL-2350…", style = Tema.codigoCuerpo((letra * 0.6f).toInt(), Tema.tintaTenue), modifier = Modifier.padding(start = 16.dp))
            Spacer(Modifier.weight(1f))
            if (!escribiendo) {
                Text("✎ Corregir", style = Tema.titulo(20, Tema.azulHondo), modifier = Modifier.padding(horizontal = 16.dp))
            } else if (texto.isNotEmpty()) {
                Pulsable(alLimpiar, Modifier.semantics { contentDescription = "Borrar todo" }) { pulsado ->
                    Box(Modifier.size(72.dp).background(if (pulsado) Tema.tecla else Color.Transparent, RoundedCornerShape(Tema.radio)), contentAlignment = Alignment.Center) {
                        Text("✕", style = Tema.fuerte(32, Tema.tintaTenue))
                    }
                }
            }
        }
    }
}

@Composable
private fun Lista(estado: EstadoBusqueda, columnas: Int, kiosco: Kiosco, alCorregir: () -> Unit) {
    when (estado) {
        EstadoBusqueda.Vacio -> Unit
        EstadoBusqueda.Buscando -> Box(Modifier.fillMaxWidth().padding(top = 64.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = Tema.azul) }
        is EstadoBusqueda.Error -> Mensaje("No pudimos buscar", textoDe(estado.motivo), alCorregir, aviso = true)
        is EstadoBusqueda.Resultados -> {
            val b = estado.b
            val opciones = b.impresoras.ifEmpty { b.sugerencias }
            val sonSugerencias = b.impresoras.isEmpty() && b.sugerencias.isNotEmpty()
            if (opciones.isEmpty()) {
                Mensaje("No encontramos «${estado.consulta}»", "Revisa el modelo en la impresora y corrígelo, o pregunta en el mostrador: lo buscamos por ti.", alCorregir)
                return
            }
            Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                estado.guardadoEn?.let { AvisoDatosGuardados(it) }
                Text(
                    when {
                        sonSugerencias -> "¿Quisiste decir…?"
                        opciones.size == 1 -> "Toca tu impresora"
                        else -> "${opciones.size} impresoras · toca la tuya"
                    },
                    style = Tema.fuerte(20, Tema.tintaSuave),
                )
                LazyVerticalGrid(GridCells.Fixed(columnas), horizontalArrangement = Arrangement.spacedBy(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    items(opciones, key = { it.id }) { i -> OpcionImpresora(i, sonSugerencias) { kiosco.elegir(i, b.busquedaId) } }
                }
            }
        }
    }
}

private fun textoDe(motivo: MotivoFallo) = when (motivo) {
    MotivoFallo.RED -> "Sin conexión, y esta impresora no la habíamos consultado antes. Pregunta en el mostrador."
    MotivoFallo.ERP -> "Ahora mismo no podemos consultar esta impresora. Pregunta en el mostrador."
    MotivoFallo.PERMISO -> "Esta tablet no está autorizada. Avisa a alguien del mostrador."
    MotivoFallo.SERVIDOR -> "Algo falló de nuestro lado. Inténtalo otra vez."
}

@Composable
private fun OpcionImpresora(impresora: Impresora, sugerida: Boolean, alPulsar: () -> Unit) {
    Pulsable(alPulsar, Modifier.fillMaxWidth().semantics { contentDescription = "${impresora.marca} ${impresora.nombre}" }) { pulsado ->
        Row(
            Modifier.fillMaxWidth().heightIn(min = Tema.alturaBoton + 24.dp).background(if (pulsado) Tema.azulSuave else Tema.superficie, RoundedCornerShape(Tema.radio)),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.width(8.dp).height(Tema.alturaBoton + 24.dp).background(if (sugerida) Tema.tintaTenue else Tema.azul))
            Column(Modifier.weight(1f).padding(horizontal = 24.dp, vertical = 16.dp)) {
                Text(impresora.marca.uppercase(), style = Tema.fuerte(18, Tema.tintaTenue))
                Text(impresora.nombre, style = Tema.codigo(36), maxLines = 1)
            }
            Text("›", style = Tema.fuerte(52, Tema.azul), modifier = Modifier.padding(end = 24.dp))
        }
    }
}

@Composable
fun Mensaje(titulo: String, texto: String, alCorregir: () -> Unit, aviso: Boolean = false) {
    Column(Modifier.padding(top = 24.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(titulo, style = Tema.titulo(28, if (aviso) Tema.bajo else Tema.tinta))
        Text(texto, style = Tema.cuerpo(20, Tema.tintaSuave), modifier = Modifier.widthIn(max = 760.dp))
        Pulsable(alCorregir, Modifier.padding(top = 16.dp)) { pulsado ->
            Box(
                Modifier.height(Tema.alturaBoton).background(if (pulsado) Tema.azulHondo else Tema.azul, RoundedCornerShape(Tema.radio)).padding(horizontal = 40.dp),
                contentAlignment = Alignment.Center,
            ) { Text("Corregir el modelo", style = Tema.titulo(24, Tema.superficie)) }
        }
    }
}
