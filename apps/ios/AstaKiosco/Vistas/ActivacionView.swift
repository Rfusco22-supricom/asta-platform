import SwiftUI
import VisionKit

/// La pantalla de una tablet sin vincular: pide el código de 6 dígitos que da el
/// panel (Tablets → «Añadir tablet»), escribiéndolo o escaneando su QR. La
/// pareja de `ui/Activacion.kt` en Android.
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
                    Text("Esta aplicación es para clientes de Supricom. Para usarla, entra al panel de ASTA con tu cuenta, ve a Tablets → «Añadir tablet» y escribe aquí el código de 6 dígitos.")
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
                    TextField("482 913", text: $codigo)
                        .font(Tema.codigo(34))
                        .keyboardType(.numberPad)
                        .textContentType(.oneTimeCode)
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
                            .background(Capsule().fill(normalizarCodigo(codigo) == nil ? AnyShapeStyle(Tema.tintaTenue) : AnyShapeStyle(Tema.azul)))
                    }
                    .disabled(normalizarCodigo(codigo) == nil || comprobando)
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
                codigo = normalizarCodigo(leido) ?? ""
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
        case .formatoInvalido: aviso = "El código tiene 6 dígitos. Escríbelo tal como sale en el panel."
        case .rechazado: aviso = "Ese código no sirve: está mal escrito, caducó (duran 10 minutos) o ya se usó. Pide uno nuevo en el panel."
        case .demasiadosIntentos: aviso = "Demasiados códigos equivocados. Espera unos minutos y vuelve a intentarlo."
        case .sinConexion: aviso = "No se pudo comprobar: la tablet no llega al servidor. Revisa el wifi y vuelve a intentarlo."
        }
    }
}

/// La cámara leyendo un QR (VisionKit). Avisa una vez, con el primer QR del
/// panel (`asta-tablet:…`); los demás QR que vea los ignora.
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
                if case let .barcode(codigo) = item, let texto = codigo.payloadStringValue,
                   texto.lowercased().hasPrefix("asta-tablet:"), normalizarCodigo(texto) != nil {
                    leido = true
                    v.stopScanning()
                    alLeer(texto)
                    return
                }
            }
        }
    }
}
