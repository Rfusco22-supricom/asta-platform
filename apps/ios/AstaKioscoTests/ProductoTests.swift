import Testing
@testable import AstaKiosco

/// #40 · Cómo se presenta cada producto. Nombres reales del ERP, los de la HP
/// P1606: no venderle polvo a quien busca un cartucho, y lo que hay, primero.
@Suite struct ProductoTests {
    private let impresora = Impresora(id: 1726, marca: "HP", nombre: "P1606")

    private func producto(_ id: Int, _ nombre: String, stock: EstadoStock = .disponible, tipo: ProductoCompatible.Tipo = .compatible,
                          codigo: String = "CE278A") -> ProductoCompatible {
        ProductoCompatible(id: id, templateId: id, sku: nil, nombre: nombre, stock: stock, tipo: tipo,
                           cartuchos: [Cartucho(marca: "HP", codigo: codigo, tipo: "toner", color: nil, rendimientoPaginas: nil)])
    }

    @Test func reconoceLaMarcaPropia() {
        #expect(producto(1, "ASTA TONER CB435A/CB436A/CE278A/285").esAsta)
        #expect(!producto(2, "HP TONER P1566 / P1606 BLACK ORIGINAL").esAsta)
        #expect(!producto(3, "ASTARTE TONER").esAsta)
    }

    @Test func distingueElPolvoDelToner() {
        #expect(producto(1, "ASTA POLVO POWDER A CB435A/CB436A/CE278A/285 NEGRO").esPolvo)
        #expect(!producto(2, "ASTA TONER CB435A/CB436A/CE278A/285").esPolvo)
    }

    @Test func daUnTituloQueSeEntiendeDePie() {
        #expect(producto(1, "ASTA TONER CB435A").titulo(para: impresora) == "Tóner compatible Asta")
        #expect(producto(2, "HP TONER P1606 BLACK ORIGINAL", tipo: .original).titulo(para: impresora) == "Tóner original HP")
        #expect(producto(3, "ASTA POLVO TONER POWDER").titulo(para: impresora) == "Polvo de recarga Asta")
    }

    @Test func noLlamaTonerAUnaTintaNiAUnTambor() {
        let brother = Impresora(id: 9, marca: "Brother", nombre: "HL-L2350DW")
        func cartucho(_ codigo: String, _ tipo: String, marca: String = "Brother") -> Cartucho {
            Cartucho(marca: marca, codigo: codigo, tipo: tipo, color: nil, rendimientoPaginas: nil)
        }
        func con(_ id: Int, _ nombre: String, _ cartuchos: [Cartucho], tipo: ProductoCompatible.Tipo = .compatible) -> ProductoCompatible {
            ProductoCompatible(id: id, templateId: id, sku: nil, nombre: nombre, stock: .disponible, tipo: tipo, cartuchos: cartuchos)
        }

        let tambor = con(1, "BROTHER DRUM DR2370 ORIGINAL", [cartucho("DR-2370", "tambor")], tipo: .original)
        #expect(tambor.clase == .tambor)
        #expect(tambor.titulo(para: brother) == "Tambor original Brother")
        #expect(con(2, "EPSON TINTA T544 NEGRO", [cartucho("T544", "tinta", marca: "Epson")], tipo: .original).titulo(para: brother) == "Tinta original Epson")

        // Tóner y tambor en el mismo producto, o un tipo que no conocemos: no se afirma ninguno.
        #expect(con(3, "ASTA KIT TN2370 + DR2370", [cartucho("TN-2370", "toner"), cartucho("DR-2370", "tambor")]).titulo(para: brother) == "Consumible compatible Asta")
        #expect(con(4, "X", [cartucho("X1", "otro")]).clase == .otro)
        #expect(con(5, "X", []).clase == .otro)

        // El polvo manda sobre el tipo del cartucho: en el catálogo es «tóner».
        #expect(con(6, "ASTA POLVO TN2370", [cartucho("TN-2370", "toner")]).clase == .polvo)
    }

    @Test func juntaLosCodigosSinRepetir() {
        #expect(codigosDeCartucho([producto(1, "a"), producto(2, "b"), producto(3, "c", codigo: "CE285A")]) == ["CE278A", "CE285A"])
    }

    @Test func poneLoQueHayPrimeroSinDesordenarElResto() {
        let lista = [producto(1, "a", stock: .agotado), producto(2, "b"), producto(3, "c", stock: .bajo), producto(4, "d", stock: .agotado), producto(5, "e")]
        #expect(ordenarParaRecomendar(lista).map(\.id) == [2, 5, 3, 1, 4])
    }

    /// Lo que pide la dirección: Asta y lo que hay en tienda, primero. Los nombres
    /// son los de la HP P1606 y la Canon MF 4100 en el ERP.
    @Test func recomiendaAstaEnTiendaPeroNoPorDelanteDeLoQueSiHay() {
        let original = producto(1, "HP TONER P1566 / P1606 BLACK ORIGINAL", tipo: .original)
        let astaAgotado = producto(2, "ASTA TONER CB435A/CB436A/CE278A/CB285A", stock: .agotado)
        let polvoAsta = producto(3, "ASTA POLVO POWDER A CB435A/CB436A/CE278A/285 NEGRO")
        let asta = producto(4, "ASTA TONER CB435A/CB436A/CE278A/285", stock: .bajo)
        let otroCompatible = producto(5, "TONER GENERICO CE278A")

        let ordenados = ordenarParaRecomendar([original, astaAgotado, polvoAsta, asta, otroCompatible])
        // Asta en tienda, aunque sea «últimas unidades», antes que otra marca disponible;
        // el polvo detrás de los cartuchos; lo agotado al final, aunque sea Asta.
        #expect(ordenados.map(\.id) == [4, 1, 5, 3, 2])
        #expect(recomendado(ordenados)?.id == 4)
    }

    /// El kiosco **solo ofrece Asta**, y distingue «no tenemos Asta» de «no sé qué
    /// le sirve a esa impresora»: son dos cosas distintas para quien está de pie.
    @Test func soloEnsenaAstaYDiceCuandoNoHay() {
        let original = producto(1, "HP TONER P1566 / P1606 BLACK ORIGINAL", tipo: .original)
        let asta = producto(2, "ASTA TONER CB435A/CB436A/CE278A/285", stock: .bajo)
        let otroCompatible = producto(3, "TONER GENERICO CE278A")
        let polvoAsta = producto(4, "ASTA POLVO POWDER A CB435A/CB436A/CE278A/285 NEGRO")
        let astaAgotado = producto(5, "ASTA TONER CB435A", stock: .agotado)

        // El original está disponible y aun así no sale: lo que se ofrece es Asta.
        guard case let .asta(lista) = queEnsenar([original, asta, otroCompatible, polvoAsta, astaAgotado]) else {
            Issue.record("con Asta en la lista tiene que salir .asta")
            return
        }
        #expect(lista.map(\.id) == [2, 4, 5])
        #expect(recomendado(lista)?.id == 2)

        // Sin ningún Asta NO se ofrece el original: eso lo hace el mostrador.
        #expect(queEnsenar([original, otroCompatible]) == .sinAsta)

        // Y no es lo mismo que no tener cargada la compatibilidad (#56).
        #expect(queEnsenar([]) == .sinNada)
    }

    @Test func sinUnCartuchoAstaEnTiendaNoSeRecomiendaNada() {
        let original = producto(1, "HP TONER P1606 BLACK ORIGINAL", tipo: .original)
        let astaAgotado = producto(2, "ASTA TONER CB435A", stock: .agotado)
        let polvoAsta = producto(3, "ASTA POLVO TONER POWDER")
        #expect(recomendado(ordenarParaRecomendar([original, astaAgotado, polvoAsta])) == nil)
        #expect(recomendado([]) == nil)
    }
}
