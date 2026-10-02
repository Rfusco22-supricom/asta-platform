package com.supricom.asta.kiosco.dominio

import kotlin.math.max
import kotlin.math.roundToInt
import kotlinx.serialization.KSerializer

/**
 * La capa que decide qué se enseña cuando no hay datos en vivo (#42). La misma
 * regla que `apps/mobile/src/datos.ts`: **lo vivo manda; lo guardado rescata.**
 *
 * Rescata en los dos cortes que dejan a la tablet sin datos pero no la
 * estropean: `RED` y `ERP`. NO rescata con un 403, un 404 ni un 500 nuestro:
 * ahí el servidor contestó y dijo que no. Enseñar datos viejos ante un 403
 * taparía que la tablet está mal configurada.
 */
sealed interface ConCache<out T> {
    /** `guardadoEn` no es null si sale de la caché: la pantalla tiene que decirlo. */
    data class Ok<T>(val datos: T, val guardadoEn: Long?) : ConCache<T>
    data class Fallo(val motivo: MotivoFallo) : ConCache<Nothing>
}

/** Lo que cada petición le cuenta al vigilante de la conexión. */
enum class Informe { OK, SIN_RED, SIN_ERP }

class Datos(val api: ClienteApi, private val cache: CacheLocal) {

    private suspend fun <T> conCache(clave: String, serializador: KSerializer<T>, informar: (Informe) -> Unit, pedir: suspend () -> Resultado<T>): ConCache<T> =
        when (val r = pedir()) {
            is Resultado.Ok -> {
                informar(Informe.OK)
                cache.guardar(clave, serializador, r.datos)
                ConCache.Ok(r.datos, null)
            }
            is Resultado.Fallo -> {
                informar(
                    when (r.motivo) {
                        MotivoFallo.RED -> Informe.SIN_RED
                        MotivoFallo.ERP -> Informe.SIN_ERP
                        else -> Informe.OK
                    },
                )
                val rescata = r.motivo == MotivoFallo.RED || r.motivo == MotivoFallo.ERP
                val guardado = if (rescata) cache.leer(clave, serializador) else null
                if (guardado != null) ConCache.Ok(guardado.datos, guardado.guardadoEn) else ConCache.Fallo(r.motivo)
            }
        }

    suspend fun buscar(q: String, informar: (Informe) -> Unit): ConCache<Busqueda> =
        conCache(CacheLocal.claveBusqueda(q), Busqueda.serializer(), informar) { api.buscarImpresoras(q) }

    suspend fun compatibles(impresoraId: Int, busquedaId: String?, informar: (Informe) -> Unit): ConCache<List<ProductoCompatible>> =
        conCache(CacheLocal.claveCompatibles(impresoraId), ClienteApi.listaDeProductos, informar) { api.compatiblesDe(impresoraId, busquedaId) }
}

/** "hace 3 min", "hace 2 horas". Lo que se pone al lado de unos datos guardados. */
fun haceCuanto(guardadoEn: Long, ahora: Long = System.currentTimeMillis()): String {
    val minutos = max(0, ((ahora - guardadoEn) / 60_000.0).roundToInt())
    if (minutos < 1) return "hace menos de un minuto"
    if (minutos < 60) return "hace $minutos min"
    val horas = (minutos / 60.0).roundToInt()
    return if (horas == 1) "hace 1 hora" else "hace $horas horas"
}
