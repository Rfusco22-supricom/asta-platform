import SwiftUI

/// Identidad visual del kiosco (#40). La misma que `apps/mobile/src/tema.ts`.
///
/// Del logo de Asta: el azul (#0E8FDA) y sus letras de trazo grueso, cortes
/// rectos y esquinas apenas redondeadas. Archivo en los títulos y JetBrains Mono
/// en modelos y códigos de cartucho, como vienen impresos en la etiqueta. Fondo
/// claro: en una tienda iluminada se lee mejor que uno oscuro.
///
/// Se usa DE PIE y a distancia de brazo: el cuerpo base son 24 pt y ningún texto
/// que el cliente tenga que leer baja de 20. Los botones miden 72 pt de alto.
enum Tema {
    static let azul = Color(hex: 0x0E8FDA)
    static let azulHondo = Color(hex: 0x0A6FAD)
    static let azulSuave = Color(hex: 0xE3F2FC)
    /// Texto secundario sobre el azul de marca.
    static let sobreAzul = Color(hex: 0xCFEAFB)

    static let papel = Color(hex: 0xF2F5F8)
    static let superficie = Color.white
    static let linea = Color(hex: 0xD8E0E8)
    static let tecla = Color(hex: 0xE6ECF2)

    static let tinta = Color(hex: 0x0B1F33)
    static let tintaSuave = Color(hex: 0x46596B)
    static let tintaTenue = Color(hex: 0x7E8E9E)

    static let disponible = Color(hex: 0x12805C)
    static let disponibleSuave = Color(hex: 0xE2F4EC)
    static let bajo = Color(hex: 0x9A5800)
    static let bajoSuave = Color(hex: 0xFDF0D9)
    static let agotado = Color(hex: 0xB42318)
    static let agotadoSuave = Color(hex: 0xFCE9E7)

    static let alturaBoton: CGFloat = 72
    /// Esquinas cortas, como las del logo.
    static let radio: CGFloat = 6

    // Tamaños fijos a propósito: el kiosco no sigue el tamaño de letra del
    // sistema, que en una tablet compartida puso alguien y no el cliente.
    static func titulo(_ t: CGFloat) -> Font { .custom("Archivo-ExtraBold", fixedSize: t) }
    static func fuerte(_ t: CGFloat) -> Font { .custom("Archivo-Bold", fixedSize: t) }
    static func medio(_ t: CGFloat) -> Font { .custom("Archivo-SemiBold", fixedSize: t) }
    static func cuerpo(_ t: CGFloat) -> Font { .custom("Archivo-Medium", fixedSize: t) }
    static func codigo(_ t: CGFloat) -> Font { .custom("JetBrainsMono-ExtraBold", fixedSize: t) }
    static func codigoFuerte(_ t: CGFloat) -> Font { .custom("JetBrainsMono-Bold", fixedSize: t) }
    static func codigoCuerpo(_ t: CGFloat) -> Font { .custom("JetBrainsMono-Medium", fixedSize: t) }

    static func colores(de stock: EstadoStock) -> (texto: Color, fondo: Color) {
        switch stock {
        case .disponible: (disponible, disponibleSuave)
        case .bajo: (bajo, bajoSuave)
        case .agotado: (agotado, agotadoSuave)
        }
    }
}

extension Color {
    init(hex: UInt32) {
        self.init(red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255, blue: Double(hex & 0xFF) / 255)
    }
}

/// El logo de Asta, recortado a sus letras (sacado del de `apps/web`), del color que toque.
struct Logo: View {
    let ancho: CGFloat
    let color: Color

    var body: some View {
        Image("AstaLogo")
            .renderingMode(.template)
            .resizable()
            .scaledToFit()
            .frame(width: ancho)
            .foregroundStyle(color)
            .accessibilityLabel("Asta")
    }
}

/// Un botón de toque grande: sin el resaltado azul del sistema, con el nuestro.
struct BotonPlano<Contenido: View>: View {
    let accion: () -> Void
    @ViewBuilder let contenido: (Bool) -> Contenido

    var body: some View {
        Button(action: accion) { EmptyView() }
            .buttonStyle(EstiloPlano(contenido: contenido))
    }

    private struct EstiloPlano: ButtonStyle {
        let contenido: (Bool) -> Contenido
        func makeBody(configuration: Configuration) -> some View {
            contenido(configuration.isPressed)
                .contentShape(Rectangle())
                // Sin fundido: con él, el texto cambiaba de color antes que el
                // fondo y una tecla recién soltada se veía un instante en blanco.
                .animation(nil, value: configuration.isPressed)
        }
    }
}
