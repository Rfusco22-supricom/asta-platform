import Combine
import SwiftUI

/// Lo que se ve cuando nadie está usando la tablet (#40).
///
/// Que alguien que pasa por delante entienda en dos segundos qué hace y la toque:
/// una frase grande, una instrucción, y toda la pantalla es el botón.
///
/// A la derecha, la placa de una impresora con el modelo marcado, rotando entre
/// marcas. Responde a la duda que de verdad frena a la gente —«¿y cuál es mi
/// modelo?»— y enseña que basta con el código.
struct AtraccionView: View {
    let estado: EstadoConexion
    let alEmpezar: () -> Void

    private static let ejemplos = [
        ("HP LaserJet Professional", "P1606dn"),
        ("Canon i-SENSYS", "MF4570dn"),
        ("Brother", "HL-L2350DW"),
        ("Samsung Xpress", "M2020W"),
    ]

    @State private var indice = 0
    @State private var latido = false
    private let rotacion = Timer.publish(every: 3.2, on: .main, in: .common).autoconnect()

    var body: some View {
        BotonPlano(accion: alEmpezar) { _ in
            GeometryReader { geo in
                // Proporción fija, y no `layoutPriority`: con el título largo la
                // izquierda se lo comía todo y la placa quedaba de un dedo de ancho.
                let separacion = min(64, geo.size.width * 0.05)
                let util = geo.size.width - separacion
                HStack(alignment: .center, spacing: separacion) {
                    izquierda.frame(width: util * 0.56, alignment: .leading)
                    derecha.frame(width: util * 0.44, alignment: .leading)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            .padding(.horizontal, 64)
            .padding(.vertical, 40)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Tema.azul)
            .overlay(alignment: .topTrailing) {
                IndicadorConexion(estado: estado, sobreAzul: true).padding(.top, 16).padding(.trailing, 40)
            }
        }
        .accessibilityLabel("Empezar a buscar tu tóner")
        .onReceive(rotacion) { _ in
            withAnimation(.easeInOut(duration: 0.3)) { indice = (indice + 1) % Self.ejemplos.count }
        }
        .onAppear {
            // Un pulso lento en el botón: algo que se mueve se ve desde el pasillo,
            // y lento para que no parezca un anuncio.
            withAnimation(.easeInOut(duration: 1.1).repeatForever(autoreverses: true)) { latido = true }
        }
    }

    private var izquierda: some View {
        VStack(alignment: .leading, spacing: 40) {
            Logo(ancho: 210, color: Tema.superficie)
            VStack(alignment: .leading, spacing: 24) {
                Text("¿Qué tóner necesita tu impresora?")
                    .font(Tema.titulo(72))
                    .kerning(-1.5)
                    .foregroundStyle(Tema.superficie)
                    .lineSpacing(-4)
                    .minimumScaleFactor(0.6)
                Text("Escribe el modelo y te decimos cuál le sirve y si lo tenemos en la tienda.")
                    .font(Tema.cuerpo(28))
                    .foregroundStyle(Tema.sobreAzul)
                    .frame(maxWidth: 620, alignment: .leading)
            }
            HStack(spacing: 24) {
                Text("Toca para empezar").font(Tema.titulo(34)).foregroundStyle(Tema.azulHondo)
                Text("→").font(Tema.titulo(40)).foregroundStyle(Tema.azul)
            }
            .padding(.horizontal, 40)
            .frame(height: Tema.alturaBoton + 16)
            .background(RoundedRectangle(cornerRadius: Tema.radio).fill(Tema.superficie))
            .scaleEffect(latido ? 1.035 : 1)
        }
    }

    private var derecha: some View {
        let (linea, modelo) = Self.ejemplos[indice]
        return VStack(alignment: .leading, spacing: 24) {
            Text("DÓNDE ESTÁ TU MODELO").font(Tema.fuerte(18)).kerning(2.5).foregroundStyle(Tema.sobreAzul)
            // El frente de una impresora, con su placa.
            VStack(spacing: 24) {
                Capsule().fill(Color(hex: 0xC9D3DC)).frame(height: 18).padding(.horizontal, 40)
                VStack(alignment: .leading, spacing: 8) {
                    Text(linea).font(Tema.medio(20)).foregroundStyle(Color(hex: 0xAEB9C4)).lineLimit(1)
                    Text(modelo)
                        .font(Tema.codigo(48))
                        .foregroundStyle(Tema.superficie)
                        .lineLimit(1)
                        .minimumScaleFactor(0.5)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 2)
                        .background(Tema.azul.opacity(0.18))
                        .overlay(RoundedRectangle(cornerRadius: 4).stroke(Tema.azul, lineWidth: 4))
                }
                .id(indice)
                .transition(.opacity)
                .frame(maxWidth: .infinity, minHeight: 150, alignment: .leading)
                .padding(24)
                .background(RoundedRectangle(cornerRadius: 6).fill(Color(hex: 0x2A3440)))
                Capsule().fill(Color(hex: 0x1D252E)).frame(height: 14).padding(.horizontal, 64)
            }
            .padding(24)
            .background(RoundedRectangle(cornerRadius: 14).fill(Color(hex: 0xE9EEF2)))
            .shadow(color: Color(hex: 0x062E4A).opacity(0.35), radius: 24, y: 14)
            Text("Suele estar impreso en el frente o en la tapa. Basta con las letras y los números.")
                .font(Tema.cuerpo(20)).foregroundStyle(Tema.sobreAzul)
        }
    }
}
