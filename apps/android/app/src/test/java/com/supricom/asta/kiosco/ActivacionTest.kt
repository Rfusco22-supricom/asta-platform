package com.supricom.asta.kiosco

import com.supricom.asta.kiosco.dominio.Activacion
import com.supricom.asta.kiosco.dominio.AlmacenCodigo
import com.supricom.asta.kiosco.dominio.ClienteApi
import com.supricom.asta.kiosco.dominio.EstadoActivacion
import com.supricom.asta.kiosco.dominio.EstadoToken
import com.supricom.asta.kiosco.dominio.Peticion
import com.supricom.asta.kiosco.dominio.ProductoCompatible
import com.supricom.asta.kiosco.dominio.Respuesta
import com.supricom.asta.kiosco.dominio.ResultadoActivacion
import com.supricom.asta.kiosco.dominio.Transporte
import com.supricom.asta.kiosco.dominio.normalizarCodigo
import com.supricom.asta.kiosco.dominio.ordenarParaRecomendar
import java.io.IOException
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Vincular la tablet con el código del panel. Los mismos casos que
 * `ActivacionTests.swift` en iOS.
 */
class ActivacionTest {
    private val token = "asta_kio_" + "A".repeat(43)
    private val vinculada = """{"data":{"token":"$token","nombre":"Mostrador","conExistencias":false}}"""

    class AlmacenMemoria(var codigo: String? = null) : AlmacenCodigo {
        override fun leer() = codigo
        override fun guardar(codigo: String): Boolean { this.codigo = codigo; return true }
        override fun borrar() { codigo = null }
    }

    private fun con(t: Transporte, almacen: AlmacenCodigo = AlmacenMemoria(), compilada: String = "") =
        Activacion(compilada, almacen, "http://kiosco.test", "1.2.0", "Samsung SM-X200 · Android 14", t)

    private val ok = Transporte { Respuesta(201, vinculada) }

    @Test fun sinTokenPideCodigo() {
        assertEquals(EstadoActivacion.Pendiente, con(ok).estado)
    }

    @Test fun conTokenGuardadoArrancaActivada() {
        assertEquals(EstadoActivacion.Activa(token), con(ok, AlmacenMemoria(token)).estado)
    }

    /** Lo compilado manda: desarrollo y tablets preparadas a mano siguen igual. */
    @Test fun laClaveCompiladaNoPideNada() {
        val a = con(ok, compilada = "asta_live_abc")
        assertEquals(EstadoActivacion.Activa("asta_live_abc"), a.estado)
        a.rechazado()
        assertEquals(EstadoActivacion.Activa("asta_live_abc"), a.estado)
    }

    @Test fun elCodigoSeLeeComoSeEscribe() {
        assertEquals("482913", normalizarCodigo("482913"))
        assertEquals("482913", normalizarCodigo(" 482 913\n"))
        assertEquals("482913", normalizarCodigo("asta-tablet:482913"))
        assertEquals("123456789012", normalizarCodigo("1234 5678 9012"))
        assertNull(normalizarCodigo("48291"))
        assertNull(normalizarCodigo("4829134"))
        assertNull(normalizarCodigo("https://otra.cosa/482913"))
        assertNull(normalizarCodigo("asta_kio_abc"))
    }

    @Test fun unCodigoAceptadoGuardaElTokenYActiva() = runTest {
        var vista: Peticion? = null
        val almacen = AlmacenMemoria()
        val a = con({ vista = it; Respuesta(201, vinculada) }, almacen)
        assertEquals(ResultadoActivacion.ACTIVADA, a.activar("482 913"))
        assertEquals(token, almacen.codigo)
        assertEquals(EstadoActivacion.Activa(token), a.estado)
        val p = vista!!
        assertEquals("http://kiosco.test/api/v1/kiosk/vincular", p.url)
        assertEquals("POST", p.metodo)
        assertNull(p.cabeceras["X-API-Key"])
        val cuerpo = Json.parseToJsonElement(p.cuerpo!!).jsonObject.mapValues { it.value.jsonPrimitive.content }
        assertEquals(mapOf("codigo" to "482913", "plataforma" to "android", "modelo" to "Samsung SM-X200 · Android 14", "version" to "1.2.0"), cuerpo)
    }

    @Test fun unCodigoRechazadoNoGuardaNada() = runTest {
        val almacen = AlmacenMemoria()
        val a = con({ Respuesta(404, "") }, almacen)
        assertEquals(ResultadoActivacion.RECHAZADO, a.activar("482913"))
        assertNull(almacen.codigo)
        assertEquals(EstadoActivacion.Pendiente, a.estado)
    }

    @Test fun demasiadosIntentosYSinRedSeDistinguen() = runTest {
        assertEquals(ResultadoActivacion.DEMASIADOS_INTENTOS, con({ Respuesta(429, "") }).activar("482913"))
        assertEquals(ResultadoActivacion.SIN_CONEXION, con({ throw IOException("sin red") }).activar("482913"))
        assertEquals(ResultadoActivacion.SIN_CONEXION, con({ Respuesta(500, "") }).activar("482913"))
    }

    @Test fun loQueNoEsUnCodigoNiSePregunta() = runTest {
        var preguntado = false
        val a = con({ preguntado = true; Respuesta(201, vinculada) })
        assertEquals(ResultadoActivacion.FORMATO_INVALIDO, a.activar("hola"))
        assertEquals(false, preguntado)
    }

    /** La tablet desactivada en el panel: olvida el token y vuelve a pedir un código. */
    @Test fun alSerRechazadaOlvidaElToken() {
        val almacen = AlmacenMemoria(token)
        val a = con(ok, almacen)
        a.rechazado()
        assertNull(almacen.codigo)
        assertEquals(EstadoActivacion.Pendiente, a.estado)
    }

    @Test fun elLatidoDistingueRechazoDeFaltaDeRed() = runTest {
        fun api(t: Transporte) = ClienteApi("http://kiosco.test", token, t)
        assertEquals(EstadoToken.VALIDO, api { Respuesta(200, "{}") }.comprobar())
        assertEquals(EstadoToken.RECHAZADO, api { Respuesta(401, "") }.comprobar())
        assertEquals(EstadoToken.SIN_RESPUESTA, api { throw IOException("x") }.comprobar())
        assertEquals(EstadoToken.SIN_RESPUESTA, api { Respuesta(500, "") }.comprobar())
    }

    /** Una tablet sin almacén (la de un cliente) recibe los productos sin existencia. */
    @Test fun unProductoSinExistenciaSeLee() {
        val json = Json { ignoreUnknownKeys = true }
        val p = json.decodeFromString(ProductoCompatible.serializer(), """{"id":1,"templateId":2,"sku":"A-1","nombre":"ASTA X","stock":null,"tipo":"compatible","cartuchos":[]}""")
        assertNull(p.stock)
        assertEquals(listOf(p), ordenarParaRecomendar(listOf(p)))
    }
}
