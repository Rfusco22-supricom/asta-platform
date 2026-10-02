package com.supricom.asta.kiosco

import com.supricom.asta.kiosco.dominio.Almacen
import com.supricom.asta.kiosco.dominio.Busqueda
import com.supricom.asta.kiosco.dominio.CacheLocal
import com.supricom.asta.kiosco.dominio.ClienteApi
import com.supricom.asta.kiosco.dominio.ConCache
import com.supricom.asta.kiosco.dominio.Datos
import com.supricom.asta.kiosco.dominio.Impresora
import com.supricom.asta.kiosco.dominio.Informe
import com.supricom.asta.kiosco.dominio.MotivoFallo
import com.supricom.asta.kiosco.dominio.Peticion
import com.supricom.asta.kiosco.dominio.Respuesta
import com.supricom.asta.kiosco.dominio.Resultado
import com.supricom.asta.kiosco.dominio.Transporte
import com.supricom.asta.kiosco.dominio.haceCuanto
import java.io.IOException
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #40, #42 · El cliente de la API y la caché sin conexión. Los mismos casos que
 * `ApiTests.swift` y `CacheTests.swift` en iOS: que una tablet sin
 * conexión o con una key mal puesta no reviente delante del cliente, y que lo
 * guardado rescate sin red o sin ERP, y nada más.
 */
class ApiYCacheTest {
    private val busquedaJson = """{"data":[{"id":1726,"marca":"HP","nombre":"P1606"}],"sugerencias":[],"meta":{"busquedaId":"1411"}}"""
    private val odooCaido = """{"error":{"code":"ODOO_UNAVAILABLE","message":"x"}}"""

    private fun responde(estado: Int, cuerpo: String = "") = Transporte { Respuesta(estado, cuerpo) }
    private val sinRed = Transporte { throw IOException("sin red") }
    private fun api(t: Transporte) = ClienteApi("http://kiosco.test", "clave", t)

    class AlmacenMemoria : Almacen {
        val datos = mutableMapOf<String, String>()
        override fun leer(clave: String) = datos[clave]
        override fun guardar(clave: String, valor: String) { datos[clave] = valor }
        override fun borrar(clave: String) { datos.remove(clave) }
        override fun claves() = datos.keys.toSet()
    }

    @Test fun buscaYMandaLaKey() = runTest {
        var vista: Peticion? = null
        val r = api { vista = it; Respuesta(200, busquedaJson) }.buscarImpresoras("HL 2350")
        assertEquals(Resultado.Ok(Busqueda(listOf(Impresora(1726, "HP", "P1606")), emptyList(), "1411")), r)
        assertEquals("clave", vista!!.cabeceras["X-API-Key"])
        assertEquals("http://kiosco.test/api/v1/public/recommender/printers?q=HL%202350&limit=12", vista!!.url)
    }

    @Test fun cadaFalloSeDistingue() = runTest {
        assertEquals(Resultado.Fallo(MotivoFallo.RED), api(sinRed).buscarImpresoras("x"))
        assertEquals(Resultado.Fallo(MotivoFallo.PERMISO), api(responde(401)).buscarImpresoras("x"))
        assertEquals(Resultado.Fallo(MotivoFallo.PERMISO), api(responde(403)).buscarImpresoras("x"))
        assertEquals(Resultado.Fallo(MotivoFallo.ERP), api(responde(503, odooCaido)).buscarImpresoras("x"))
        assertEquals(Resultado.Fallo(MotivoFallo.SERVIDOR), api(responde(503)).buscarImpresoras("x"))
        assertEquals(Resultado.Fallo(MotivoFallo.SERVIDOR), api(responde(500)).buscarImpresoras("x"))
        assertEquals(Resultado.Fallo(MotivoFallo.SERVIDOR), api(responde(200, "<html>")).buscarImpresoras("x"))
    }

    @Test fun laCacheCaducaALasDoceHorasYNoPasaDelTope() {
        var ahora = 1_800_000_000_000L
        val almacen = AlmacenMemoria()
        val cache = CacheLocal(almacen) { ahora }
        val ser = Impresora.serializer()
        cache.guardar("x", ser, Impresora(1, "HP", "P1606"))
        ahora += CacheLocal.VIGENCIA_MS
        assertNotNull(cache.leer("x", ser))
        ahora += 1
        assertNull(cache.leer("x", ser))

        repeat(CacheLocal.MAX_ENTRADAS + 5) { i ->
            ahora += 1
            cache.guardar("c$i", ser, Impresora(i, "HP", "x"))
        }
        assertEquals(CacheLocal.MAX_ENTRADAS, almacen.claves().size)
        assertNull(cache.leer("c0", ser))
    }

    @Test fun laClaveDeBusquedaNoDistingueComoSeEscribio() {
        assertEquals(CacheLocal.claveBusqueda("hl2350"), CacheLocal.claveBusqueda(" HL-2350 "))
    }

    @Test fun rescataSinRedYSinErpPeroNoConUn403() = runTest {
        val cache = CacheLocal(AlmacenMemoria())
        val informes = mutableListOf<Informe>()
        val enVivo = Datos(api(responde(200, busquedaJson)), cache).buscar("P1606") { informes += it }
        assertTrue(enVivo is ConCache.Ok && enVivo.guardadoEn == null)

        val r1 = Datos(api(sinRed), cache).buscar("P1606") { informes += it }
        assertTrue(r1 is ConCache.Ok && r1.guardadoEn != null && r1.datos.impresoras.first().nombre == "P1606")
        val r2 = Datos(api(responde(503, odooCaido)), cache).buscar("P1606") { informes += it }
        assertTrue(r2 is ConCache.Ok && r2.guardadoEn != null)
        // Un 403 dice que la tablet está mal configurada: no se tapa con lo guardado.
        assertEquals(ConCache.Fallo(MotivoFallo.PERMISO), Datos(api(responde(403)), cache).buscar("P1606") { informes += it })

        assertEquals(listOf(Informe.OK, Informe.SIN_RED, Informe.SIN_ERP, Informe.OK), informes)
    }

    @Test fun haceCuantoDiceLaHoraConcreta() {
        val ahora = 1_800_000_000_000L
        assertEquals("hace menos de un minuto", haceCuanto(ahora - 20_000, ahora))
        assertEquals("hace 6 min", haceCuanto(ahora - 6 * 60_000, ahora))
        assertEquals("hace 1 hora", haceCuanto(ahora - 70 * 60_000, ahora))
        assertEquals("hace 5 horas", haceCuanto(ahora - 5 * 3_600_000, ahora))
    }
}
