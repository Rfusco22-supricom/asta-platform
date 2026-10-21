import Foundation
import Testing
@testable import AstaKiosco

/// Activación de la tablet con su código. Los mismos casos que
/// `ActivacionTest.kt` en Android.

/// Un llavero de mentira, en memoria.
final class AlmacenFalso: AlmacenCodigo, @unchecked Sendable {
    var codigo: String?
    init(_ codigo: String? = nil) { self.codigo = codigo }
    func leer() -> String? { codigo }
    @discardableResult func guardar(_ c: String) -> Bool { codigo = c; return true }
    func borrar() { codigo = nil }
}

private let codigoBueno = "asta_kio_" + String(repeating: "A", count: 43)
private let sinClave = ConfigApi(base: "http://kiosco.test", apiKey: "")

@MainActor @Suite struct ActivacionTests {
    @Test func sinCodigoPideActivar() {
        #expect(Activacion(base: sinClave, almacen: AlmacenFalso()).estado == .pendiente)
    }

    @Test func conCodigoGuardadoArrancaActivada() {
        let a = Activacion(base: sinClave, almacen: AlmacenFalso(codigoBueno))
        #expect(a.estado == .activa(sinClave.con(apiKey: codigoBueno)))
    }

    /// Lo compilado manda: desarrollo y tablets preparadas a mano siguen igual.
    @Test func laClaveCompiladaNoPideNada() {
        let compilada = ConfigApi(base: "http://kiosco.test", apiKey: "asta_live_abc")
        let a = Activacion(base: compilada, almacen: AlmacenFalso())
        #expect(a.estado == .activa(compilada))
        a.rechazado()
        #expect(a.estado == .activa(compilada))
    }

    @Test func unCodigoAceptadoSeGuardaYActiva() async {
        final class Vista: @unchecked Sendable { var peticion: URLRequest? }
        let vista = Vista()
        let almacen = AlmacenFalso()
        let a = Activacion(base: sinClave, almacen: almacen,
                           transporte: TransporteFalso(cuerpo: Data(#"{"data":{"ok":true}}"#.utf8), vista: { vista.peticion = $0 }))
        // Con los espacios y el salto de línea de un copia y pega.
        #expect(await a.activar("  \(codigoBueno)\n") == .activada)
        #expect(almacen.codigo == codigoBueno)
        #expect(a.estado == .activa(sinClave.con(apiKey: codigoBueno)))
        #expect(vista.peticion?.url?.absoluteString == "http://kiosco.test/api/v1/kiosk/latido")
        #expect(vista.peticion?.value(forHTTPHeaderField: "X-API-Key") == codigoBueno)
    }

    @Test func unCodigoRechazadoNoSeGuarda() async {
        let almacen = AlmacenFalso()
        let a = Activacion(base: sinClave, almacen: almacen, transporte: TransporteFalso(estado: 401))
        #expect(await a.activar(codigoBueno) == .rechazado)
        #expect(almacen.codigo == nil)
        #expect(a.estado == .pendiente)
    }

    @Test func sinRedNoSeDaPorMalo() async {
        let a = Activacion(base: sinClave, almacen: AlmacenFalso(), transporte: TransporteFalso(falla: true))
        #expect(await a.activar(codigoBueno) == .sinConexion)
        #expect(a.estado == .pendiente)
    }

    @Test func loQueNoEsUnCodigoNiSePregunta() async {
        final class Vista: @unchecked Sendable { var preguntado = false }
        let vista = Vista()
        let a = Activacion(base: sinClave, almacen: AlmacenFalso(), transporte: TransporteFalso(vista: { _ in vista.preguntado = true }))
        #expect(await a.activar("https://otra.cosa/qr") == .formatoInvalido)
        #expect(await a.activar("asta_kio_corto") == .formatoInvalido)
        #expect(vista.preguntado == false)
    }

    /// La tablet desactivada en el panel: olvida el código y vuelve a pedirlo.
    @Test func alSerRechazadaOlvidaElCodigo() {
        let almacen = AlmacenFalso(codigoBueno)
        let a = Activacion(base: sinClave, almacen: almacen)
        a.rechazado()
        #expect(almacen.codigo == nil)
        #expect(a.estado == .pendiente)
    }

    @Test func elLatidoDistingueRechazoDeFaltaDeRed() async {
        let config = sinClave.con(apiKey: codigoBueno)
        #expect(await ClienteApi(config: config, transporte: TransporteFalso(cuerpo: Data("{}".utf8))).comprobar() == .valido)
        #expect(await ClienteApi(config: config, transporte: TransporteFalso(estado: 401)).comprobar() == .rechazado)
        #expect(await ClienteApi(config: config, transporte: TransporteFalso(falla: true)).comprobar() == .sinRespuesta)
        #expect(await ClienteApi(config: config, transporte: TransporteFalso(estado: 500)).comprobar() == .sinRespuesta)
    }
}
