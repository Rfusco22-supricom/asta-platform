package com.supricom.asta.kiosco

import com.supricom.asta.kiosco.dominio.Cartucho
import com.supricom.asta.kiosco.dominio.Clase
import com.supricom.asta.kiosco.dominio.clase
import com.supricom.asta.kiosco.dominio.EstadoStock
import com.supricom.asta.kiosco.dominio.Impresora
import com.supricom.asta.kiosco.dominio.ProductoCompatible
import com.supricom.asta.kiosco.dominio.codigosDeCartucho
import com.supricom.asta.kiosco.dominio.esAsta
import com.supricom.asta.kiosco.dominio.esPolvo
import com.supricom.asta.kiosco.dominio.ordenarParaRecomendar
import com.supricom.asta.kiosco.dominio.recomendado
import com.supricom.asta.kiosco.dominio.titulo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #40 · Cómo se presenta cada producto. Nombres reales del ERP, los de la HP
 * P1606: no venderle polvo a quien busca un cartucho, y lo que hay, primero.
 */
class ProductoTest {
    private val impresora = Impresora(1726, "HP", "P1606")

    private fun producto(id: Int, nombre: String, stock: EstadoStock = EstadoStock.DISPONIBLE, tipo: ProductoCompatible.Tipo = ProductoCompatible.Tipo.COMPATIBLE, codigo: String = "CE278A") =
        ProductoCompatible(id, id, null, nombre, stock, tipo, listOf(Cartucho("HP", codigo, "toner")))

    @Test fun reconoceLaMarcaPropia() {
        assertTrue(producto(1, "ASTA TONER CB435A/CB436A/CE278A/285").esAsta)
        assertFalse(producto(2, "HP TONER P1566 / P1606 BLACK ORIGINAL").esAsta)
        assertFalse(producto(3, "ASTARTE TONER").esAsta)
    }

    @Test fun distingueElPolvoDelToner() {
        assertTrue(producto(1, "ASTA POLVO POWDER A CB435A/CB436A/CE278A/285 NEGRO").esPolvo)
        assertFalse(producto(2, "ASTA TONER CB435A/CB436A/CE278A/285").esPolvo)
    }

    @Test fun daUnTituloQueSeEntiendeDePie() {
        assertEquals("Tóner compatible Asta", producto(1, "ASTA TONER CB435A").titulo(impresora))
        assertEquals("Tóner original HP", producto(2, "HP TONER P1606 BLACK ORIGINAL", tipo = ProductoCompatible.Tipo.ORIGINAL).titulo(impresora))
        assertEquals("Polvo de recarga Asta", producto(3, "ASTA POLVO TONER POWDER").titulo(impresora))
    }

    @Test fun noLlamaTonerAUnaTintaNiAUnTambor() {
        val brother = Impresora(9, "Brother", "HL-L2350DW")
        fun cartucho(codigo: String, tipo: String, marca: String = "Brother") = Cartucho(marca, codigo, tipo)
        fun con(id: Int, nombre: String, cartuchos: List<Cartucho>, tipo: ProductoCompatible.Tipo = ProductoCompatible.Tipo.COMPATIBLE) =
            ProductoCompatible(id, id, null, nombre, EstadoStock.DISPONIBLE, tipo, cartuchos)

        val tambor = con(1, "BROTHER DRUM DR2370 ORIGINAL", listOf(cartucho("DR-2370", "tambor")), ProductoCompatible.Tipo.ORIGINAL)
        assertEquals(Clase.TAMBOR, tambor.clase)
        assertEquals("Tambor original Brother", tambor.titulo(brother))
        assertEquals("Tinta original Epson", con(2, "EPSON TINTA T544 NEGRO", listOf(cartucho("T544", "tinta", "Epson")), ProductoCompatible.Tipo.ORIGINAL).titulo(brother))

        // Tóner y tambor en el mismo producto, o un tipo que no conocemos: no se afirma ninguno.
        assertEquals("Consumible compatible Asta", con(3, "ASTA KIT TN2370 + DR2370", listOf(cartucho("TN-2370", "toner"), cartucho("DR-2370", "tambor"))).titulo(brother))
        assertEquals(Clase.OTRO, con(4, "X", listOf(cartucho("X1", "otro"))).clase)
        assertEquals(Clase.OTRO, con(5, "X", emptyList()).clase)

        // El polvo manda sobre el tipo del cartucho: en el catálogo es «tóner».
        assertEquals(Clase.POLVO, con(6, "ASTA POLVO TN2370", listOf(cartucho("TN-2370", "toner"))).clase)
    }

    @Test fun juntaLosCodigosSinRepetir() {
        assertEquals(listOf("CE278A", "CE285A"), codigosDeCartucho(listOf(producto(1, "a"), producto(2, "b"), producto(3, "c", codigo = "CE285A"))))
    }

    @Test fun poneLoQueHayPrimeroSinDesordenarElResto() {
        val lista = listOf(
            producto(1, "a", EstadoStock.AGOTADO), producto(2, "b"), producto(3, "c", EstadoStock.BAJO),
            producto(4, "d", EstadoStock.AGOTADO), producto(5, "e"),
        )
        assertEquals(listOf(2, 5, 3, 1, 4), ordenarParaRecomendar(lista).map { it.id })
    }

    /** Lo que pide la dirección: Asta y lo que hay en tienda, primero. Nombres del ERP. */
    @Test fun recomiendaAstaEnTiendaPeroNoPorDelanteDeLoQueSiHay() {
        val original = producto(1, "HP TONER P1566 / P1606 BLACK ORIGINAL", tipo = ProductoCompatible.Tipo.ORIGINAL)
        val astaAgotado = producto(2, "ASTA TONER CB435A/CB436A/CE278A/CB285A", EstadoStock.AGOTADO)
        val polvoAsta = producto(3, "ASTA POLVO POWDER A CB435A/CB436A/CE278A/285 NEGRO")
        val asta = producto(4, "ASTA TONER CB435A/CB436A/CE278A/285", EstadoStock.BAJO)
        val otroCompatible = producto(5, "TONER GENERICO CE278A")

        val ordenados = ordenarParaRecomendar(listOf(original, astaAgotado, polvoAsta, asta, otroCompatible))
        // Asta en tienda, aunque sea «últimas unidades», antes que otra marca disponible;
        // el polvo detrás de los cartuchos; lo agotado al final, aunque sea Asta.
        assertEquals(listOf(4, 1, 5, 3, 2), ordenados.map { it.id })
        assertEquals(4, recomendado(ordenados)?.id)
    }

    @Test fun sinUnCartuchoAstaEnTiendaNoSeRecomiendaNada() {
        val original = producto(1, "HP TONER P1606 BLACK ORIGINAL", tipo = ProductoCompatible.Tipo.ORIGINAL)
        val astaAgotado = producto(2, "ASTA TONER CB435A", EstadoStock.AGOTADO)
        val polvoAsta = producto(3, "ASTA POLVO TONER POWDER")
        assertEquals(null, recomendado(ordenarParaRecomendar(listOf(original, astaAgotado, polvoAsta))))
        assertEquals(null, recomendado(emptyList()))
    }
}
