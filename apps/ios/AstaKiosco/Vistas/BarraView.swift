import SwiftUI

/// Logo, «1 Tu impresora › 2 Tu tóner», la conexión y «Terminar».
struct BarraView: View {
    let paso: Int
    let estado: EstadoConexion
    let alTerminar: () -> Void

    var body: some View {
        HStack(spacing: 40) {
            Logo(ancho: 104, color: Tema.azul)
            // Los pasos no caben en una pantalla estrecha, y ahí sobran: el título
            // de cada pantalla ya dice dónde se está.
            ViewThatFits(in: .horizontal) {
                pasos
                Color.clear.frame(height: 1)
            }
            .frame(maxWidth: .infinity)
            HStack(spacing: 24) {
                IndicadorConexion(estado: estado)
                BotonTerminar(accion: alTerminar)
            }
        }
        .padding(.horizontal, 40)
        .padding(.vertical, 12)
        .background(Tema.superficie)
        .overlay(alignment: .bottom) { Tema.linea.frame(height: 1) }
    }

    private var pasos: some View {
        HStack(spacing: 16) {
            ForEach(Array(["Tu impresora", "Tu tóner"].enumerated()), id: \.offset) { i, nombre in
                if i > 0 { Text("›").font(Tema.fuerte(28)).foregroundStyle(Tema.tintaTenue) }
                let activo = paso == i + 1
                HStack(spacing: 8) {
                    Text("\(i + 1)")
                        .font(Tema.codigoFuerte(16))
                        .foregroundStyle(activo ? Tema.superficie : Tema.tintaTenue)
                        .frame(width: 32, height: 32)
                        .background(Circle().fill(activo ? Tema.azul : .clear))
                        .overlay(Circle().stroke(activo ? Tema.azul : Tema.linea, lineWidth: 2))
                    Text(nombre)
                        .font(activo ? Tema.titulo(20) : Tema.medio(20))
                        .foregroundStyle(activo ? Tema.tinta : Tema.tintaTenue)
                }
            }
        }
        .fixedSize()
    }
}

/// «Terminar», visible en toda pantalla con sesión abierta (#41): el cliente
/// tiene que poder irse dejando la tablet limpia sin esperar cuatro minutos.
struct BotonTerminar: View {
    let accion: () -> Void

    var body: some View {
        BotonPlano(accion: accion) { pulsado in
            Text("✕  Terminar")
                .font(Tema.fuerte(20))
                .foregroundStyle(Tema.tintaSuave)
                .padding(.horizontal, 24)
                .frame(height: Tema.alturaBoton - 8)
                .background(RoundedRectangle(cornerRadius: Tema.radio).fill(pulsado ? Tema.tecla : Tema.superficie))
                .overlay(RoundedRectangle(cornerRadius: Tema.radio).stroke(Tema.linea, lineWidth: 2))
        }
        .accessibilityLabel("Terminar y borrar esta consulta")
    }
}

/// Estado de la conexión, siempre visible (#42). Es para el PERSONAL: si la
/// tablet lleva media mañana sin red, alguien tiene que verlo. En verde casi no
/// se ve; cuando algo falla es una etiqueta de color.
struct IndicadorConexion: View {
    let estado: EstadoConexion
    var sobreAzul = false

    var body: some View {
        let (color, fondo, texto): (Color, Color, String) = switch estado {
        case .conectado: (Tema.disponible, .clear, "En línea")
        case .sinConexion: (Tema.agotado, Tema.agotadoSuave, "Sin conexión")
        case .sinDatosVivos: (Tema.bajo, Tema.bajoSuave, "Sin datos en vivo")
        }
        let enCalma = estado == .conectado
        HStack(spacing: 8) {
            Circle().fill(enCalma && sobreAzul ? Tema.sobreAzul : color).frame(width: 12, height: 12)
            Text(texto)
                .font(enCalma ? Tema.medio(20) : Tema.fuerte(20))
                .foregroundStyle(enCalma ? (sobreAzul ? Tema.sobreAzul : Tema.tintaTenue) : color)
        }
        .padding(.horizontal, enCalma ? 0 : 16)
        .frame(height: 40)
        .background(RoundedRectangle(cornerRadius: Tema.radio).fill(fondo))
        .accessibilityElement(children: .combine)
    }
}

/// «Esto es de hace un rato» (#42). Encima de los datos guardados: el cliente
/// tiene que leerlo ANTES de mirar la existencia.
struct AvisoDatosGuardados: View {
    let guardadoEn: Date

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Datos de \(haceCuanto(guardadoEn))").font(Tema.titulo(20)).foregroundStyle(Tema.bajo)
            Text("Ahora mismo no podemos consultar la existencia. Confírmala en el mostrador.")
                .font(Tema.cuerpo(20)).foregroundStyle(Tema.tinta)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(24)
        .background(Tema.bajoSuave)
        .overlay(alignment: .leading) { Tema.bajo.frame(width: 8) }
        .clipShape(RoundedRectangle(cornerRadius: Tema.radio))
    }
}
