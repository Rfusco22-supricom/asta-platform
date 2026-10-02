package com.supricom.asta.kiosco.dominio

/**
 * Cómo se le presenta al cliente cada producto compatible (#40). La misma regla
 * que `Dominio/Producto.swift` en iOS.
 *
 * El nombre que llega es el del ERP: «ASTA TONER CB435A/CB436A/CE278A/285». Es
 * el que entiende el mostrador, así que se enseña, pero en pequeño: a quien está
 * de pie le sirve más «Tóner compatible Asta» y el código del cartucho.
 */

private val ASTA = Regex("""^ASTA\b""", RegexOption.IGNORE_CASE)
private val POLVO = Regex("""\b(POLVO|POWDER)\b""", RegexOption.IGNORE_CASE)

/** Asta es la marca propia: los compatibles que vende la tienda se llaman así en el ERP. */
val ProductoCompatible.esAsta: Boolean get() = ASTA.containsMatchIn(nombre.trim())

/**
 * Tóner listo para poner, o polvo para rellenar un cartucho. El ERP no tiene un
 * campo para esto, solo el nombre, y confundirlos es que el cliente se lleve un
 * bote de polvo creyendo que es un cartucho.
 */
val ProductoCompatible.esPolvo: Boolean get() = POLVO.containsMatchIn(nombre)

enum class Clase { TONER, POLVO, TINTA, TAMBOR, OTRO }

/**
 * Qué es: tóner, polvo de recarga, tinta, tambor u otra cosa.
 *
 * El polvo sale del nombre (`esPolvo`), y manda: en el catálogo de cartuchos el
 * polvo es «tóner». Lo demás, del tipo de los cartuchos que manda el servidor.
 * Una botella de tinta o un tambor no son tóner, y llamarlos así es la misma
 * confusión que con el polvo: el cliente pide el tambor creyendo que es el
 * tóner. Si el tipo no es uno solo, o no se conoce, no se afirma nada: `OTRO`.
 */
val ProductoCompatible.clase: Clase
    get() {
        if (esPolvo) return Clase.POLVO
        val tipos = cartuchos.map { it.tipo }.toSet()
        if (tipos.size != 1) return Clase.OTRO
        return when (tipos.single()) {
            "toner" -> Clase.TONER
            "tinta" -> Clase.TINTA
            "tambor" -> Clase.TAMBOR
            else -> Clase.OTRO
        }
    }

/** «Tóner compatible Asta», «Tambor original Brother», «Polvo de recarga Asta». */
fun ProductoCompatible.titulo(impresora: Impresora): String {
    val marca = if (esAsta) "Asta" else (cartuchos.firstOrNull()?.marca ?: impresora.marca)
    val origen = if (tipo == ProductoCompatible.Tipo.ORIGINAL) "original" else "compatible"
    return when (clase) {
        Clase.POLVO -> "Polvo de recarga $marca"
        Clase.TONER -> "Tóner $origen $marca"
        Clase.TINTA -> "Tinta $origen $marca"
        Clase.TAMBOR -> "Tambor $origen $marca"
        Clase.OTRO -> "Consumible $origen $marca"
    }
}

/** Lo que se le dice al cliente de cada estado. */
val EstadoStock.texto: String
    get() = when (this) {
        EstadoStock.DISPONIBLE -> "Hay en tienda"
        EstadoStock.BAJO -> "Últimas unidades"
        EstadoStock.AGOTADO -> "Sin existencia"
    }

/** Los códigos de cartucho distintos, en el orden en que aparecen. */
fun codigosDeCartucho(productos: List<ProductoCompatible>): List<String> = productos.flatMap { p -> p.cartuchos.map { it.codigo } }.distinct()

/**
 * Lo que hay en tienda, primero. Lo agotado se enseña igual —saber que existe
 * sirve para encargarlo—, pero debajo. `sortedBy` es estable: dentro de cada
 * estado se respeta el orden del servidor.
 */
fun ordenarPorStock(productos: List<ProductoCompatible>): List<ProductoCompatible> = productos.sortedBy { it.stock.ordinal }
