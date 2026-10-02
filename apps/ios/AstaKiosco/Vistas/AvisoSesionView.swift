import SwiftUI

/// «¿Sigues ahí?», 30 segundos antes de cerrar la sesión (#41).
///
/// Tapa la pantalla a propósito: si el cliente está leyendo y no ve el aviso, se
/// le cierra la sesión mientras compara dos tóners y parece una avería. El botón
/// grande es el de seguir: cerrar ya ocurre solo.
///
/// La cuenta atrás es solo para la vista: quien cierra es `Sesion`.
struct AvisoSesionView: View {
    let alSeguir: () -> Void
    let alTerminar: () -> Void

    @State private var fin = Date().addingTimeInterval(30)

    var body: some View {
        ZStack {
            Tema.tinta.opacity(0.72).ignoresSafeArea()
            VStack(alignment: .leading, spacing: 40) {
                HStack(spacing: 40) {
                    TimelineView(.periodic(from: .now, by: 0.25)) { contexto in
                        let quedan = max(0, Int(fin.timeIntervalSince(contexto.date).rounded(.up)))
                        VStack(spacing: -4) {
                            Text("\(quedan)").font(Tema.codigo(52)).foregroundStyle(Tema.tinta)
                            Text("seg").font(Tema.medio(16)).foregroundStyle(Tema.tintaTenue)
                        }
                        .frame(width: 128, height: 128)
                        .overlay(Circle().stroke(Tema.azul, lineWidth: 8))
                    }
                    VStack(alignment: .leading, spacing: 8) {
                        Text("¿Sigues ahí?").font(Tema.titulo(40)).foregroundStyle(Tema.tinta)
                        Text("Vamos a cerrar esta consulta para dejar la tablet libre.").font(Tema.cuerpo(24)).foregroundStyle(Tema.tintaSuave)
                    }
                }
                HStack(spacing: 16) {
                    BotonPlano(accion: alTerminar) { pulsado in
                        Text("Ya terminé").font(Tema.fuerte(24)).foregroundStyle(Tema.tintaSuave)
                            .frame(maxWidth: .infinity).frame(height: Tema.alturaBoton)
                            .background(RoundedRectangle(cornerRadius: Tema.radio).fill(pulsado ? Tema.tecla : .clear))
                            .overlay(RoundedRectangle(cornerRadius: Tema.radio).stroke(Tema.linea, lineWidth: 2))
                    }
                    .frame(maxWidth: .infinity)
                    BotonPlano(accion: alSeguir) { pulsado in
                        Text("Sigo aquí").font(Tema.titulo(28)).foregroundStyle(Tema.superficie)
                            .frame(maxWidth: .infinity).frame(height: Tema.alturaBoton)
                            .background(RoundedRectangle(cornerRadius: Tema.radio).fill(pulsado ? Tema.azulHondo : Tema.azul))
                    }
                    .frame(maxWidth: .infinity)
                    .layoutPriority(1)
                }
            }
            .padding(40)
            .frame(maxWidth: 760)
            .background(Tema.superficie)
            .overlay(alignment: .top) { Tema.azul.frame(height: 10) }
            .clipShape(RoundedRectangle(cornerRadius: Tema.radio))
            .padding(40)
        }
    }
}
