import Combine
import SwiftUI

/// Buscar la impresora del cliente (#40, sobre la búsqueda de #38).
///
/// ── Dos momentos, una pantalla ───────────────────────────────────────────────
///
/// Arriba, a todo lo ancho, lo que se escribe. Debajo, una de dos cosas:
/// ESCRIBIENDO, el teclado del kiosco; ELIGIENDO, lo encontrado, en el sitio del
/// teclado y a dos columnas si cabe. Tocar el campo vuelve a sacar el teclado.
///
/// Se busca al pulsar «Buscar» y no a cada tecla: buscar al teclear manda una
/// petición por pulsación y deja la lista saltando debajo del dedo.
///
/// Cuando no hay coincidencias, la API devuelve parecidos aparte. Se PREGUNTA
/// («¿quisiste decir…?»), nunca se afirma: darle por bueno un modelo parecido es
/// venderle al cliente un tóner que no le entra.
struct BuscarView: View {
    let kiosco: Kiosco

    private enum Estado {
        case vacio
        case buscando
        case resultados(Busqueda, consulta: String, guardadoEn: Date?)
        case error(MotivoFallo)
    }

    /// Ningún modelo se acerca a esto; más es alguien apoyado en el teclado.
    private static let maxLargo = 24

    @State private var texto = ""
    @State private var estado: Estado = .vacio
    /// Cuál es la búsqueda que vale. «Corregir» se puede pulsar con una en curso:
    /// sin esto, su respuesta llegaba después y quitaba el teclado de debajo del
    /// dedo con los resultados de lo que ya no está escrito.
    @State private var vigente = 0

    private var escribiendo: Bool { if case .vacio = estado { true } else { false } }
    private var puedeBuscar: Bool { texto.trimmingCharacters(in: .whitespaces).count >= 2 }

    var body: some View {
        GeometryReader { geo in
            VStack(alignment: .leading, spacing: 16) {
                Text("¿Qué impresora tienes?").font(Tema.titulo(34)).kerning(-0.5).foregroundStyle(Tema.tinta)
                CampoView(texto: texto, ancho: geo.size.width, alto: geo.size.height, escribiendo: escribiendo,
                          alTocar: corregir, alLimpiar: { texto = ""; corregir() })
                if escribiendo {
                    // En una tablet baja el consejo le quitaría al teclado el alto que necesita.
                    if geo.size.height >= 560 {
                        (Text("Basta con las letras y los números: ") + Text("P1606").font(Tema.codigoFuerte(18)).foregroundColor(Tema.tinta)
                            + Text(", no «LaserJet Professional P1606dn». No importan guiones ni espacios."))
                            .font(Tema.cuerpo(18)).foregroundStyle(Tema.tintaSuave)
                    }
                    Spacer(minLength: 0)
                    // El teclado abajo: es donde llega la mano de alguien de pie delante de un soporte.
                    TecladoView(alEscribir: escribir, alBorrar: { if !texto.isEmpty { texto.removeLast() } }, alBuscar: buscar, puedeBuscar: puedeBuscar)
                } else {
                    resultados(columnas: geo.size.width >= 900 ? 2 : 1)
                }
            }
        }
        .padding(.horizontal, 40)
        .padding(.top, 16)
        .padding(.bottom, 24)
    }

    private func escribir(_ letra: String) {
        if texto.count >= Self.maxLargo { return }
        if letra == " " && (texto.isEmpty || texto.hasSuffix(" ")) { return }
        texto += letra
    }

    private func corregir() {
        vigente += 1 // la que estuviera en curso ya no se enseña
        estado = .vacio
    }

    private func buscar() {
        let consulta = texto.trimmingCharacters(in: .whitespaces)
        guard consulta.count >= 2 else { return }
        kiosco.tocar()
        vigente += 1
        let esta = vigente
        estado = .buscando
        Task {
            let r = await kiosco.datos.buscar(consulta, informar: kiosco.informar)
            guard esta == vigente else { return }
            switch r {
            case let .ok(b, guardadoEn): estado = .resultados(b, consulta: consulta, guardadoEn: guardadoEn)
            case let .fallo(m): estado = .error(m)
            }
        }
    }

    @ViewBuilder
    private func resultados(columnas: Int) -> some View {
        switch estado {
        case .vacio:
            EmptyView()
        case .buscando:
            ProgressView().controlSize(.large).tint(Tema.azul).frame(maxWidth: .infinity).padding(.top, 64)
        case let .error(motivo):
            MensajeView(titulo: "No pudimos buscar", texto: Self.texto(de: motivo), aviso: true, alCorregir: corregir)
        case let .resultados(b, consulta, guardadoEn):
            let opciones = b.impresoras.isEmpty ? b.sugerencias : b.impresoras
            let sonSugerencias = b.impresoras.isEmpty && !b.sugerencias.isEmpty
            if opciones.isEmpty {
                MensajeView(titulo: "No encontramos «\(consulta)»",
                            texto: "Revisa el modelo en la impresora y corrígelo, o pregunta en el mostrador: lo buscamos por ti.",
                            alCorregir: corregir)
            } else {
                VStack(alignment: .leading, spacing: 16) {
                    if let guardadoEn { AvisoDatosGuardados(guardadoEn: guardadoEn) }
                    Text(sonSugerencias ? "¿Quisiste decir…?" : opciones.count == 1 ? "Toca tu impresora" : "\(opciones.count) impresoras · toca la tuya")
                        .font(Tema.fuerte(20)).foregroundStyle(Tema.tintaSuave)
                    ScrollView {
                        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 16), count: columnas), spacing: 16) {
                            ForEach(opciones) { impresora in
                                OpcionImpresora(impresora: impresora, sugerida: sonSugerencias) {
                                    kiosco.elegir(impresora, busquedaId: b.busquedaId)
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    private static func texto(de motivo: MotivoFallo) -> String {
        switch motivo {
        case .red: "Sin conexión, y esta impresora no la habíamos consultado antes. Pregunta en el mostrador."
        case .erp: "Ahora mismo no podemos consultar esta impresora. Pregunta en el mostrador."
        case .permiso: "Esta tablet no está autorizada. Avisa a alguien del mostrador."
        case .servidor: "Algo falló de nuestro lado. Inténtalo otra vez."
        }
    }
}

/// Lo escrito, en grande y en la letra de la placa, con su cursor. El tamaño sigue
/// a la pantalla: el modelo tiene que leerse desde un paso atrás en una tablet de
/// 8" y en una de 13".
private struct CampoView: View {
    let texto: String
    let ancho: CGFloat
    let alto: CGFloat
    let escribiendo: Bool
    let alTocar: () -> Void
    let alLimpiar: () -> Void

    @State private var cursorVisible = true
    private let parpadeo = Timer.publish(every: 0.53, on: .main, in: .common).autoconnect()

    var body: some View {
        let letra = min(56, max(34, min(ancho * 0.042, alto * 0.08)))
        BotonPlano(accion: alTocar) { _ in
            HStack(spacing: 0) {
                if !texto.isEmpty {
                    Text(texto).font(Tema.codigo(letra)).foregroundStyle(Tema.tinta).lineLimit(1).minimumScaleFactor(0.5)
                }
                if escribiendo {
                    RoundedRectangle(cornerRadius: 2).fill(Tema.azul).frame(width: 4, height: letra * 1.1)
                        .opacity(cursorVisible ? 1 : 0).padding(.leading, 3)
                }
                if texto.isEmpty {
                    Text("P1606, MF4100, HL-2350…").font(Tema.codigoCuerpo(letra * 0.6)).foregroundStyle(Tema.tintaTenue).padding(.leading, 16)
                }
                Spacer(minLength: 0)
                if !escribiendo {
                    Text("✎ Corregir").font(Tema.titulo(20)).foregroundStyle(Tema.azulHondo).padding(.horizontal, 16)
                } else if !texto.isEmpty {
                    BotonPlano(accion: alLimpiar) { pulsado in
                        Text("✕").font(Tema.fuerte(32)).foregroundStyle(Tema.tintaTenue)
                            .frame(width: 72, height: 72)
                            .background(RoundedRectangle(cornerRadius: Tema.radio).fill(pulsado ? Tema.tecla : .clear))
                    }
                    .accessibilityLabel("Borrar todo")
                }
            }
            .padding(.leading, 24)
            .padding(.trailing, 16)
            .frame(height: letra * 2)
            .background(RoundedRectangle(cornerRadius: Tema.radio).fill(Tema.superficie))
            .overlay(RoundedRectangle(cornerRadius: Tema.radio).stroke(escribiendo ? Tema.azul : Tema.linea, lineWidth: 3))
        }
        .accessibilityLabel(texto.isEmpty ? "Modelo de la impresora, vacío" : "Modelo: \(texto)\(escribiendo ? "" : ". Toca para corregir")")
        .onReceive(parpadeo) { _ in cursorVisible.toggle() }
    }
}

private struct OpcionImpresora: View {
    let impresora: Impresora
    let sugerida: Bool
    let accion: () -> Void

    var body: some View {
        BotonPlano(accion: accion) { pulsado in
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(impresora.marca.uppercased()).font(Tema.fuerte(18)).kerning(1.5).foregroundStyle(Tema.tintaTenue)
                    Text(impresora.nombre).font(Tema.codigo(36)).foregroundStyle(Tema.tinta).lineLimit(1).minimumScaleFactor(0.5)
                }
                Spacer(minLength: 16)
                Text("›").font(Tema.fuerte(52)).foregroundStyle(Tema.azul)
            }
            .padding(.vertical, 16)
            .padding(.horizontal, 24)
            .frame(minHeight: Tema.alturaBoton + 24)
            .background(pulsado ? Tema.azulSuave : Tema.superficie)
            .overlay(alignment: .leading) { (sugerida ? Tema.tintaTenue : Tema.azul).frame(width: 8) }
            .clipShape(RoundedRectangle(cornerRadius: Tema.radio))
        }
        .accessibilityLabel("\(impresora.marca) \(impresora.nombre)")
    }
}

struct MensajeView: View {
    let titulo: String
    let texto: String
    var aviso = false
    let alCorregir: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(titulo).font(Tema.titulo(28)).foregroundStyle(aviso ? Tema.bajo : Tema.tinta)
            Text(texto).font(Tema.cuerpo(20)).foregroundStyle(Tema.tintaSuave).frame(maxWidth: 760, alignment: .leading)
            BotonPlano(accion: alCorregir) { pulsado in
                Text("Corregir el modelo").font(Tema.titulo(24)).foregroundStyle(Tema.superficie)
                    .padding(.horizontal, 40).frame(height: Tema.alturaBoton)
                    .background(RoundedRectangle(cornerRadius: Tema.radio).fill(pulsado ? Tema.azulHondo : Tema.azul))
            }
            .padding(.top, 16)
        }
        .padding(.top, 24)
    }
}
