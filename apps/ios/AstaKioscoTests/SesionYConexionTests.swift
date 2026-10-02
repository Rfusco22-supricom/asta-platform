import Foundation
import Testing
@testable import AstaKiosco

/// #41 · La sesión se cierra sola, avisando antes, y un toque la reinicia.
/// #42 · El estado de la conexión, y la recarga al volver la red.
///
/// Con relojes cortos de verdad: 4 minutos se prueban como 300 ms.
@MainActor @Suite struct SesionYConexionTests {
    @Test func avisaYLuegoCierra() async throws {
        var avisos: [Bool] = []
        var cierres: [Sesion.Motivo] = []
        let s = Sesion(duracion: .milliseconds(300), avisoAntes: .milliseconds(150), alAvisar: { avisos.append($0) }, alCerrar: { cierres.append($0) })
        try await Task.sleep(for: .milliseconds(220))
        #expect(avisos == [true])
        #expect(cierres.isEmpty)
        try await Task.sleep(for: .milliseconds(200))
        #expect(avisos == [true, false])
        #expect(cierres == [.timeout])
        _ = s
    }

    @Test func unToqueQuitaElAvisoYReiniciaLosRelojes() async throws {
        var avisos: [Bool] = []
        var cierres: [Sesion.Motivo] = []
        let s = Sesion(duracion: .milliseconds(300), avisoAntes: .milliseconds(150), alAvisar: { avisos.append($0) }, alCerrar: { cierres.append($0) })
        try await Task.sleep(for: .milliseconds(220))
        s.tocar()
        #expect(avisos == [true, false])
        try await Task.sleep(for: .milliseconds(120))
        #expect(cierres.isEmpty)
        try await Task.sleep(for: .milliseconds(300))
        #expect(cierres == [.timeout])
    }

    @Test func terminarCierraUnaVezYNoQuedaNadaArmado() async throws {
        var cierres: [Sesion.Motivo] = []
        let s = Sesion(duracion: .milliseconds(200), avisoAntes: .milliseconds(100), alAvisar: { _ in }, alCerrar: { cierres.append($0) })
        s.terminar()
        s.terminar()
        try await Task.sleep(for: .milliseconds(300))
        #expect(cierres == [.logout])
    }

    @Test func distingueSinRedDeSinErpYSoloSondeaMientrasEstaCaida() async throws {
        final class Llamadas: @unchecked Sendable { var n = 0; var responde = false }
        let llamadas = Llamadas()
        let v = Vigilante(intervalo: .milliseconds(50)) { llamadas.n += 1; return llamadas.responde }
        try await Task.sleep(for: .milliseconds(120))
        #expect(llamadas.n == 0)

        v.reportar(.sinErp)
        #expect(v.estado == .sinDatosVivos)
        v.reportar(.sinRed)
        #expect(v.estado == .sinConexion)
        try await Task.sleep(for: .milliseconds(130))
        #expect(llamadas.n >= 2)
        #expect(v.recargas == 0)

        llamadas.responde = true
        try await Task.sleep(for: .milliseconds(120))
        #expect(v.estado == .conectado)
        // Al volver, una sola recarga, y se deja de sondear.
        #expect(v.recargas == 1)
        let tras = llamadas.n
        try await Task.sleep(for: .milliseconds(150))
        #expect(llamadas.n == tras)
        v.parar()
    }
}
