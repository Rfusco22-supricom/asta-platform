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
@main
struct AstaKioscoApp: App {
    private static let api = ClienteApi(config: .delBundle())
    /// Cada cuánto la tablet dice que sigue viva (#46). Menos que el umbral de
    /// la alerta «kiosco mudo» (30 min), con margen para un latido perdido.
    static let latido: Duration = .seconds(600)

    @State private var kiosco = Kiosco(datos: Datos(
        api: AstaKioscoApp.api,
        cache: CacheLocal(almacen: AlmacenUserDefaults(defaults: .standard))
    ))

    var body: some Scene {
        WindowGroup {
            RaizView(kiosco: kiosco)
                .onAppear { UIApplication.shared.isIdleTimerDisabled = true }
                .task {
                    while !Task.isCancelled {
                        await Self.api.latir()
                        try? await Task.sleep(for: Self.latido)
                    }
                }
        }
    }
}
