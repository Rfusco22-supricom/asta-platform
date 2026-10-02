package com.supricom.asta.kiosco

import com.supricom.asta.kiosco.dominio.Cartucho
import com.supricom.asta.kiosco.dominio.EstadoStock
import com.supricom.asta.kiosco.dominio.Impresora
import com.supricom.asta.kiosco.dominio.ProductoCompatible
import com.supricom.asta.kiosco.dominio.codigosDeCartucho
import com.supricom.asta.kiosco.dominio.esAsta
import com.supricom.asta.kiosco.dominio.esPolvo
import com.supricom.asta.kiosco.dominio.ordenarPorStock
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

    @Test fun juntaLosCodigosSinRepetir() {
        assertEquals(listOf("CE278A", "CE285A"), codigosDeCartucho(listOf(producto(1, "a"), producto(2, "b"), producto(3, "c", codigo = "CE285A"))))
    }

    @Test fun poneLoQueHayPrimeroSinDesordenarElResto() {
        val lista = listOf(
            producto(1, "a", EstadoStock.AGOTADO), producto(2, "b"), producto(3, "c", EstadoStock.BAJO),
            producto(4, "d", EstadoStock.AGOTADO), producto(5, "e"),
        )
        assertEquals(listOf(2, 5, 3, 1, 4), ordenarPorStock(lista).map { it.id })
    }
}
