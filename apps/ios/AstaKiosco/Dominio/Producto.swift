import Foundation

/// Cómo se le presenta al cliente cada producto compatible (#40). La misma regla
/// que `dominio/Producto.kt` en Android.
///
/// El nombre que llega es el del ERP: «ASTA TONER CB435A/CB436A/CE278A/285». Es
/// el que entiende el mostrador, así que se enseña, pero en pequeño: a quien está
/// de pie le sirve más «Tóner compatible Asta» y el código del cartucho.
extension ProductoCompatible {
    /// Asta es la marca propia: los compatibles que vende la tienda se llaman así en el ERP.
    var esAsta: Bool {
        nombre.trimmingCharacters(in: .whitespaces).range(of: #"^ASTA\b"#, options: [.regularExpression, .caseInsensitive]) != nil
    }

    /// Tóner listo para poner, o polvo para rellenar un cartucho. El ERP no tiene
    /// un campo para esto, solo el nombre, y confundirlos es que el cliente se
    /// lleve un bote de polvo creyendo que es un cartucho.
    var esPolvo: Bool {
        nombre.range(of: #"\b(POLVO|POWDER)\b"#, options: [.regularExpression, .caseInsensitive]) != nil
    }

    enum Clase: Equatable { case toner, polvo, tinta, tambor, otro }

    /// Qué es: tóner, polvo de recarga, tinta, tambor u otra cosa.
    ///
    /// El polvo sale del nombre (`esPolvo`), y manda: en el catálogo de
    /// cartuchos el polvo es «tóner». Lo demás, del tipo de los cartuchos que
    /// manda el servidor. Una botella de tinta o un tambor no son tóner, y
    /// llamarlos así es la misma confusión que con el polvo: el cliente pide el
    /// tambor creyendo que es el tóner. Si el tipo no es uno solo, o no se
    /// conoce, no se afirma nada: `.otro`.
    var clase: Clase {
        if esPolvo { return .polvo }
        let tipos = Set(cartuchos.map(\.tipo))
        guard tipos.count == 1, let tipo = tipos.first else { return .otro }
        switch tipo {
        case "toner": return .toner
        case "tinta": return .tinta
        case "tambor": return .tambor
        default: return .otro
        }
    }

    /// «Tóner compatible Asta», «Tambor original Brother», «Polvo de recarga Asta».
    func titulo(para impresora: Impresora) -> String {
        let marca = esAsta ? "Asta" : (cartuchos.first?.marca ?? impresora.marca)
        let origen = tipo == .original ? "original" : "compatible"
        switch clase {
        case .polvo: return "Polvo de recarga \(marca)"
        case .toner: return "Tóner \(origen) \(marca)"
        case .tinta: return "Tinta \(origen) \(marca)"
        case .tambor: return "Tambor \(origen) \(marca)"
        case .otro: return "Consumible \(origen) \(marca)"
        }
    }
}

extension EstadoStock {
    /// Lo que se le dice al cliente de cada estado.
    var texto: String {
        switch self {
        case .disponible: "Hay en tienda"
        case .bajo: "Últimas unidades"
        case .agotado: "Sin existencia"
        }
    }

    fileprivate var orden: Int {
        switch self {
        case .disponible: 0
        case .bajo: 1
        case .agotado: 2
        }
    }
}

/// Los códigos de cartucho distintos, en el orden en que aparecen.
func codigosDeCartucho(_ productos: [ProductoCompatible]) -> [String] {
    var vistos = Set<String>()
    return productos.flatMap { $0.cartuchos.map(\.codigo) }.filter { vistos.insert($0).inserted }
}

/// En qué orden se le ofrece al cliente lo que le sirve (#40). La misma regla que
/// `ordenarParaRecomendar` en Android.
///
/// Lo que pide la dirección: que se recomiende **Asta, la marca propia, y lo que
/// hay en tienda**. Por eso, de más a menos importante:
///
///   1. **Lo que hay en tienda, antes que lo agotado.** El cliente vino a
///      llevárselo hoy: poner delante un Asta agotado y detrás un original que
///      sí hay es perder la venta. Lo agotado se enseña igual —saber que existe
///      sirve para encargarlo—, pero debajo.
///   2. **Cartuchos antes que polvo de recarga.** Quien busca un cartucho no
///      quiere un bote de polvo, aunque sea Asta.
///   3. **Asta antes que las demás marcas.**
///   4. Disponible antes que «últimas unidades».
///
/// Orden estable: si todo eso empata, se respeta el del servidor.
func ordenarParaRecomendar(_ productos: [ProductoCompatible]) -> [ProductoCompatible] {
    func clave(_ e: (offset: Int, element: ProductoCompatible)) -> (Int, Int, Int, Int, Int) {
        let p = e.element
        return (p.stock == .agotado ? 1 : 0, p.esPolvo ? 1 : 0, p.esAsta ? 0 : 1, p.stock.orden, e.offset)
    }
    return productos.enumerated()
        .sorted { clave($0) < clave($1) }
        .map(\.element)
}

/// El que lleva el sello «Recomendado»: el primero de la lista si es un cartucho
/// Asta que hay en tienda. Si no hay ninguno así, no se recomienda nada: sellar un
/// original o un agotado como «recomendado» no es lo que se pide.
func recomendado(_ ordenados: [ProductoCompatible]) -> ProductoCompatible? {
    guard let primero = ordenados.first, primero.esAsta, !primero.esPolvo, primero.stock != .agotado else { return nil }
    return primero
}

/// Qué se le pone delante al cliente. La misma regla que `queEnsenar` en Android.
///
/// **El kiosco solo ofrece Asta**, la marca propia. Lo pidió la dirección y tiene
/// una consecuencia que conviene tener escrita: un original en pantalla, al lado
/// del Asta, se lleva una venta que ya teníamos en el almacén; y cuando el
/// original es lo único que sirve, ofrecerlo no es trabajo del kiosco, sino del
/// mostrador, que puede explicar la diferencia de precio y de garantía.
///
/// De ahí que haya **tres** respuestas y no dos. La diferencia entre las dos
/// últimas le importa al cliente que está de pie:
///
///   · `asta`     hay consumibles Asta verificados para esa impresora;
///   · `sinAsta`  la impresora sí está y tiene consumibles verificados, pero
///                ninguno es nuestro. Se dice así y se manda al mostrador;
///                callarlo haría creer que la impresora no está en el sistema.
///   · `sinNada`  todavía no hay ninguna compatibilidad verificada (#56). Es un
///                paso que falta por dar, no un «no existe».
enum ParaEnsenar: Equatable {
    case asta([ProductoCompatible])
    case sinAsta
    case sinNada
}

/// Filtra a Asta y ordena. Lo que llega a `ordenarParaRecomendar` es ya solo
/// Asta, así que de sus cuatro reglas la tercera queda sin efecto; se conserva
/// porque es la que volvería a ordenar si algún día se mezclan otra vez.
func queEnsenar(_ productos: [ProductoCompatible]) -> ParaEnsenar {
    let asta = productos.filter { $0.esAsta }
    if !asta.isEmpty { return .asta(ordenarParaRecomendar(asta)) }
    return productos.isEmpty ? .sinNada : .sinAsta
}
