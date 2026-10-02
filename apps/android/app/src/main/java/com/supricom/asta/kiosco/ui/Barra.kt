package com.supricom.asta.kiosco.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.supricom.asta.kiosco.R
import com.supricom.asta.kiosco.dominio.EstadoConexion
import com.supricom.asta.kiosco.dominio.haceCuanto

/** El logo de Asta, recortado a sus letras (sacado del de `apps/web`), del color que toque. */
@Composable
fun Logo(ancho: Dp, color: Color) {
    Image(
        painterResource(R.drawable.asta_logo),
        contentDescription = "Asta",
        colorFilter = ColorFilter.tint(color),
        modifier = Modifier.width(ancho),
    )
}

/** Logo, «1 Tu impresora › 2 Tu tóner», la conexión y «Terminar». */
@Composable
fun Barra(paso: Int, estado: EstadoConexion, alTerminar: () -> Unit) {
    Column(Modifier.fillMaxWidth().background(Tema.superficie)) {
        BoxWithConstraints(Modifier.fillMaxWidth()) {
            val caben = maxWidth >= 980.dp
            Row(Modifier.fillMaxWidth().padding(horizontal = 40.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                Logo(104.dp, Tema.azul)
                // Los pasos no caben en una pantalla estrecha, y ahí sobran: el
                // título de cada pantalla ya dice dónde se está.
                Box(Modifier.weight(1f), contentAlignment = Alignment.Center) { if (caben) Pasos(paso) }
                IndicadorConexion(estado)
                Spacer(Modifier.width(24.dp))
                BotonTerminar(alTerminar)
            }
        }
        HorizontalDivider(color = Tema.linea)
    }
}

@Composable
private fun Pasos(paso: Int) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        listOf("Tu impresora", "Tu tóner").forEachIndexed { i, nombre ->
            if (i > 0) Text("›", style = Tema.fuerte(28, Tema.tintaTenue))
            val activo = paso == i + 1
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Box(
                    Modifier.size(32.dp)
                        .background(if (activo) Tema.azul else Color.Transparent, CircleShape)
                        .border(2.dp, if (activo) Tema.azul else Tema.linea, CircleShape),
                    contentAlignment = Alignment.Center,
                ) { Text("${i + 1}", style = Tema.codigoFuerte(16, if (activo) Tema.superficie else Tema.tintaTenue)) }
                Text(nombre, style = if (activo) Tema.titulo(20) else Tema.medio(20, Tema.tintaTenue))
            }
        }
    }
}

/**
 * «Terminar», visible en toda pantalla con sesión abierta (#41): el cliente
 * tiene que poder irse dejando la tablet limpia sin esperar cuatro minutos.
 */
@Composable
fun BotonTerminar(alPulsar: () -> Unit) {
    Pulsable(alPulsar, Modifier.semantics { contentDescription = "Terminar y borrar esta consulta" }) { pulsado ->
        Box(
            Modifier.height(Tema.alturaBoton - 8.dp)
                .background(if (pulsado) Tema.tecla else Tema.superficie, RoundedCornerShape(Tema.radio))
                .border(BorderStroke(2.dp, Tema.linea), RoundedCornerShape(Tema.radio))
                .padding(horizontal = 24.dp),
            contentAlignment = Alignment.Center,
        ) { Text("✕  Terminar", style = Tema.fuerte(20, Tema.tintaSuave)) }
    }
}

/**
 * Estado de la conexión, siempre visible (#42). Es para el PERSONAL: si la
 * tablet lleva media mañana sin red, alguien tiene que verlo. En verde casi no
 * se ve; cuando algo falla es una etiqueta de color.
 */
@Composable
fun IndicadorConexion(estado: EstadoConexion, sobreAzul: Boolean = false) {
    val (color, fondo, texto) = when (estado) {
        EstadoConexion.CONECTADO -> Triple(Tema.disponible, Color.Transparent, "En línea")
        EstadoConexion.SIN_CONEXION -> Triple(Tema.agotado, Tema.agotadoSuave, "Sin conexión")
        EstadoConexion.SIN_DATOS_VIVOS -> Triple(Tema.bajo, Tema.bajoSuave, "Sin datos en vivo")
    }
    val enCalma = estado == EstadoConexion.CONECTADO
    Row(
        Modifier.height(40.dp).background(fondo, RoundedCornerShape(Tema.radio)).padding(horizontal = if (enCalma) 0.dp else 16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Box(Modifier.size(12.dp).background(if (enCalma && sobreAzul) Tema.sobreAzul else color, CircleShape))
        Text(
            texto,
            style = if (enCalma) Tema.medio(20, if (sobreAzul) Tema.sobreAzul else Tema.tintaTenue) else Tema.fuerte(20, color),
        )
    }
}

/**
 * «Esto es de hace un rato» (#42). Encima de los datos guardados: el cliente
 * tiene que leerlo ANTES de mirar la existencia.
 */
@Composable
fun AvisoDatosGuardados(guardadoEn: Long) {
    Row(Modifier.fillMaxWidth().background(Tema.bajoSuave, RoundedCornerShape(Tema.radio))) {
        Box(Modifier.width(8.dp).height(96.dp).background(Tema.bajo))
        Column(Modifier.padding(24.dp)) {
            Text("Datos de ${haceCuanto(guardadoEn)}", style = Tema.titulo(20, Tema.bajo))
            Text("Ahora mismo no podemos consultar la existencia. Confírmala en el mostrador.", style = Tema.cuerpo(20))
        }
    }
}
