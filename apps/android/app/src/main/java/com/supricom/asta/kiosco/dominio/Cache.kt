package com.supricom.asta.kiosco.dominio

import android.content.SharedPreferences
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long

/**
 * Caché local del kiosco (#42). La misma regla que `apps/mobile/src/cache.ts`.
 *
 * «Una tablet en blanco en piso de venta es peor que una con datos de hace diez
 * minutos», dice el issue. Sin red, la tablet enseña lo último que supo, con la
 * fecha delante, en vez de una pantalla de error.
 *
 * Se guarda lo que el cliente ha consultado —búsquedas y compatibles—, no el
 * catálogo entero. Nada de un cliente: hoy se consulta como visitante y no hay
 * precios (#31). Cuando los haya, esto **no** los puede guardar sin más: son de
 * la sesión, y la sesión se borra al cerrarse (#41).
 */

/** Lo mínimo de un almacén clave → texto: `SharedPreferences` en la tablet, un mapa en los tests. */
interface Almacen {
    fun leer(clave: String): String?
    fun guardar(clave: String, valor: String)
    fun borrar(clave: String)
    fun claves(): Set<String>
}

class AlmacenPreferencias(private val prefs: SharedPreferences) : Almacen {
    override fun leer(clave: String) = prefs.getString(clave, null)
    override fun guardar(clave: String, valor: String) = prefs.edit().putString(clave, valor).apply()
    override fun borrar(clave: String) = prefs.edit().remove(clave).apply()
    override fun claves(): Set<String> = prefs.all.keys
}

data class Guardado<T>(val datos: T, val guardadoEn: Long)

class CacheLocal(private val almacen: Almacen, private val ahora: () -> Long = System::currentTimeMillis) {
    private val json = Json { ignoreUnknownKeys = true }

    /** Lo guardado, si no ha caducado. `null` si no hay nada o ya no vale. */
    fun <T> leer(nombre: String, lector: KSerializer<T>): Guardado<T>? {
        val crudo = almacen.leer(PREFIJO + nombre) ?: return null
        return runCatching {
            val o = json.parseToJsonElement(crudo).jsonObject
            val en = o.getValue("guardadoEn").jsonPrimitive.long
            if (ahora() - en > VIGENCIA_MS) null else Guardado(json.decodeFromJsonElement(lector, o.getValue("datos")), en)
        }.getOrNull()
    }

    fun <T> guardar(nombre: String, escritor: KSerializer<T>, datos: T) {
        // Sin espacio o ilegible: se pierde la caché, no la consulta.
        runCatching {
            val o = JsonObject(mapOf("datos" to json.encodeToJsonElement(escritor, datos), "guardadoEn" to JsonPrimitive(ahora())))
            almacen.guardar(PREFIJO + nombre, o.toString())
            podar()
        }
    }

    /** Al cerrar la sesión no se borra: lo guardado no es de nadie (ver arriba). */
    fun podar() {
        val claves = almacen.claves().filter { it.startsWith(PREFIJO) }
        if (claves.size <= MAX_ENTRADAS) return
        claves
            .map { k ->
                // Ilegible: que se vaya el primero.
                k to (runCatching { json.parseToJsonElement(almacen.leer(k)!!).jsonObject.getValue("guardadoEn").jsonPrimitive.long }.getOrDefault(0L))
            }
            .sortedBy { it.second }
            .take(claves.size - MAX_ENTRADAS)
            .forEach { almacen.borrar(it.first) }
    }

    companion object {
        const val PREFIJO = "asta.cache."
        /**
         * Doce horas: cubre una jornada, que es el caso real —la tienda se queda sin
         * internet media mañana—. Más allá, la existencia de ayer ya no dice nada útil.
         */
        const val VIGENCIA_MS = 12L * 3600_000
        /** Una tablet no tiene por qué acumular meses de consultas. */
        const val MAX_ENTRADAS = 200

        /** Nombres de caché. En un sitio para que leer y guardar no se desincronicen. */
        fun claveBusqueda(q: String) = "busqueda." + q.trim().lowercase().filter { it in 'a'..'z' || it in '0'..'9' }
        fun claveCompatibles(impresoraId: Int) = "compatibles.$impresoraId"
    }
}
