import Foundation

/// La capa que decide qué se enseña cuando no hay datos en vivo (#42). La misma
/// regla que `dominio/Datos.kt` en Android: **lo vivo manda; lo guardado rescata.**
///
/// Rescata en los dos cortes que dejan a la tablet sin datos pero no la
/// estropean: `red` (no hay wifi, o el middleware no contesta) y `erp` (el
/// middleware dice que Odoo no responde). NO rescata con un 403, un 404 ni un
/// 500 nuestro: ahí el servidor contestó y dijo que no. Enseñar datos viejos
/// ante un 403 taparía que la tablet está mal configurada.

enum ConCache<T: Sendable>: Sendable {
    /// `guardadoEn` no es nil si sale de la caché: la pantalla tiene que decirlo.
    case ok(T, guardadoEn: Date?)
    case fallo(MotivoFallo)
}

/// Lo que cada petición le cuenta al vigilante de la conexión.
enum Informe: Sendable {
    case ok, sinRed, sinErp
}

struct Datos: Sendable {
    let api: ClienteApi
    let cache: CacheLocal

    private func conCache<T: Codable & Sendable>(
        _ clave: String,
        _ pedir: () async -> Resultado<T>,
        _ informar: @MainActor (Informe) -> Void
    ) async -> ConCache<T> {
        let r = await pedir()
        switch r {
        case let .ok(datos):
            await informar(.ok)
            cache.guardar(clave, datos)
            return .ok(datos, guardadoEn: nil)
        case let .fallo(motivo):
            await informar(motivo == .red ? .sinRed : motivo == .erp ? .sinErp : .ok)
            guard motivo == .red || motivo == .erp, let guardado = cache.leer(clave, como: T.self) else { return .fallo(motivo) }
            return .ok(guardado.datos, guardadoEn: guardado.guardadoEn)
        }
    }

    func buscar(_ q: String, informar: @MainActor (Informe) -> Void) async -> ConCache<Busqueda> {
        await conCache(CacheLocal.Claves.busqueda(q), { await api.buscarImpresoras(q) }, informar)
    }

    func compatibles(_ impresoraId: Int, busquedaId: String?, informar: @MainActor (Informe) -> Void) async -> ConCache<[ProductoCompatible]> {
        await conCache(CacheLocal.Claves.compatibles(impresoraId), { await api.compatiblesDe(impresoraId, busquedaId: busquedaId) }, informar)
    }
}

/// "hace 3 min", "hace 2 horas". Lo que se pone al lado de unos datos guardados.
func haceCuanto(_ guardadoEn: Date, ahora: Date = Date()) -> String {
    let minutos = max(0, Int((ahora.timeIntervalSince(guardadoEn) / 60).rounded()))
    if minutos < 1 { return "hace menos de un minuto" }
    if minutos < 60 { return "hace \(minutos) min" }
    let horas = Int((Double(minutos) / 60).rounded())
    return horas == 1 ? "hace 1 hora" : "hace \(horas) horas"
}
