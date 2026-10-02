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

    /// «Tóner compatible Asta», «Tóner original HP», «Polvo de recarga Asta».
    func titulo(para impresora: Impresora) -> String {
        let marca = esAsta ? "Asta" : (cartuchos.first?.marca ?? impresora.marca)
        if esPolvo { return "Polvo de recarga \(marca)" }
        return tipo == .original ? "Tóner original \(marca)" : "Tóner compatible \(marca)"
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
