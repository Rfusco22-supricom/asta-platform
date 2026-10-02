import Foundation
import Observation

/// Estado de la conexión y reintento en segundo plano (#42). La misma regla que
/// `apps/mobile/src/conexion.ts`:
///
///   · el personal ve siempre si la tablet está conectada;
///   · al volver la red, la pantalla se pone al día sola.
///
/// Se sabe por lo que pasa con las peticiones de verdad (`reportar`), no por el
/// estado del wifi: que esté asociado no significa que el middleware conteste.
/// Mientras algo está caído se comprueba cada 15 s con `/health`; con todo bien
/// no se sondea.
enum EstadoConexion: Sendable {
    /// Todo en vivo.
    case conectado
    /// La tablet no llega al middleware: wifi o servidor.
    case sinConexion
    /// El middleware contesta y el ERP no. Buscar impresoras sigue funcionando;
    /// lo que no se sabe es la existencia.
    case sinDatosVivos
}

@MainActor
@Observable
final class Vigilante {
    static let reintento: Duration = .seconds(15)

    private(set) var estado: EstadoConexion = .conectado
    /// Sube cada vez que vuelve la red: las pantallas lo miran para volver a pedir.
    private(set) var recargas = 0

    private let comprobar: @Sendable () async -> Bool
    private let intervalo: Duration
    private var sondeo: Task<Void, Never>?

    init(intervalo: Duration = Vigilante.reintento, comprobar: @escaping @Sendable () async -> Bool) {
        self.intervalo = intervalo
        self.comprobar = comprobar
    }

    func reportar(_ informe: Informe) {
        switch informe {
        case .ok: pasarA(.conectado)
        case .sinRed: pasarA(.sinConexion)
        case .sinErp: pasarA(.sinDatosVivos)
        }
    }

    func parar() {
        sondeo?.cancel()
        sondeo = nil
    }

    private func pasarA(_ nuevo: EstadoConexion) {
        guard nuevo != estado else { return }
        let volvio = estado != .conectado && nuevo == .conectado
        estado = nuevo
        parar()
        if nuevo != .conectado {
            // Con el ERP caído también se sondea: `/health` comprueba Odoo y MySQL.
            sondeo = Task { [intervalo, comprobar, weak self] in
                while !Task.isCancelled {
                    try? await Task.sleep(for: intervalo)
                    if Task.isCancelled { return }
                    if await comprobar() {
                        self?.pasarA(.conectado)
                        return
                    }
                }
            }
        } else if volvio {
            recargas += 1
        }
    }
}
