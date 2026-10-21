import SwiftUI

/// Kiosco de Asta para iPad (#40).
///
/// Lo que lo hace un kiosco, aparte de la interfaz:
///
///   · horizontal y a pantalla completa (`Info.plist`: `UIRequiresFullScreen`);
///   · sin barra de estado ni indicador de inicio a la vista;
///   · la pantalla no se apaga durante la jornada (`isIdleTimerDisabled`).
///
/// Eso NO impide salirse de la app: para eso, «Acceso guiado» en la tablet o el
/// modo de app única de un MDM. Ver `apps/ios/README.md`.
///
/// Sin código de tablet compilado, la primera vez pide uno (`Activacion`): así
/// la misma app sirve para todas las tablets cuando se instala desde la tienda.
@main
struct AstaKioscoApp: App {
    /// Cada cuánto la tablet dice que sigue viva (#46). Menos que el umbral de
    /// la alerta «kiosco mudo» (30 min), con margen para un latido perdido.
    static let latido: Duration = .seconds(600)

    @State private var activacion = Activacion(base: .delBundle(), almacen: LlaveroCodigo())

    var body: some Scene {
        WindowGroup {
            Group {
                switch activacion.estado {
                case let .activa(config):
                    // Un código distinto es otra tablet: se empieza de cero.
                    KioscoActivo(config: config) { activacion.rechazado() }
                        .id(config.apiKey)
                case .pendiente:
                    ActivacionView(activacion: activacion)
                }
            }
            .onAppear { UIApplication.shared.isIdleTimerDisabled = true }
        }
    }
}

/// La app de la tienda, con la tablet ya activada.
private struct KioscoActivo: View {
    private let api: ClienteApi
    private let alRechazar: () -> Void
    @State private var kiosco: Kiosco

    init(config: ConfigApi, alRechazar: @escaping () -> Void) {
        let api = ClienteApi(config: config)
        self.api = api
        self.alRechazar = alRechazar
        _kiosco = State(initialValue: Kiosco(datos: Datos(
            api: api,
            cache: CacheLocal(almacen: AlmacenUserDefaults(defaults: .standard))
        )))
    }

    var body: some View {
        RaizView(kiosco: kiosco)
            .task {
                // El latido dice al panel que la tablet sigue viva y, de paso, si
                // el código sigue valiendo: un 401 es que la desactivaron (o se
                // renovó el token) y la tablet vuelve a pedir el código.
                while !Task.isCancelled {
                    if api.config.esTablet, await api.comprobar() == .rechazado {
                        alRechazar()
                        return
                    }
                    try? await Task.sleep(for: AstaKioscoApp.latido)
                }
            }
    }
}
