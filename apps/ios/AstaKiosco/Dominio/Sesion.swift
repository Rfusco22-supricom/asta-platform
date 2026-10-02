import Foundation

/// La sesión de un cliente frente a la tablet (#41). La misma regla que
/// `dominio/Sesion.kt` en Android.
///
/// La tablet es un dispositivo COMPARTIDO: lo que quedó en pantalla es de la
/// persona anterior. Por eso la sesión se cierra sola, y al cerrarse no queda
/// nada suyo en pantalla.
///
/// ── Los dos relojes ──────────────────────────────────────────────────────────
///
/// Uno avisa y otro cierra. A los 3:30 sin tocar aparece el aviso con «Sigo
/// aquí»; a los 4:00, se cierra. Cerrarle la sesión sin aviso a alguien que está
/// comparando dos tóners parece una avería. Cualquier toque reinicia los dos.
@MainActor
final class Sesion {
    enum Motivo: Sendable { case timeout, logout }

    static let duracion: Duration = .seconds(4 * 60)
    static let avisoAntes: Duration = .seconds(30)

    private let duracion: Duration
    private let avisoAntes: Duration
    private let alAvisar: @MainActor (Bool) -> Void
    private let alCerrar: @MainActor (Motivo) -> Void
    private var reloj: Task<Void, Never>?
    private var avisando = false
    private(set) var viva = true

    init(
        duracion: Duration = Sesion.duracion,
        avisoAntes: Duration = Sesion.avisoAntes,
        alAvisar: @escaping @MainActor (Bool) -> Void,
        alCerrar: @escaping @MainActor (Motivo) -> Void
    ) {
        self.duracion = duracion
        self.avisoAntes = avisoAntes
        self.alAvisar = alAvisar
        self.alCerrar = alCerrar
        armar()
    }

    /// Cada interacción del cliente. «Sigo aquí» es un toque como otro.
    func tocar() {
        guard viva else { return }
        ocultarAviso()
        armar()
    }

    /// El cliente cierra a mano con «Terminar».
    func terminar() {
        guard viva else { return }
        acabar()
        alCerrar(.logout)
    }

    /// Se acabó la sesión desde fuera, sin avisar a nadie.
    func parar() {
        viva = false
        reloj?.cancel()
        ocultarAviso()
    }

    private func acabar() {
        viva = false
        reloj?.cancel()
        ocultarAviso()
    }

    private func ocultarAviso() {
        guard avisando else { return }
        avisando = false
        alAvisar(false)
    }

    private func armar() {
        reloj?.cancel()
        let hastaAviso = max(.zero, duracion - avisoAntes)
        let resto = duracion - hastaAviso
        reloj = Task { [weak self] in
            do {
                try await Task.sleep(for: hastaAviso)
                guard let self, self.viva else { return }
                self.avisando = true
                self.alAvisar(true)
                try await Task.sleep(for: resto)
                guard self.viva else { return }
                self.acabar()
                self.alCerrar(.timeout)
            } catch {
                // Cancelado por un toque o un cierre: nada que hacer.
            }
        }
    }
}
