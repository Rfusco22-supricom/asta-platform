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
    @State private var kiosco = Kiosco(datos: Datos(
        api: ClienteApi(config: .delBundle()),
        cache: CacheLocal(almacen: AlmacenUserDefaults(defaults: .standard))
    ))

    var body: some Scene {
        WindowGroup {
            RaizView(kiosco: kiosco)
                .onAppear { UIApplication.shared.isIdleTimerDisabled = true }
        }
    }
}
