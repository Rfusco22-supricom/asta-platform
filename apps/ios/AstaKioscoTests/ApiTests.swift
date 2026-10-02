import Foundation
import Testing
@testable import AstaKiosco

/// #40 · El cliente de la API. Lo que importa: que una tablet sin conexión o con
/// una key mal puesta no reviente delante del cliente, y que cada fallo se
/// distinga para poder decir algo útil en pantalla. Los mismos casos que
/// `ApiYCacheTest.kt` en Android.

struct TransporteFalso: Transporte {
    var estado = 200
    var cuerpo = Data()
    var falla = false
    var vista: (@Sendable (URLRequest) -> Void)? = nil

    func enviar(_ peticion: URLRequest) async throws -> (Data, HTTPURLResponse) {
        vista?(peticion)
        if falla { throw URLError(.notConnectedToInternet) }
        return (cuerpo, HTTPURLResponse(url: peticion.url!, statusCode: estado, httpVersion: nil, headerFields: nil)!)
    }
}

private func cliente(_ t: TransporteFalso) -> ClienteApi {
    ClienteApi(config: ConfigApi(base: "http://kiosco.test", apiKey: "clave"), transporte: t)
}

private let busquedaJSON = Data(#"{"data":[{"id":1726,"marca":"HP","nombre":"P1606"}],"sugerencias":[],"meta":{"busquedaId":"1411"}}"#.utf8)

@Suite struct ApiTests {
    @Test func buscaYMandaLaKey() async {
        final class Vista: @unchecked Sendable { var peticion: URLRequest? }
        let vista = Vista()
        let r = await cliente(TransporteFalso(cuerpo: busquedaJSON, vista: { vista.peticion = $0 })).buscarImpresoras("HL 2350")
        #expect(r == .ok(Busqueda(impresoras: [Impresora(id: 1726, marca: "HP", nombre: "P1606")], sugerencias: [], busquedaId: "1411")))
        #expect(vista.peticion?.value(forHTTPHeaderField: "X-API-Key") == "clave")
        #expect(vista.peticion?.url?.absoluteString == "http://kiosco.test/api/v1/public/recommender/printers?q=HL%202350&limit=12")
    }

    @Test func sinRedEsRed() async {
        #expect(await cliente(TransporteFalso(falla: true)).buscarImpresoras("x") == .fallo(.red))
    }

    @Test func unaKeyMalPuestaEsPermiso() async {
        #expect(await cliente(TransporteFalso(estado: 401)).buscarImpresoras("x") == .fallo(.permiso))
        #expect(await cliente(TransporteFalso(estado: 403)).buscarImpresoras("x") == .fallo(.permiso))
    }

    @Test func elErpCaidoSeDistingueDeUnFalloNuestro() async {
        let odoo = Data(#"{"error":{"code":"ODOO_UNAVAILABLE","message":"x"}}"#.utf8)
        #expect(await cliente(TransporteFalso(estado: 503, cuerpo: odoo)).buscarImpresoras("x") == .fallo(.erp))
        #expect(await cliente(TransporteFalso(estado: 503)).buscarImpresoras("x") == .fallo(.servidor))
        #expect(await cliente(TransporteFalso(estado: 500)).buscarImpresoras("x") == .fallo(.servidor))
    }

    @Test func unaRespuestaIlegibleEsServidor() async {
        #expect(await cliente(TransporteFalso(cuerpo: Data("<html>".utf8))).buscarImpresoras("x") == .fallo(.servidor))
    }
}
