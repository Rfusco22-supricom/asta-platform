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
 * En qué orden se le ofrece al cliente lo que le sirve (#40). La misma regla que
 * `ordenarParaRecomendar` en iOS (`Dominio/Producto.swift`).
 *
 * Lo que pide la dirección: que se recomiende **Asta, la marca propia, y lo que
 * hay en tienda**. Por eso, de más a menos importante:
 *
 *   1. **Lo que hay en tienda, antes que lo agotado.** El cliente vino a
 *      llevárselo hoy: poner delante un Asta agotado y detrás un original que sí
 *      hay es perder la venta. Lo agotado se enseña igual —saber que existe
 *      sirve para encargarlo—, pero debajo.
 *   2. **Cartuchos antes que polvo de recarga.** Quien busca un cartucho no
 *      quiere un bote de polvo, aunque sea Asta.
 *   3. **Asta antes que las demás marcas.**
 *   4. Disponible antes que «últimas unidades».
 *
 * `sortedWith` es estable: si todo eso empata, se respeta el orden del servidor.
 */
fun ordenarParaRecomendar(productos: List<ProductoCompatible>): List<ProductoCompatible> = productos.sortedWith(
    compareBy<ProductoCompatible>(
        { it.stock == EstadoStock.AGOTADO },
        { it.esPolvo },
        { !it.esAsta },
        { it.stock.ordinal },
    ),
)

/**
 * El que lleva el sello «Recomendado»: el primero de la lista si es un cartucho
 * Asta que hay en tienda. Si no hay ninguno así, no se recomienda nada: sellar un
 * original o un agotado como «recomendado» no es lo que se pide.
 */
fun recomendado(ordenados: List<ProductoCompatible>): ProductoCompatible? =
    ordenados.firstOrNull()?.takeIf { it.esAsta && !it.esPolvo && it.stock != EstadoStock.AGOTADO }

/**
 * Qué se le pone delante al cliente. La misma regla que `queEnsenar` en iOS
 * (`Dominio/Producto.swift`).
 *
 * **El kiosco solo ofrece Asta**, la marca propia. Lo pidió la dirección y tiene
 * una consecuencia que conviene tener escrita: un original en pantalla, al lado
 * del Asta, se lleva una venta que ya teníamos en el almacén; y cuando el
 * original es lo único que sirve, ofrecerlo no es trabajo del kiosco, sino del
 * mostrador, que puede explicar la diferencia de precio y de garantía.
 *
 * De ahí que haya TRES respuestas y no dos. La diferencia entre las dos últimas
 * le importa al cliente que está de pie:
 *
 *   · `Asta`     hay consumibles Asta verificados para esa impresora;
 *   · `SinAsta`  la impresora sí está y tiene consumibles verificados, pero
 *                ninguno es nuestro. Se dice así y se manda al mostrador;
 *                callarlo haría creer que la impresora no está en el sistema.
 *   · `SinNada`  todavía no hay ninguna compatibilidad verificada (#56). Es un
 *                paso que falta por dar, no un «no existe».
 */
sealed interface ParaEnsenar {
    data class Asta(val productos: List<ProductoCompatible>) : ParaEnsenar
    data object SinAsta : ParaEnsenar
    data object SinNada : ParaEnsenar
}

/**
 * Filtra a Asta y ordena. Lo que llega a `ordenarParaRecomendar` es ya solo Asta,
 * así que de sus cuatro reglas la tercera queda sin efecto; se conserva porque es
 * la que volvería a ordenar si algún día se mezclan otra vez.
 */
fun queEnsenar(productos: List<ProductoCompatible>): ParaEnsenar {
    val asta = productos.filter { it.esAsta }
    if (asta.isNotEmpty()) return ParaEnsenar.Asta(ordenarParaRecomendar(asta))
    return if (productos.isEmpty()) ParaEnsenar.SinNada else ParaEnsenar.SinAsta
}
