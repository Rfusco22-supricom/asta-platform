import Foundation

/// Caché local del kiosco (#42). La misma regla que `dominio/Cache.kt` en Android.
///
/// «Una tablet en blanco en piso de venta es peor que una con datos de hace diez
/// minutos», dice el issue. Sin red, la tablet enseña lo último que supo, con la
/// fecha delante, en vez de una pantalla de error.
///
/// ── Qué se guarda ────────────────────────────────────────────────────────────
///
/// Lo que el cliente ha consultado: las búsquedas de impresora y los productos
/// compatibles de cada una. No se precarga el catálogo entero: se guarda lo que
/// de verdad se pregunta, que además es lo que más se repite.
///
/// ── Qué NO se guarda ─────────────────────────────────────────────────────────
///
/// Nada de un cliente: hoy se consulta como visitante y no hay precios (#31).
/// Cuando los haya, esto **no** los puede guardar sin más: son de la sesión, y la
/// sesión se borra al cerrarse (#41).

/// Lo mínimo de un almacén clave → datos: `UserDefaults` en la tablet, uno en
/// memoria en los tests, que así prueban de verdad el vencimiento y el tope.
protocol Almacen: Sendable {
    func leer(_ clave: String) -> Data?
    func guardar(_ datos: Data, en clave: String)
    func borrar(_ clave: String)
    func claves() -> [String]
}

struct AlmacenUserDefaults: Almacen, @unchecked Sendable {
    // `UserDefaults` es seguro entre hilos; no está marcado `Sendable`.
    let defaults: UserDefaults

    func leer(_ clave: String) -> Data? { defaults.data(forKey: clave) }
    func guardar(_ datos: Data, en clave: String) { defaults.set(datos, forKey: clave) }
    func borrar(_ clave: String) { defaults.removeObject(forKey: clave) }
    func claves() -> [String] { Array(defaults.dictionaryRepresentation().keys) }
}

struct Guardado<T: Codable>: Codable {
    let datos: T
    /// Cuándo se guardó. Es lo que se le enseña al cliente.
    let guardadoEn: Date
}

struct CacheLocal: Sendable {
    static let prefijo = "asta.cache."
    /// Doce horas: cubre una jornada, que es el caso real —la tienda se queda sin
    /// internet media mañana—. Más allá, la existencia de ayer ya no dice nada
    /// útil y es mejor admitir que no se sabe.
    static let vigencia: TimeInterval = 12 * 3600
    /// Una tablet no tiene por qué acumular meses de consultas.
    static let maxEntradas = 200

    let almacen: any Almacen
    var ahora: @Sendable () -> Date = { Date() }

    /// Lo guardado, si no ha caducado. `nil` si no hay nada o ya no vale.
    func leer<T: Codable>(_ nombre: String, como: T.Type = T.self) -> Guardado<T>? {
        guard let crudo = almacen.leer(Self.prefijo + nombre),
              let guardado = try? JSONDecoder().decode(Guardado<T>.self, from: crudo) else { return nil }
        guard ahora().timeIntervalSince(guardado.guardadoEn) <= Self.vigencia else { return nil }
        return guardado
    }

    func guardar<T: Codable>(_ nombre: String, _ datos: T) {
        // Sin espacio o ilegible: se pierde la caché, no la consulta.
        guard let crudo = try? JSONEncoder().encode(Guardado(datos: datos, guardadoEn: ahora())) else { return }
        almacen.guardar(crudo, en: Self.prefijo + nombre)
        podar()
    }

    private struct SoloFecha: Decodable { let guardadoEn: Date }

    /// Al cerrar la sesión no se borra: lo guardado no es de nadie (ver arriba).
    func podar() {
        let claves = almacen.claves().filter { $0.hasPrefix(Self.prefijo) }
        guard claves.count > Self.maxEntradas else { return }
        let conFecha = claves.map { clave in
            // Ilegible: que se vaya el primero.
            (clave, almacen.leer(clave).flatMap { try? JSONDecoder().decode(SoloFecha.self, from: $0) }?.guardadoEn ?? .distantPast)
        }
        for (clave, _) in conFecha.sorted(by: { $0.1 < $1.1 }).prefix(claves.count - Self.maxEntradas) {
            almacen.borrar(clave)
        }
    }

    /// Nombres de caché. En un sitio para que leer y guardar no se desincronicen.
    enum Claves {
        static func busqueda(_ q: String) -> String {
            "busqueda." + q.trimmingCharacters(in: .whitespaces).lowercased().filter { $0.isASCII && ($0.isLetter || $0.isNumber) }
        }

        static func compatibles(_ impresoraId: Int) -> String { "compatibles.\(impresoraId)" }
    }
}
