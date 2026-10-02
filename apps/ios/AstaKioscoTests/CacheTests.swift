import Foundation
import Testing
@testable import AstaKiosco

/// #42 · Lo guardado rescata sin red o sin ERP, y nada más. Los mismos casos que
/// `apps/mobile/src/__tests__/offline.test.ts`.

final class AlmacenMemoria: Almacen, @unchecked Sendable {
    var datos: [String: Data] = [:]
    func leer(_ clave: String) -> Data? { datos[clave] }
    func guardar(_ d: Data, en clave: String) { datos[clave] = d }
    func borrar(_ clave: String) { datos[clave] = nil }
    func claves() -> [String] { Array(datos.keys) }
}

final class Reloj: @unchecked Sendable {
    var ahora = Date(timeIntervalSince1970: 1_800_000_000)
}

private let impresora = Impresora(id: 1, marca: "HP", nombre: "P1606")
private let busqueda = Busqueda(impresoras: [impresora], sugerencias: [], busquedaId: "1")

@Suite struct CacheTests {
    @Test func caducaALasDoceHoras() {
        let reloj = Reloj()
        let cache = CacheLocal(almacen: AlmacenMemoria(), ahora: { reloj.ahora })
        cache.guardar("x", busqueda)
        reloj.ahora += 12 * 3600
        #expect(cache.leer("x", como: Busqueda.self)?.datos == busqueda)
        reloj.ahora += 1
        #expect(cache.leer("x", como: Busqueda.self) == nil)
    }

    @Test func noAcumulaMasDelTopeYSeVanLasMasViejas() {
        let reloj = Reloj()
        let almacen = AlmacenMemoria()
        let cache = CacheLocal(almacen: almacen, ahora: { reloj.ahora })
        for i in 0..<(CacheLocal.maxEntradas + 5) {
            reloj.ahora += 1
            cache.guardar("c\(i)", i)
        }
        #expect(almacen.claves().count == CacheLocal.maxEntradas)
        #expect(cache.leer("c0", como: Int.self) == nil)
        #expect(cache.leer("c\(CacheLocal.maxEntradas + 4)", como: Int.self)?.datos == CacheLocal.maxEntradas + 4)
    }

    @Test func laClaveDeBusquedaNoDistingueComoSeEscribio() {
        #expect(CacheLocal.Claves.busqueda(" HL-2350 ") == CacheLocal.Claves.busqueda("hl2350"))
    }

    @MainActor @Test func rescataSinRedYSinErpPeroNoConUn403() async {
        let almacen = AlmacenMemoria()
        let cache = CacheLocal(almacen: almacen)
        let bien = Datos(api: ClienteApi(config: ConfigApi(base: "http://t", apiKey: ""), transporte: TransporteFalso(cuerpo: Data(
            #"{"data":[{"id":1,"marca":"HP","nombre":"P1606"}],"sugerencias":[],"meta":{"busquedaId":"1"}}"#.utf8))), cache: cache)
        var informes: [Informe] = []
        guard case .ok(_, nil) = await bien.buscar("P1606", informar: { informes.append($0) }) else { Issue.record("en vivo"); return }

        let sinRed = Datos(api: ClienteApi(config: ConfigApi(base: "http://t", apiKey: ""), transporte: TransporteFalso(falla: true)), cache: cache)
        guard case let .ok(b, guardadoEn) = await sinRed.buscar("P1606", informar: { informes.append($0) }) else { Issue.record("sin red"); return }
        #expect(b.impresoras.first?.nombre == "P1606")
        #expect(guardadoEn != nil)

        let odoo = Data(#"{"error":{"code":"ODOO_UNAVAILABLE"}}"#.utf8)
        let sinErp = Datos(api: ClienteApi(config: ConfigApi(base: "http://t", apiKey: ""), transporte: TransporteFalso(estado: 503, cuerpo: odoo)), cache: cache)
        guard case .ok(_, .some) = await sinErp.buscar("P1606", informar: { informes.append($0) }) else { Issue.record("sin erp"); return }

        // Un 403 dice que la tablet está mal configurada: no se tapa con lo guardado.
        let prohibido = Datos(api: ClienteApi(config: ConfigApi(base: "http://t", apiKey: ""), transporte: TransporteFalso(estado: 403)), cache: cache)
        guard case .fallo(.permiso) = await prohibido.buscar("P1606", informar: { informes.append($0) }) else { Issue.record("403"); return }

        #expect(informes == [.ok, .sinRed, .sinErp, .ok])
    }

    @Test func haceCuantoDiceLaHoraConcreta() {
        let ahora = Date(timeIntervalSince1970: 1_800_000_000)
        #expect(haceCuanto(ahora.addingTimeInterval(-20), ahora: ahora) == "hace menos de un minuto")
        #expect(haceCuanto(ahora.addingTimeInterval(-6 * 60), ahora: ahora) == "hace 6 min")
        #expect(haceCuanto(ahora.addingTimeInterval(-70 * 60), ahora: ahora) == "hace 1 hora")
        #expect(haceCuanto(ahora.addingTimeInterval(-5 * 3600), ahora: ahora) == "hace 5 horas")
    }
}
