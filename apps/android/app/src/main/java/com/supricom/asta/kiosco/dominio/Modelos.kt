package com.supricom.asta.kiosco.dominio

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Lo que devuelve la API pública del recomendador (#39). Los nombres de los
 * campos son los del JSON; ver `packages/shared-types/src/recommender.ts`.
 */

@Serializable
data class Impresora(val id: Int, val marca: String, val nombre: String)

@Serializable
enum class EstadoStock {
    @SerialName("disponible") DISPONIBLE,
    @SerialName("bajo") BAJO,
    @SerialName("agotado") AGOTADO,
}

@Serializable
data class Cartucho(
    val marca: String,
    val codigo: String,
    val tipo: String,
    val color: String? = null,
    val rendimientoPaginas: Int? = null,
)

@Serializable
data class ProductoCompatible(
    val id: Int,
    val templateId: Int,
    val sku: String? = null,
    val nombre: String,
    val stock: EstadoStock,
    val tipo: Tipo,
    val cartuchos: List<Cartucho>,
) {
    @Serializable
    enum class Tipo {
        @SerialName("original") ORIGINAL,
        @SerialName("compatible") COMPATIBLE,
    }
}

@Serializable
data class Busqueda(
    val impresoras: List<Impresora>,
    val sugerencias: List<Impresora>,
    /** Para enlazar búsqueda, impresora y producto en la telemetría (#43). */
    val busquedaId: String?,
)
