package com.supricom.asta.kiosco.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import com.supricom.asta.kiosco.dominio.Activacion
import com.supricom.asta.kiosco.dominio.ResultadoActivacion
import com.supricom.asta.kiosco.dominio.normalizarCodigo
import kotlinx.coroutines.launch

/**
 * La pantalla de una tablet sin vincular: pide el código de 6 dígitos que da el
 * panel (Tablets → «Añadir tablet»), escribiéndolo o escaneando su QR. La
 * pareja de `Vistas/ActivacionView.swift` en iOS.
 *
 * La ve el personal de la tienda, una vez, al instalar la tablet; nunca un
 * cliente. Por eso usa el teclado del sistema y no el del kiosco.
 *
 * El lector es el de Google Play services: la cámara la abre él, así que la app
 * no pide permiso de cámara. Sin Play services (o sin cámara), queda escribirlo.
 */
@Composable
fun PantallaActivacion(activacion: Activacion) {
    val contexto = LocalContext.current
    val alcance = rememberCoroutineScope()
    var codigo by remember { mutableStateOf("") }
    var comprobando by remember { mutableStateOf(false) }
    var aviso by remember { mutableStateOf<String?>(null) }

    fun activar(texto: String) {
        if (comprobando) return
        comprobando = true
        aviso = null
        alcance.launch {
            val r = activacion.activar(texto)
            comprobando = false
            aviso = when (r) {
                ResultadoActivacion.ACTIVADA -> null
                ResultadoActivacion.FORMATO_INVALIDO -> "El código tiene 6 dígitos. Escríbelo tal como sale en el panel."
                ResultadoActivacion.RECHAZADO -> "Ese código no sirve: está mal escrito, caducó (duran 10 minutos) o ya se usó. Pide uno nuevo en el panel."
                ResultadoActivacion.DEMASIADOS_INTENTOS -> "Demasiados códigos equivocados. Espera unos minutos y vuelve a intentarlo."
                ResultadoActivacion.SIN_CONEXION -> "No se pudo comprobar: la tablet no llega al servidor. Revisa el wifi y vuelve a intentarlo."
            }
        }
    }

    fun escanear() {
        val opciones = GmsBarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build()
        GmsBarcodeScanning.getClient(contexto, opciones).startScan()
            .addOnSuccessListener { leido ->
                val texto = leido.rawValue.orEmpty()
                val digitos = normalizarCodigo(texto)
                // Solo el QR del panel (`asta-tablet:…`): otro QR no se toma por un código.
                if (!texto.lowercase().startsWith("asta-tablet:") || digitos == null) {
                    aviso = "Ese QR no es el de una tablet. Escanea el que sale en el panel, en Tablets → «Añadir tablet»."
                } else {
                    codigo = digitos
                    activar(digitos)
                }
            }
            .addOnFailureListener {
                aviso = "No se pudo abrir el lector de QR en esta tablet. Escribe el código a mano."
            }
    }

    Box(Modifier.fillMaxSize().fondoCristal(), contentAlignment = Alignment.Center) {
        Column(
            Modifier.widthIn(max = 760.dp).padding(48.dp),
            verticalArrangement = Arrangement.spacedBy(28.dp),
        ) {
            Logo(170.dp, Tema.azul)
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("Activa esta tablet", style = Tema.titulo(48))
                Text(
                    "Esta aplicación es para clientes de Supricom. Para usarla, entra al panel de ASTA con tu cuenta, ve a Tablets → «Añadir tablet» y escribe aquí el código de 6 dígitos.",
                    style = Tema.cuerpo(22, Tema.tintaSuave),
                )
            }

            Pulsable({ escanear() }, Modifier.fillMaxWidth(), habilitado = !comprobando, descripcion = "Escanear el código") {
                Box(
                    Modifier.fillMaxWidth().height(Tema.alturaBoton).background(Tema.degradado, CircleShape),
                    contentAlignment = Alignment.Center,
                ) { Text("Escanear el código", style = Tema.fuerte(24, Tema.superficie)) }
            }
            Text("o escríbelo:", style = Tema.cuerpo(20, Tema.tintaTenue))

            Row(horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(
                    value = codigo,
                    onValueChange = { codigo = it },
                    placeholder = { Text("482 913", style = Tema.codigo(34, Tema.tintaTenue)) },
                    textStyle = Tema.codigo(34),
                    singleLine = true,
                    shape = RoundedCornerShape(16.dp),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number, autoCorrectEnabled = false, imeAction = ImeAction.Go),
                    keyboardActions = KeyboardActions(onGo = { activar(codigo) }),
                    modifier = Modifier.weight(1f),
                )
                Pulsable({ activar(codigo) }, habilitado = normalizarCodigo(codigo) != null && !comprobando, descripcion = "Activar") {
                    Box(
                        Modifier.height(Tema.alturaBoton)
                            .background(if (normalizarCodigo(codigo) == null) Tema.tintaTenue else Tema.azul, CircleShape)
                            .padding(horizontal = 32.dp),
                        contentAlignment = Alignment.Center,
                    ) { Text(if (comprobando) "Comprobando…" else "Activar", style = Tema.fuerte(22, Tema.superficie)) }
                }
            }

            aviso?.let { Text(it, style = Tema.medio(20, Tema.agotado)) }
        }
    }
}
