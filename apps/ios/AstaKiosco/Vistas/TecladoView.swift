import SwiftUI

/// Teclado propio del kiosco, para escribir modelos de impresora (#40).
///
/// ── Por qué no el del sistema ────────────────────────────────────────────────
///
/// El del sistema tapa media pantalla justo donde salen los resultados, trae
/// emojis, dictado y autocorrección —que convierte «MF4100» en otra cosa— y se
/// cierra si el cliente toca fuera. Un modelo de impresora son letras, números y
/// guiones: con eso, en teclas grandes y siempre en el mismo sitio, basta. Sin
/// minúsculas: los modelos vienen en mayúsculas en la placa.
///
/// QWERTY escalonado, como uno físico: es el que la gente tiene en la cabeza.
/// Las teclas crecen con el hueco, con un tope para que no salgan de un palmo.
struct TecladoView: View {
    let alEscribir: (String) -> Void
    let alBorrar: () -> Void
    let alBuscar: () -> Void
    let puedeBuscar: Bool

    private enum Pieza: Hashable {
        case letra(String, peso: Double = 1)
        case hueco(Double)
        case borrar, espacio, buscar
    }

    private static let filas: [[Pieza]] = [
        "1234567890".map { .letra(String($0)) },
        "QWERTYUIOP".map { .letra(String($0)) },
        [.hueco(0.5)] + "ASDFGHJKL".map { .letra(String($0)) } + [.hueco(0.5)],
        [.hueco(1.5)] + "ZXCVBNM".map { .letra(String($0)) } + [.borrar],
        [.letra("-", peso: 1.5), .espacio, .buscar],
    ]

    private static let separacion: CGFloat = 10
    private static let altoMaximoTecla: CGFloat = 88

    var body: some View {
        GeometryReader { geo in
            let alto = min(Self.altoMaximoTecla, (geo.size.height - 28 - 4 * Self.separacion) / 5)
            let unidad = (geo.size.width - 28 - 9 * Self.separacion) / 10
            VStack(spacing: Self.separacion) {
                ForEach(Array(Self.filas.enumerated()), id: \.offset) { _, fila in
                    HStack(spacing: Self.separacion) {
                        ForEach(Array(fila.enumerated()), id: \.offset) { _, pieza in
                            vista(pieza, unidad: unidad).frame(height: alto)
                        }
                    }
                }
            }
            .padding(14)
            .background(RoundedRectangle(cornerRadius: Tema.radio + 4).fill(Tema.tecla))
            .frame(maxHeight: .infinity, alignment: .bottom)
        }
        .frame(minHeight: 5 * 48 + 4 * Self.separacion + 28, maxHeight: 5 * Self.altoMaximoTecla + 4 * Self.separacion + 28)
    }

    private func ancho(_ peso: Double, _ unidad: CGFloat) -> CGFloat {
        unidad * peso + Self.separacion * (peso - 1)
    }

    @ViewBuilder
    private func vista(_ pieza: Pieza, unidad: CGFloat) -> some View {
        switch pieza {
        case let .letra(t, peso):
            Tecla(etiqueta: t, accesible: t == "-" ? "Guion" : t) { alEscribir(t) }.frame(width: ancho(peso, unidad))
        case let .hueco(peso):
            Color.clear.frame(width: max(0, ancho(peso, unidad)))
        case .borrar:
            Tecla(etiqueta: "⌫ Borrar", accesible: "Borrar", secundaria: true, pequena: true, accion: alBorrar).frame(width: ancho(1.5, unidad))
        case .espacio:
            Tecla(etiqueta: "espacio", accesible: "Espacio", secundaria: true, pequena: true) { alEscribir(" ") }.frame(width: ancho(4, unidad))
        case .buscar:
            BotonPlano(accion: alBuscar) { pulsado in
                Text("Buscar  →")
                    .font(Tema.titulo(28))
                    .foregroundStyle(Tema.superficie)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(canto(relleno: puedeBuscar ? (pulsado ? Tema.azulHondo : Tema.azul) : Color(hex: 0x9FCDEB),
                                      canto: puedeBuscar ? Tema.azulHondo : Color(hex: 0x8ABFE2)))
            }
            .disabled(!puedeBuscar)
            .frame(width: ancho(4.5, unidad))
            .accessibilityLabel("Buscar")
        }
    }
}

/// El canto inferior de una tecla física: sin él, una cuadrícula blanca no se
/// lee como algo que se pulsa.
private func canto(relleno: Color, canto: Color) -> some View {
    RoundedRectangle(cornerRadius: Tema.radio).fill(canto)
        .overlay(alignment: .top) { RoundedRectangle(cornerRadius: Tema.radio).fill(relleno).padding(.bottom, 4) }
}

private struct Tecla: View {
    let etiqueta: String
    var accesible: String
    var secundaria = false
    var pequena = false
    let accion: () -> Void

    init(etiqueta: String, accesible: String, secundaria: Bool = false, pequena: Bool = false, accion: @escaping () -> Void) {
        self.etiqueta = etiqueta
        self.accesible = accesible
        self.secundaria = secundaria
        self.pequena = pequena
        self.accion = accion
    }

    var body: some View {
        BotonPlano(accion: accion) { pulsado in
            Text(etiqueta)
                .font(pequena ? Tema.fuerte(20) : Tema.codigoFuerte(32))
                .foregroundStyle(pulsado ? Tema.superficie : (pequena ? Tema.tintaSuave : Tema.tinta))
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(canto(
                    relleno: pulsado ? Tema.azul : (secundaria ? Color(hex: 0xD3DCE5) : Tema.superficie),
                    canto: pulsado ? Tema.azulHondo : (secundaria ? Color(hex: 0xB9C5D1) : Tema.linea)
                ))
        }
        .accessibilityLabel(accesible)
    }
}
