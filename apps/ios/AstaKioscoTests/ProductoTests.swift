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

    @Test func juntaLosCodigosSinRepetir() {
        #expect(codigosDeCartucho([producto(1, "a"), producto(2, "b"), producto(3, "c", codigo: "CE285A")]) == ["CE278A", "CE285A"])
    }

    @Test func poneLoQueHayPrimeroSinDesordenarElResto() {
        let lista = [producto(1, "a", stock: .agotado), producto(2, "b"), producto(3, "c", stock: .bajo), producto(4, "d", stock: .agotado), producto(5, "e")]
        #expect(ordenarPorStock(lista).map(\.id) == [2, 5, 3, 1, 4])
    }
}
