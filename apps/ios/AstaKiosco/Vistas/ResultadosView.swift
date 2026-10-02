import SwiftUI

/// Qué le sirve a la impresora del cliente, y si lo hay aquí (#40, sobre #39).
///
/// Solo salen compatibilidades verificadas por una persona; de eso se encarga el
/// servidor. De arriba abajo: la respuesta corta, el código del cartucho; las
/// opciones, lo que hay en tienda primero; y al tocar una, el pie dice qué pedir
/// en el mostrador, para que el dependiente no tenga que adivinar cuál.
///
/// Sin precios: la tarifa del cliente es #31. Decirlos mal en piso de venta es
/// peor que no decirlos.
struct ResultadosView: View {
    let kiosco: Kiosco
    let impresora: Impresora
    let busquedaId: String?

    private enum Estado {
        case cargando
        case listo(ParaEnsenar, guardadoEn: Date?)
        case fallo(String)
    }

    @State private var estado: Estado = .cargando
    @State private var elegido: Int?

    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            cabecera
            switch estado {
            case .cargando:
                ProgressView().controlSize(.large).tint(Tema.azul).frame(maxWidth: .infinity).padding(.top, 64)
            case let .fallo(texto):
                Text(texto).font(Tema.fuerte(24)).foregroundStyle(Tema.bajo).padding(.top, 40)
            case let .listo(.sinNada, guardadoEn):
                if let guardadoEn { AvisoDatosGuardados(guardadoEn: guardadoEn) }
                sinTonerCargado
            case let .listo(.sinAsta, guardadoEn):
                if let guardadoEn { AvisoDatosGuardados(guardadoEn: guardadoEn) }
                sinAstaParaEsta
            case let .listo(.asta(productos), guardadoEn):
                let sugerido = recomendado(productos)
                HStack(alignment: .top, spacing: 40) {
                    respuesta(productos, sugerido: sugerido)
                    VStack(spacing: 16) {
                        ScrollView {
                            VStack(spacing: 16) {
                                if let guardadoEn { AvisoDatosGuardados(guardadoEn: guardadoEn) }
                                ForEach(productos) { p in
                                    EtiquetaView(producto: p, impresora: impresora, elegido: p.id == elegido, recomendado: p.id == sugerido?.id) {
                                        // Sin conexión no se registra: el clic se perdería y no
                                        // merece una cola que sobreviva a la sesión (#41).
                                        if guardadoEn == nil && p.id != elegido {
                                            kiosco.datos.api.registrarClic(busquedaId: busquedaId, productId: p.id)
                                        }
                                        elegido = p.id
                                    }
                                }
                            }
                        }
                        pie(productos.first { $0.id == elegido })
                    }
                }
            }
        }
        .padding(.horizontal, 40)
        .padding(.top, 8)
        .padding(.bottom, 24)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        // `recargas` cambia cuando vuelve la red: se vuelve a pedir lo mismo, en vivo (#42).
        .task(id: kiosco.vigilante.recargas) { await cargar() }
    }

    private func cargar() async {
        switch await kiosco.datos.compatibles(impresora.id, busquedaId: busquedaId, informar: kiosco.informar) {
        case let .ok(productos, guardadoEn):
            estado = .listo(queEnsenar(productos), guardadoEn: guardadoEn)
        case let .fallo(motivo):
            estado = .fallo(motivo == .red || motivo == .erp
                ? "Ahora mismo no podemos consultar esta impresora, y no la habíamos consultado antes. Pregunta en el mostrador."
                : "No pudimos consultarlo ahora mismo.")
        }
    }

    private var cabecera: some View {
        HStack(spacing: 24) {
            BotonPlano(accion: { kiosco.volverABuscar() }) { pulsado in
                Text("‹ Buscar otra").font(Tema.titulo(20)).foregroundStyle(Tema.azulHondo)
                    .padding(.horizontal, 24).frame(height: Tema.alturaBoton - 8)
                    .background(RoundedRectangle(cornerRadius: Tema.radio).fill(pulsado ? Tema.azulSuave : Tema.superficie))
                    .overlay(RoundedRectangle(cornerRadius: Tema.radio).stroke(Tema.azul, lineWidth: 2))
            }
            VStack(alignment: .leading, spacing: 0) {
                Text("PARA TU IMPRESORA").font(Tema.fuerte(18)).kerning(1.5).foregroundStyle(Tema.tintaTenue)
                (Text(impresora.marca + " ").font(Tema.titulo(40)).foregroundColor(Tema.tintaSuave)
                    + Text(impresora.nombre).font(Tema.codigo(40)).foregroundColor(Tema.tinta))
                    .lineLimit(1).minimumScaleFactor(0.5)
            }
        }
    }

    /// La respuesta corta, a la izquierda: no se mueve al desplazar la lista.
    private func respuesta(_ productos: [ProductoCompatible], sugerido: ProductoCompatible?) -> some View {
        let codigos = codigosDeCartucho(productos)
        let enTienda = productos.filter { $0.stock != .agotado }.count
        return VStack(alignment: .leading, spacing: 8) {
            Text(codigos.count == 1 ? "USA EL CARTUCHO" : "USA LOS CARTUCHOS").font(Tema.fuerte(16)).kerning(2.5).foregroundStyle(Tema.sobreAzul)
            ForEach(codigos, id: \.self) { c in
                Text(c).font(Tema.codigo(56)).foregroundStyle(Tema.superficie).lineLimit(1).minimumScaleFactor(0.5)
            }
            Rectangle().fill(.white.opacity(0.28)).frame(height: 2).padding(.vertical, 8)
            (Text("\(productos.count) \(productos.count == 1 ? "opción" : "opciones")").font(Tema.titulo(20)).foregroundColor(Tema.superficie)
                + Text(enTienda > 0 ? " · \(enTienda) en tienda" : " · ninguna en tienda ahora: se puede encargar"))
                .font(Tema.cuerpo(20)).foregroundStyle(Tema.sobreAzul)
            // Lo que la tienda quiere vender, dicho donde el cliente mira primero.
            if let sugerido {
                VStack(alignment: .leading, spacing: 4) {
                    Text("TE RECOMENDAMOS").font(Tema.fuerte(14)).kerning(2).foregroundStyle(Tema.azulHondo)
                    Text(sugerido.titulo(para: impresora)).font(Tema.titulo(22)).foregroundStyle(Tema.tinta)
                    Text(sugerido.stock.texto).font(Tema.fuerte(18)).foregroundStyle(Tema.disponible)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(16)
                .background(RoundedRectangle(cornerRadius: Tema.radio).fill(Tema.superficie))
                .padding(.top, 16)
            }
        }
        .padding(24)
        .frame(width: 340, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: Tema.radio).fill(Tema.azul))
    }

    private func pie(_ elegido: ProductoCompatible?) -> some View {
        Group {
            if let elegido {
                (Text("Enseña esta pantalla en el mostrador y pide ")
                    + Text(elegido.sku ?? elegido.titulo(para: impresora)).font(Tema.codigo(20)).foregroundColor(Tema.azulHondo))
                    .foregroundStyle(Tema.tinta)
            } else {
                Text("Toca el que quieras llevarte y enséñale la pantalla al mostrador.").foregroundStyle(Tema.tintaSuave)
            }
        }
        .font(Tema.medio(20))
        .frame(maxWidth: .infinity, minHeight: 56, alignment: .leading)
        .padding(.top, 16)
        .overlay(alignment: .top) {
            Line().stroke(elegido == nil ? Tema.linea : Tema.azul, style: StrokeStyle(lineWidth: 2, dash: [6, 4])).frame(height: 2)
        }
    }

    /// La impresora está y tiene consumibles verificados, pero ninguno es Asta y el
    /// kiosco solo ofrece Asta (`queEnsenar`). Se dice tal cual: decir «no hay
    /// nada» sería mentira, y enseñar el original sería hacer lo contrario de lo
    /// que se pidió. Quien puede ofrecer la alternativa es el mostrador.
    private var sinAstaParaEsta: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("★ ASTA PARA TU IMPRESORA").font(Tema.fuerte(16)).kerning(2.5).foregroundStyle(Tema.azulHondo)
            Text("Todavía no tenemos Asta para esta impresora.")
                .font(Tema.titulo(28)).foregroundStyle(Tema.tinta)
            (Text("Pregunta en el mostrador y te decimos qué opciones hay para tu ")
                + Text("\(impresora.marca) \(impresora.nombre)").font(Tema.codigoFuerte(24)).foregroundColor(Tema.tinta))
                .font(Tema.cuerpo(24)).foregroundStyle(Tema.tintaSuave)
        }
        .padding(40)
        .frame(maxWidth: 820, alignment: .leading)
        .background(Tema.superficie)
        .overlay(alignment: .leading) { Tema.azul.frame(width: 10) }
        .clipShape(RoundedRectangle(cornerRadius: Tema.radio))
        .padding(.top, 24)
    }

    /// Pasa con las impresoras que vendemos y cuyo tóner aún no se ha validado: el
    /// kiosco las encuentra, pero no recomienda nada sin verificar. Que se lea
    /// como un paso, no como un error.
    private var sinTonerCargado: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("TE AYUDAMOS EN EL MOSTRADOR").font(Tema.fuerte(16)).kerning(2.5).foregroundStyle(Tema.azulHondo)
            Text("Aún no tenemos cargado en el kiosco qué tóner le sirve a esta impresora.")
                .font(Tema.titulo(28)).foregroundStyle(Tema.tinta)
            (Text("Enseña esta pantalla en el mostrador y te decimos cuál es y si lo tenemos: ")
                + Text("\(impresora.marca) \(impresora.nombre)").font(Tema.codigoFuerte(24)).foregroundColor(Tema.tinta))
                .font(Tema.cuerpo(24)).foregroundStyle(Tema.tintaSuave)
        }
        .padding(40)
        .frame(maxWidth: 820, alignment: .leading)
        .background(Tema.superficie)
        .overlay(alignment: .leading) { Tema.azul.frame(width: 10) }
        .clipShape(RoundedRectangle(cornerRadius: Tema.radio))
        .padding(.top, 24)
    }
}

private struct Line: Shape {
    func path(in rect: CGRect) -> Path {
        Path { p in
            p.move(to: CGPoint(x: 0, y: rect.midY))
            p.addLine(to: CGPoint(x: rect.maxX, y: rect.midY))
        }
    }
}

/// Un producto, con la forma de la etiqueta de una caja de tóner.
private struct EtiquetaView: View {
    let producto: ProductoCompatible
    let impresora: Impresora
    let elegido: Bool
    /// El que la tienda recomienda (`recomendado`): sello y fondo propios.
    let recomendado: Bool
    let accion: () -> Void

    var body: some View {
        let colores = Tema.colores(de: producto.stock)
        BotonPlano(accion: accion) { pulsado in
            HStack(spacing: 0) {
                colores.texto.frame(width: 10)
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 8) {
                        if recomendado { sello("★ RECOMENDADO", color: Tema.superficie, fondo: Tema.azulHondo) }
                        if producto.esAsta {
                            sello("ASTA", color: Tema.superficie, fondo: Tema.azul)
                        } else {
                            sello(producto.tipo == .original ? "ORIGINAL" : "COMPATIBLE", color: Tema.tinta, borde: Tema.tinta)
                        }
                        if producto.esPolvo { sello("PARA RECARGAR", color: Tema.tintaSuave, fondo: Tema.tecla) }
                    }
                    Text(producto.titulo(para: impresora)).font(Tema.titulo(24)).foregroundStyle(Tema.tinta).lineLimit(1)
                    Text(producto.nombre).font(Tema.codigoCuerpo(16)).foregroundStyle(Tema.tintaTenue).lineLimit(1)
                }
                .padding(.vertical, 16)
                .padding(.horizontal, 24)
                .frame(maxWidth: .infinity, alignment: .leading)
                .opacity(producto.stock == .agotado ? 0.62 : 1)
                VStack(spacing: 4) {
                    Text(producto.stock.texto).font(Tema.titulo(20)).foregroundStyle(colores.texto).multilineTextAlignment(.center)
                    if elegido { Text("✓ Elegido").font(Tema.fuerte(16)).foregroundStyle(Tema.azulHondo) }
                }
                .frame(width: 220)
                .frame(maxHeight: .infinity)
                .background(colores.fondo)
            }
            .frame(minHeight: 112)
            .background((pulsado && !elegido) || recomendado ? Tema.azulSuave : Tema.superficie)
            .clipShape(RoundedRectangle(cornerRadius: Tema.radio))
            .overlay(RoundedRectangle(cornerRadius: Tema.radio).stroke(elegido ? Tema.azul : .clear, lineWidth: 3))
        }
        .accessibilityLabel("\(producto.titulo(para: impresora)), \(producto.stock.texto)")
        .accessibilityAddTraits(elegido ? .isSelected : [])
    }

    private func sello(_ texto: String, color: Color, fondo: Color = .clear, borde: Color? = nil) -> some View {
        Text(texto).font(Tema.titulo(14)).kerning(1.5).foregroundStyle(color)
            .padding(.horizontal, 8).padding(.vertical, 2)
            .background(RoundedRectangle(cornerRadius: 3).fill(fondo))
            .overlay(RoundedRectangle(cornerRadius: 3).stroke(borde ?? .clear, lineWidth: 2))
    }
}
