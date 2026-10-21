import SwiftUI
import VisionKit

/// La pantalla de una tablet sin activar: pide el código que da el panel
/// (Aplicación ASTA → Tablets → «Registrar una tablet»), escaneando su QR o
/// escribiéndolo. La pareja de `ui/Activacion.kt` en Android.
///
/// La ve el personal de la tienda, una vez, al instalar la tablet; nunca un
/// cliente. Por eso usa el teclado del sistema y no el del kiosco.
struct ActivacionView: View {
    let activacion: Activacion

    @State private var codigo = ""
    @State private var comprobando = false
    @State private var aviso: String?
    @State private var escaneando = false

    /// La cámara solo si el iPad puede leer códigos (no en el simulador).
    private var puedeEscanear: Bool {
        DataScannerViewController.isSupported && DataScannerViewController.isAvailable
    }

    var body: some View {
        ZStack {
            FondoCristal()
            VStack(alignment: .leading, spacing: 28) {
                Logo(ancho: 170, color: Tema.azul)
                VStack(alignment: .leading, spacing: 12) {
                    Text("Activa esta tablet").font(Tema.titulo(48)).foregroundStyle(Tema.tinta)
                    Text("Esta aplicación es para las tiendas de Supricom. Para usarla, un administrador tiene que darle un código desde el panel: Aplicación ASTA → Tablets → «Registrar una tablet».")
                        .font(Tema.cuerpo(22)).foregroundStyle(Tema.tintaSuave)
                        .fixedSize(horizontal: false, vertical: true)
                }

                if puedeEscanear {
                    Button { escaneando = true } label: {
                        Text("Escanear el código").font(Tema.fuerte(24)).foregroundStyle(.white)
                            .frame(maxWidth: .infinity, minHeight: Tema.alturaBoton)
                            .background(Capsule().fill(Tema.degradado))
                    }
                    .disabled(comprobando)
                    Text("o escríbelo:").font(Tema.cuerpo(20)).foregroundStyle(Tema.tintaTenue)
                }

                HStack(spacing: 16) {
                    TextField("asta_kio_…", text: $codigo)
                        .font(Tema.codigoCuerpo(22))
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .submitLabel(.go)
                        .onSubmit { Task { await activar(codigo) } }
                        .padding(.horizontal, 20)
                        .frame(minHeight: Tema.alturaBoton)
                        .vidrio(radio: 16)
                    Button { Task { await activar(codigo) } } label: {
                        Text(comprobando ? "Comprobando…" : "Activar").font(Tema.fuerte(22)).foregroundStyle(.white)
                            .padding(.horizontal, 32)
                            .frame(minHeight: Tema.alturaBoton)
                            .background(Capsule().fill(codigo.isEmpty ? AnyShapeStyle(Tema.tintaTenue) : AnyShapeStyle(Tema.azul)))
                    }
                    .disabled(codigo.isEmpty || comprobando)
                }

                if let aviso {
                    Text(aviso).font(Tema.medio(20)).foregroundStyle(Tema.agotado)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxWidth: 760)
            .padding(48)
        }
        .persistentSystemOverlays(.hidden)
        .statusBarHidden()
        .sheet(isPresented: $escaneando) {
            LectorQR { leido in
                escaneando = false
                codigo = leido
                Task { await activar(leido) }
            }
            .ignoresSafeArea()
        }
    }

    private func activar(_ texto: String) async {
        guard !comprobando else { return }
        comprobando = true
        aviso = nil
        let r = await activacion.activar(texto)
        comprobando = false
        switch r {
        case .activada: break
        case .formatoInvalido: aviso = "Eso no es un código de tablet. Empieza por «asta_kio_»: cópialo entero del panel."
        case .rechazado: aviso = "El panel no reconoce ese código. Puede que se haya renovado o que la tablet esté desactivada: pide uno nuevo en Tablets."
        case .sinConexion: aviso = "No se pudo comprobar: la tablet no llega al servidor. Revisa el wifi y vuelve a intentarlo."
        }
    }
}

/// La cámara leyendo un QR (VisionKit). Avisa una vez, con el primer código que
/// tenga forma de código de tablet; los demás QR que vea los ignora.
private struct LectorQR: UIViewControllerRepresentable {
    let alLeer: (String) -> Void

    func makeUIViewController(context: Context) -> DataScannerViewController {
        let v = DataScannerViewController(
            recognizedDataTypes: [.barcode(symbologies: [.qr])],
            qualityLevel: .balanced,
            isHighlightingEnabled: true
        )
        v.delegate = context.coordinator
        try? v.startScanning()
        return v
    }

    func updateUIViewController(_ v: DataScannerViewController, context: Context) {}

    func makeCoordinator() -> Coordinador { Coordinador(alLeer: alLeer) }

    final class Coordinador: NSObject, DataScannerViewControllerDelegate {
        let alLeer: (String) -> Void
        private var leido = false
        init(alLeer: @escaping (String) -> Void) { self.alLeer = alLeer }

        func dataScanner(_ v: DataScannerViewController, didAdd items: [RecognizedItem], allItems: [RecognizedItem]) {
            guard !leido else { return }
            for item in items {
                if case let .barcode(codigo) = item, let texto = codigo.payloadStringValue, normalizarCodigo(texto) != nil {
                    leido = true
                    v.stopScanning()
                    alLeer(texto)
                    return
                }
            }
        }
    }
}
