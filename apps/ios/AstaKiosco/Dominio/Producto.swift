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

/// Lo que hay en tienda, primero. Lo agotado se enseña igual —saber que existe
/// sirve para encargarlo—, pero debajo. Orden estable: dentro de cada estado se
/// respeta el del servidor.
func ordenarPorStock(_ productos: [ProductoCompatible]) -> [ProductoCompatible] {
    productos.enumerated()
        .sorted { ($0.element.stock.orden, $0.offset) < ($1.element.stock.orden, $1.offset) }
        .map(\.element)
}
