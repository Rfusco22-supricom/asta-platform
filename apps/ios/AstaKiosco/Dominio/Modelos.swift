import Foundation

/// Lo que devuelve la API pública del recomendador (#39). Los nombres de los
/// campos son los del JSON; ver `packages/shared-types/src/recommender.ts`.

struct Impresora: Codable, Hashable, Identifiable, Sendable {
    let id: Int
    let marca: String
    let nombre: String
}

enum EstadoStock: String, Codable, Sendable {
    case disponible, bajo, agotado
}

struct Cartucho: Codable, Hashable, Sendable {
    let marca: String
    let codigo: String
    let tipo: String
    let color: String?
    let rendimientoPaginas: Int?
}

struct ProductoCompatible: Codable, Hashable, Identifiable, Sendable {
    enum Tipo: String, Codable, Sendable { case original, compatible }

    let id: Int
    let templateId: Int
    let sku: String?
    let nombre: String
    let stock: EstadoStock
    let tipo: Tipo
    let cartuchos: [Cartucho]
}

struct Busqueda: Codable, Hashable, Sendable {
    let impresoras: [Impresora]
    let sugerencias: [Impresora]
    /// Para enlazar búsqueda, impresora y producto en la telemetría (#43).
    let busquedaId: String?
}
