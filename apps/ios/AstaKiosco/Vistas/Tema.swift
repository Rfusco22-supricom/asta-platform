import SwiftUI

/// Identidad visual del kiosco: la misma «Cristal» del panel (`apps/web`), y la
/// misma que `ui/Tema.kt` en Android.
///
/// Fondo claro con las luces de la marca (cian del logo, violeta y rosa),
/// tarjetas de vidrio blanco y el degradado de la marca en lo que se toca. Sora
/// en los textos y DM Mono en modelos y códigos de cartucho, como vienen
/// impresos en la etiqueta. Fondo claro: en una tienda iluminada se lee mejor
/// que uno oscuro.
///
/// Se usa DE PIE y a distancia de brazo: el cuerpo base son 24 pt y ningún texto
/// que el cliente tenga que leer baja de 20. Los botones miden 72 pt de alto.
enum Tema {
    /// El azul de los botones y lo activo: entre el cian del logo y el azul del degradado.
    static let azul = Color(hex: 0x2A86F0)
    static let azulHondo = Color(hex: 0x1B63C9)
    static let azulSuave = Color(hex: 0xE6F2FD)
    /// Texto secundario sobre el degradado de marca.
    static let sobreAzul = Color(hex: 0xE4F1FF)

    static let cian = Color(hex: 0x27A9F1)
    static let violeta = Color(hex: 0x7C5CFF)
    static let rosa = Color(hex: 0xFF5C93)
    /// El degradado de la marca: cian → azul → violeta, en diagonal.
    static let degradado = LinearGradient(colors: [cian, Color(hex: 0x4F86F7), violeta], startPoint: .topLeading, endPoint: .bottomTrailing)

    static let papel = Color(hex: 0xEDF2F8)
    static let superficie = Color.white
    static let linea = Color(hex: 0xDCE5EF)
    static let tecla = Color(hex: 0xE8EEF5)

    static let tinta = Color(hex: 0x0F2236)
    static let tintaSuave = Color(hex: 0x44546A)
    static let tintaTenue = Color(hex: 0x66768B)

    static let disponible = Color(hex: 0x0E8A55)
    static let disponibleSuave = Color(hex: 0xE2F5EC)
    static let bajo = Color(hex: 0x9A6200)
    static let bajoSuave = Color(hex: 0xFFF3DC)
    static let agotado = Color(hex: 0xC8304F)
    static let agotadoSuave = Color(hex: 0xFFE9EE)

    static let alturaBoton: CGFloat = 72
    /// Esquinas de vidrio: redondeadas, como las tarjetas del panel.
    static let radio: CGFloat = 18

    // Tamaños fijos a propósito: el kiosco no sigue el tamaño de letra del
    // sistema, que en una tablet compartida puso alguien y no el cliente.
    static func titulo(_ t: CGFloat) -> Font { .custom("Sora-Bold", fixedSize: t) }
    static func fuerte(_ t: CGFloat) -> Font { .custom("Sora-SemiBold", fixedSize: t) }
    static func medio(_ t: CGFloat) -> Font { .custom("Sora-Medium", fixedSize: t) }
    static func cuerpo(_ t: CGFloat) -> Font { .custom("Sora-Regular", fixedSize: t) }
    static func codigo(_ t: CGFloat) -> Font { .custom("DMMono-Medium", fixedSize: t) }
    static func codigoFuerte(_ t: CGFloat) -> Font { .custom("DMMono-Medium", fixedSize: t) }
    static func codigoCuerpo(_ t: CGFloat) -> Font { .custom("DMMono-Regular", fixedSize: t) }

    static func colores(de stock: EstadoStock) -> (texto: Color, fondo: Color) {
        switch stock {
        case .disponible: (disponible, disponibleSuave)
        case .bajo: (bajo, bajoSuave)
        case .agotado: (agotado, agotadoSuave)
        }
    }
}

/// El fondo de las pantallas con sesión: el tono base y tres luces difusas de
/// la marca, como el fondo del panel. Son degradados: no cuestan nada.
struct FondoCristal: View {
    var body: some View {
        ZStack {
            Tema.papel
            GeometryReader { geo in
                let w = geo.size.width
                let h = geo.size.height
                ZStack {
                    luz(Tema.cian.opacity(0.34), radio: w * 0.5).position(x: w * 0.04, y: -h * 0.08)
                    luz(Tema.violeta.opacity(0.22), radio: w * 0.45).position(x: w * 1.02, y: h * 0.02)
                    luz(Tema.rosa.opacity(0.16), radio: w * 0.5).position(x: w * 0.72, y: h * 1.1)
                }
            }
        }
        .ignoresSafeArea()
    }

    private func luz(_ color: Color, radio: CGFloat) -> some View {
        Circle()
            .fill(RadialGradient(colors: [color, color.opacity(0)], center: .center, startRadius: 0, endRadius: radio))
            .frame(width: radio * 2, height: radio * 2)
    }
}

extension View {
    /// Una tarjeta de vidrio: blanco casi opaco, borde blanco y sombra larga y suave.
    func vidrio(radio: CGFloat = Tema.radio, relleno: Color = Tema.superficie.opacity(0.82)) -> some View {
        background(RoundedRectangle(cornerRadius: radio).fill(relleno))
            .overlay(RoundedRectangle(cornerRadius: radio).stroke(Color.white.opacity(0.9), lineWidth: 1.5))
            .shadow(color: Color(hex: 0x123460).opacity(0.14), radius: 22, y: 12)
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
