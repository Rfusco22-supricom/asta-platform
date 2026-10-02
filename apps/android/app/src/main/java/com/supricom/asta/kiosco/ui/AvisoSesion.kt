package com.supricom.asta.kiosco.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.supricom.asta.kiosco.dominio.Sesion
import kotlinx.coroutines.delay

/**
 * «¿Sigues ahí?», 30 segundos antes de cerrar la sesión (#41).
 *
 * Tapa la pantalla a propósito: si el cliente está leyendo y no ve el aviso, se
 * le cierra la sesión mientras compara dos tóners y parece una avería. El botón
 * grande es el de seguir: cerrar ya ocurre solo.
 *
 * La cuenta atrás es solo para la vista: quien cierra es [Sesion].
 */
@Composable
fun AvisoSesion(alSeguir: () -> Unit, alTerminar: () -> Unit) {
    var quedan by remember { mutableIntStateOf((Sesion.AVISO_ANTES_MS / 1000).toInt()) }
    LaunchedEffect(Unit) {
        while (quedan > 0) {
            delay(1_000)
            quedan -= 1
        }
    }
    // Encima de todo y recogiendo los toques: lo de debajo no se puede tocar.
    Box(Modifier.fillMaxSize().background(Tema.tinta.copy(alpha = 0.72f)).padding(40.dp), contentAlignment = Alignment.Center) {
        Column(
            Modifier.widthIn(max = 760.dp).fillMaxWidth().background(Tema.superficie, RoundedCornerShape(Tema.radio)),
        ) {
            Box(Modifier.fillMaxWidth().height(10.dp).background(Tema.azul, RoundedCornerShape(topStart = Tema.radio, topEnd = Tema.radio)))
            Column(Modifier.padding(40.dp), verticalArrangement = Arrangement.spacedBy(40.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(40.dp)) {
                    Box(Modifier.size(128.dp).border(8.dp, Tema.azul, CircleShape), contentAlignment = Alignment.Center) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Text("$quedan", style = Tema.codigo(52))
                            Text("seg", style = Tema.medio(16, Tema.tintaTenue))
                        }
                    }
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("¿Sigues ahí?", style = Tema.titulo(40))
                        Text("Vamos a cerrar esta consulta para dejar la tablet libre.", style = Tema.cuerpo(24, Tema.tintaSuave))
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    Pulsable(alTerminar, Modifier.weight(1f)) { pulsado ->
                        Box(
                            Modifier.fillMaxWidth().height(Tema.alturaBoton)
                                .background(if (pulsado) Tema.tecla else Color.Transparent, RoundedCornerShape(Tema.radio))
                                .border(BorderStroke(2.dp, Tema.linea), RoundedCornerShape(Tema.radio)),
                            contentAlignment = Alignment.Center,
                        ) { Text("Ya terminé", style = Tema.fuerte(24, Tema.tintaSuave)) }
                    }
                    Pulsable(alSeguir, Modifier.weight(2f)) { pulsado ->
                        Box(
                            Modifier.fillMaxWidth().height(Tema.alturaBoton).background(if (pulsado) Tema.azulHondo else Tema.azul, RoundedCornerShape(Tema.radio)),
                            contentAlignment = Alignment.Center,
                        ) { Text("Sigo aquí", style = Tema.titulo(28, Tema.superficie)) }
                    }
                }
            }
        }
    }
}
