package com.supricom.asta.kiosco.dominio

import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI
import java.net.URLEncoder
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * Cliente de la API pública para el kiosco (#40). El mismo contrato que
 * `apps/ios/AstaKiosco/Dominio/Api.swift`.
 *
 * ── Por qué una API key y no un token de dispositivo ─────────────────────────
 *
 * `kiosk_devices` todavía no dice a qué almacén pertenece cada tablet, y la
 * existencia que publica el recomendador es la del almacén del cliente del
 * token. Mientras tanto la tablet usa la API key de la tienda, con el permiso
 * `RECOMMENDER_READ` y nada más. Se pone en `local.properties`, que no se versiona.
 *
 * ── Errores ──────────────────────────────────────────────────────────────────
 *
 * Nada aquí lanza: cada llamada devuelve un [Resultado] que hay que mirar. En
 * una pantalla de piso de venta, una excepción sin tratar deja la tablet en
 * blanco delante del cliente.
 */

/**
 * `ERP` es su propio motivo, y no `SERVIDOR`: el middleware contestó y dijo que
 * el ERP no responde. Es el corte más probable —Odoo cae, la tienda tiene wifi—
 * y ahí la caché SÍ rescata, mientras que un 500 nuestro o un 403 no.
 */
enum class MotivoFallo { RED, ERP, SERVIDOR, PERMISO }

sealed interface Resultado<out T> {
    data class Ok<T>(val datos: T) : Resultado<T>
    data class Fallo(val motivo: MotivoFallo) : Resultado<Nothing>
}

data class Peticion(val url: String, val metodo: String = "GET", val cabeceras: Map<String, String> = emptyMap(), val cuerpo: String? = null)
data class Respuesta(val estado: Int, val cuerpo: String)

/** Lo mínimo de HTTP que hace falta: así los tests responden lo que quieren sin red. */
fun interface Transporte {
    /** Lanza [IOException] si no hay red o el servidor no contesta. */
    suspend fun enviar(peticion: Peticion): Respuesta
}

object TransporteHttp : Transporte {
    override suspend fun enviar(peticion: Peticion): Respuesta = withContext(Dispatchers.IO) {
        val c = URI(peticion.url).toURL().openConnection() as HttpURLConnection
        try {
            c.requestMethod = peticion.metodo
            c.connectTimeout = 15_000
            c.readTimeout = 15_000
            peticion.cabeceras.forEach { (k, v) -> c.setRequestProperty(k, v) }
            peticion.cuerpo?.let { cuerpo ->
                c.doOutput = true
                c.outputStream.use { it.write(cuerpo.toByteArray()) }
            }
            val estado = c.responseCode
            val flujo = if (estado >= 400) c.errorStream else c.inputStream
            Respuesta(estado, flujo?.bufferedReader()?.use { it.readText() } ?: "")
        } finally {
            c.disconnect()
        }
    }
}

class ClienteApi(
    private val base: String,
    private val apiKey: String,
    private val transporte: Transporte = TransporteHttp,
    /** La versión de la app, para que el panel diga qué tablet se quedó atrás. */
    private val version: String = "",
) {
    /**
     * Dónde pregunta la tablet. Con un token de tablet (`asta_kio_…`, dado de alta
     * en el panel, en Kioscos), por las rutas del kiosco: existencias del almacén
     * de la tienda. Con una API key de cliente, por la API pública, como antes:
     * así una tablet ya configurada sigue funcionando.
     */
    private val prefijo = if (apiKey.startsWith("asta_kio_")) "/api/v1/kiosk" else "/api/v1/public"

    private val json = Json { ignoreUnknownKeys = true }

    @Serializable private data class Meta(val busquedaId: String? = null)
    @Serializable private data class RespuestaBusqueda(val data: List<Impresora>, val sugerencias: List<Impresora>, val meta: Meta)

    /** El 503 del middleware cuando Odoo no responde (`ODOO_UNAVAILABLE`). */
    private fun esErpCaido(r: Respuesta): Boolean {
        if (r.estado != 503) return false
        return runCatching {
            json.parseToJsonElement(r.cuerpo).jsonObject["error"]?.jsonObject?.get("code")?.jsonPrimitive?.content == "ODOO_UNAVAILABLE"
        }.getOrDefault(false)
    }

    private suspend fun <T> pedir(ruta: String, lector: KSerializer<T>, metodo: String = "GET", cuerpo: String? = null): Resultado<T> {
        val cabeceras = buildMap {
            put("X-API-Key", apiKey)
            if (version.isNotEmpty()) put("X-App-Version", version)
            if (cuerpo != null) put("Content-Type", "application/json")
        }
        val r = try {
            transporte.enviar(Peticion(base + ruta, metodo, cabeceras, cuerpo))
        } catch (e: Exception) {
            // Sin conexión, o el servidor no responde: la pantalla dice "sin
            // conexión" en vez de "error". Se captura todo: una URL mal puesta en
            // `local.properties` tampoco puede tumbar la app.
            return Resultado.Fallo(MotivoFallo.RED)
        }
        return when {
            r.estado == 401 || r.estado == 403 -> Resultado.Fallo(MotivoFallo.PERMISO)
            r.estado !in 200..299 -> Resultado.Fallo(if (esErpCaido(r)) MotivoFallo.ERP else MotivoFallo.SERVIDOR)
            else -> runCatching { Resultado.Ok(json.decodeFromString(lector, r.cuerpo)) }.getOrElse { Resultado.Fallo(MotivoFallo.SERVIDOR) }
        }
    }

    suspend fun buscarImpresoras(q: String): Resultado<Busqueda> {
        val consulta = URLEncoder.encode(q, "UTF-8").replace("+", "%20")
        return when (val r = pedir("$prefijo/recommender/printers?q=$consulta&limit=12", RespuestaBusqueda.serializer())) {
            is Resultado.Ok -> Resultado.Ok(Busqueda(r.datos.data, r.datos.sugerencias, r.datos.meta.busquedaId))
            is Resultado.Fallo -> r
        }
    }

    @Serializable private data class RespuestaCompatibles(val data: List<ProductoCompatible>)

    suspend fun compatiblesDe(impresoraId: Int, busquedaId: String?): Resultado<List<ProductoCompatible>> {
        val q = busquedaId?.let { "?busquedaId=" + URLEncoder.encode(it, "UTF-8") } ?: ""
        return when (val r = pedir("$prefijo/recommender/printers/$impresoraId/compatible$q", RespuestaCompatibles.serializer())) {
            is Resultado.Ok -> Resultado.Ok(r.datos.data)
            is Resultado.Fallo -> r
        }
    }

    /** `/health` no pide API key y es lo más barato que responde el middleware. */
    suspend fun estaVivo(): Boolean = runCatching { transporte.enviar(Peticion("$base/health")).estado in 200..299 }.getOrDefault(false)

    /**
     * Qué producto miró el cliente (#43). Se lanza y se olvida: que la telemetría
     * falle no puede estropear lo que el cliente está haciendo.
     */
    fun registrarClic(alcance: CoroutineScope, busquedaId: String?, productId: Int) {
        if (busquedaId == null) return
        alcance.launch {
            pedir("$prefijo/recommender/busquedas/$busquedaId/clic", JsonObject.serializer(), "POST", """{"productId":$productId}""")
        }
    }

    companion object {
        val listaDeProductos: KSerializer<List<ProductoCompatible>> = ListSerializer(ProductoCompatible.serializer())
    }
}
