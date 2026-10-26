import Foundation
import Testing
@testable import AstaKiosco

/// Vincular la tablet con el código del panel. Los mismos casos que
/// `ActivacionTest.kt` en Android.

/// Un llavero de mentira, en memoria.
final class AlmacenFalso: AlmacenCodigo, @unchecked Sendable {
    var codigo: String?
    init(_ codigo: String? = nil) { self.codigo = codigo }
    func leer() -> String? { codigo }
    @discardableResult func guardar(_ c: String) -> Bool { codigo = c; return true }
    func borrar() { codigo = nil }
}

private let tokenBueno = "asta_kio_" + String(repeating: "A", count: 43)
private let sinClave = ConfigApi(base: "http://kiosco.test", apiKey: "", version: "1.2.0")
private let vinculada = Data(#"{"data":{"token":"\#(tokenBueno)","nombre":"Mostrador","conExistencias":false}}"#.utf8)

@MainActor @Suite struct ActivacionTests {
    @Test func sinTokenPideCodigo() {
        #expect(Activacion(base: sinClave, almacen: AlmacenFalso()).estado == .pendiente)
    }

    @Test func conTokenGuardadoArrancaActivada() {
        let a = Activacion(base: sinClave, almacen: AlmacenFalso(tokenBueno))
        #expect(a.estado == .activa(sinClave.con(apiKey: tokenBueno)))
    }

    /// Lo compilado manda: desarrollo y tablets preparadas a mano siguen igual.
    @Test func laClaveCompiladaNoPideNada() {
        let compilada = ConfigApi(base: "http://kiosco.test", apiKey: "asta_live_abc")
        let a = Activacion(base: compilada, almacen: AlmacenFalso())
        #expect(a.estado == .activa(compilada))
        a.rechazado()
        #expect(a.estado == .activa(compilada))
    }

    @Test func elCodigoSeLeeComoSeEscribe() {
        #expect(normalizarCodigo("482913") == "482913")
        #expect(normalizarCodigo(" 482 913\n") == "482913")
        #expect(normalizarCodigo("asta-tablet:482913") == "482913")
        #expect(normalizarCodigo("1234 5678 9012") == "123456789012")
        #expect(normalizarCodigo("48291") == nil)
        #expect(normalizarCodigo("4829134") == nil)
        #expect(normalizarCodigo("https://otra.cosa/482913") == nil)
        #expect(normalizarCodigo("asta_kio_abc") == nil)
    }

    @Test func unCodigoAceptadoGuardaElTokenYActiva() async throws {
        final class Vista: @unchecked Sendable { var peticion: URLRequest? }
        let vista = Vista()
        let almacen = AlmacenFalso()
        let a = Activacion(base: sinClave, almacen: almacen, modelo: "iPad · iPadOS 18",
                           transporte: TransporteFalso(estado: 201, cuerpo: vinculada, vista: { vista.peticion = $0 }))
        #expect(await a.activar("482 913") == .activada)
        #expect(almacen.codigo == tokenBueno)
        #expect(a.estado == .activa(sinClave.con(apiKey: tokenBueno)))
        let p = try #require(vista.peticion)
        #expect(p.url?.absoluteString == "http://kiosco.test/api/v1/kiosk/vincular")
        #expect(p.httpMethod == "POST")
        #expect(p.value(forHTTPHeaderField: "X-API-Key") == nil)
        let cuerpo = try JSONDecoder().decode([String: String].self, from: try #require(p.httpBody))
        #expect(cuerpo == ["codigo": "482913", "plataforma": "ios", "modelo": "iPad · iPadOS 18", "version": "1.2.0"])
    }

    @Test func unCodigoRechazadoNoGuardaNada() async {
        let almacen = AlmacenFalso()
        let a = Activacion(base: sinClave, almacen: almacen, transporte: TransporteFalso(estado: 404))
        #expect(await a.activar("482913") == .rechazado)
        #expect(almacen.codigo == nil)
        #expect(a.estado == .pendiente)
    }

    @Test func demasiadosIntentosYSinRedSeDistinguen() async {
        #expect(await Activacion(base: sinClave, almacen: AlmacenFalso(), transporte: TransporteFalso(estado: 429)).activar("482913") == .demasiadosIntentos)
        #expect(await Activacion(base: sinClave, almacen: AlmacenFalso(), transporte: TransporteFalso(falla: true)).activar("482913") == .sinConexion)
        #expect(await Activacion(base: sinClave, almacen: AlmacenFalso(), transporte: TransporteFalso(estado: 500)).activar("482913") == .sinConexion)
    }

    @Test func loQueNoEsUnCodigoNiSePregunta() async {
        final class Contador: @unchecked Sendable { var n = 0 }
        let c = Contador()
        let a = Activacion(base: sinClave, almacen: AlmacenFalso(), transporte: TransporteFalso(estado: 201, cuerpo: vinculada, vista: { _ in c.n += 1 }))
        #expect(await a.activar("hola") == .formatoInvalido)
        #expect(c.n == 0)
    }

    /// La tablet desactivada en el panel: olvida el token y vuelve a pedir un código.
    @Test func alSerRechazadaOlvidaElToken() {
        let almacen = AlmacenFalso(tokenBueno)
        let a = Activacion(base: sinClave, almacen: almacen)
        a.rechazado()
        #expect(almacen.codigo == nil)
        #expect(a.estado == .pendiente)
    }

    @Test func elLatidoDistingueRechazoDeFaltaDeRed() async {
        func api(_ t: TransporteFalso) -> ClienteApi { ClienteApi(config: sinClave.con(apiKey: tokenBueno), transporte: t) }
        #expect(await api(TransporteFalso(cuerpo: Data("{}".utf8))).comprobar() == .valido)
        #expect(await api(TransporteFalso(estado: 401)).comprobar() == .rechazado)
        #expect(await api(TransporteFalso(falla: true)).comprobar() == .sinRespuesta)
        #expect(await api(TransporteFalso(estado: 500)).comprobar() == .sinRespuesta)
    }

    /// Una tablet sin almacén (la de un cliente) recibe los productos sin existencia.
    @Test func unProductoSinExistenciaSeLee() throws {
        let json = #"{"id":1,"templateId":2,"sku":"A-1","nombre":"ASTA X","stock":null,"tipo":"compatible","cartuchos":[]}"#
        let p = try JSONDecoder().decode(ProductoCompatible.self, from: Data(json.utf8))
        #expect(p.stock == nil)
        #expect(ordenarParaRecomendar([p]) == [p])
    }
}
