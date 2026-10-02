import SwiftUI

/// La pantalla entera: la que toque según `Kiosco.pantalla`, con su barra y el
/// aviso de sesión encima.
struct RaizView: View {
    @State var kiosco: Kiosco

    var body: some View {
        ZStack {
            switch kiosco.pantalla {
            case .atraccion:
                AtraccionView(estado: kiosco.vigilante.estado) { kiosco.empezar() }
            case .buscar, .resultados:
                conSesion.id(kiosco.claveSesion)
            }

            if kiosco.avisando {
                AvisoSesionView(alSeguir: { kiosco.tocar() }, alTerminar: { kiosco.terminar() })
                    .transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: 0.2), value: kiosco.avisando)
        .persistentSystemOverlays(.hidden)
        .statusBarHidden()
    }

    private var conSesion: some View {
        VStack(spacing: 0) {
            BarraView(paso: kiosco.pantalla == .buscar ? 1 : 2, estado: kiosco.vigilante.estado) { kiosco.terminar() }
            switch kiosco.pantalla {
            case let .resultados(impresora, busquedaId):
                ResultadosView(kiosco: kiosco, impresora: impresora, busquedaId: busquedaId)
            default:
                BuscarView(kiosco: kiosco)
            }
        }
        .background(Tema.papel)
        // Cualquier toque, en cualquier sitio, cuenta como actividad (#41).
        .simultaneousGesture(DragGesture(minimumDistance: 0).onChanged { _ in kiosco.tocar() })
    }
}
