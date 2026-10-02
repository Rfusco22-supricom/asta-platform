import Foundation
import Observation

/// El estado del kiosco: qué pantalla se ve, la sesión y la conexión (#40, #41, #42).
///
/// Tres pantallas: atracción → buscar → resultados. Nada más: quien lo usa está
/// de pie, con prisa y a veces con el dependiente esperando.
///
/// Al tocar la atracción empieza una sesión que se cierra sola a los cuatro
/// minutos sin uso, avisando 30 s antes, y que el cliente puede cerrar con
/// «Terminar». Al cerrarse **no queda nada suyo**: `claveSesion` cambia y con
/// ella se rehacen las pantallas, que es donde viven la búsqueda, el modelo
/// elegido y los resultados.
@MainActor
@Observable
final class Kiosco {
    enum Pantalla: Equatable {
        case atraccion
        case buscar
        case resultados(Impresora, busquedaId: String?)
    }

    private(set) var pantalla: Pantalla = .atraccion
    private(set) var avisando = false
    /// Cambia en cada sesión: rehace las pantallas y con eso borra su estado.
    private(set) var claveSesion = 0

    let datos: Datos
    let vigilante: Vigilante
    private var sesion: Sesion?

    init(datos: Datos) {
        self.datos = datos
        let api = datos.api
        self.vigilante = Vigilante { await api.estaVivo() }
    }

    func empezar() {
        sesion?.parar()
        sesion = Sesion(
            alAvisar: { [weak self] visible in self?.avisando = visible },
            alCerrar: { [weak self] _ in self?.cerrarSesion() }
        )
        pantalla = .buscar
    }

    func tocar() { sesion?.tocar() }
    func terminar() { sesion?.terminar() }

    func elegir(_ impresora: Impresora, busquedaId: String?) {
        tocar()
        pantalla = .resultados(impresora, busquedaId: busquedaId)
    }

    func volverABuscar() {
        tocar()
        pantalla = .buscar
    }

    private func cerrarSesion() {
        sesion?.parar()
        sesion = nil
        avisando = false
        claveSesion += 1
        pantalla = .atraccion
    }

    func informar(_ informe: Informe) { vigilante.reportar(informe) }
}
