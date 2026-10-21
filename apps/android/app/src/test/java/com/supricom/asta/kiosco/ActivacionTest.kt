package com.supricom.asta.kiosco

import com.supricom.asta.kiosco.dominio.Activacion
import com.supricom.asta.kiosco.dominio.AlmacenCodigo
import com.supricom.asta.kiosco.dominio.ClienteApi
import com.supricom.asta.kiosco.dominio.EstadoActivacion
import com.supricom.asta.kiosco.dominio.EstadoToken
import com.supricom.asta.kiosco.dominio.Peticion
import com.supricom.asta.kiosco.dominio.Respuesta
import com.supricom.asta.kiosco.dominio.ResultadoActivacion
import com.supricom.asta.kiosco.dominio.Transporte
import java.io.IOException
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Activación de la tablet con su código. Los mismos casos que
 * `ActivacionTests.swift` en iOS.
 */
class ActivacionTest {
    private val codigo = "asta_kio_" + "A".repeat(43)

    class AlmacenMemoria(var codigo: String? = null) : AlmacenCodigo {
        override fun leer() = codigo
        override fun guardar(codigo: String): Boolean { this.codigo = codigo; return true }
        override fun borrar() { codigo = null }
    }

    private fun con(t: Transporte, almacen: AlmacenCodigo = AlmacenMemoria(), compilada: String = "") =
        Activacion(compilada, almacen) { clave -> ClienteApi("http://kiosco.test", clave, t) }

    private val ok = Transporte { Respuesta(200, """{"data":{"ok":true}}""") }

    @Test fun sinCodigoPideActivar() {
        assertEquals(EstadoActivacion.Pendiente, con(ok).estado)
    }

    @Test fun conCodigoGuardadoArrancaActivada() {
        assertEquals(EstadoActivacion.Activa(codigo), con(ok, AlmacenMemoria(codigo)).estado)
    }

    /** Lo compilado manda: desarrollo y tablets preparadas a mano siguen igual. */
    @Test fun laClaveCompiladaNoPideNada() {
        val a = con(ok, compilada = "asta_live_abc")
        assertEquals(EstadoActivacion.Activa("asta_live_abc"), a.estado)
        a.rechazado()
        assertEquals(EstadoActivacion.Activa("asta_live_abc"), a.estado)
    }

    @Test fun unCodigoAceptadoSeGuardaYActiva() = runTest {
        var vista: Peticion? = null
        val almacen = AlmacenMemoria()
        val a = con({ vista = it; Respuesta(200, "{}") }, almacen)
        // Con los espacios y el salto de línea de un copia y pega.
        assertEquals(ResultadoActivacion.ACTIVADA, a.activar("  $codigo\n"))
        assertEquals(codigo, almacen.codigo)
        assertEquals(EstadoActivacion.Activa(codigo), a.estado)
        assertEquals("http://kiosco.test/api/v1/kiosk/latido", vista!!.url)
        assertEquals(codigo, vista!!.cabeceras["X-API-Key"])
    }

    @Test fun unCodigoRechazadoNoSeGuarda() = runTest {
        val almacen = AlmacenMemoria()
        val a = con({ Respuesta(401, "") }, almacen)
        assertEquals(ResultadoActivacion.RECHAZADO, a.activar(codigo))
        assertNull(almacen.codigo)
        assertEquals(EstadoActivacion.Pendiente, a.estado)
    }

    @Test fun sinRedNoSeDaPorMalo() = runTest {
        val a = con({ throw IOException("sin red") })
        assertEquals(ResultadoActivacion.SIN_CONEXION, a.activar(codigo))
        assertEquals(EstadoActivacion.Pendiente, a.estado)
    }

    @Test fun loQueNoEsUnCodigoNiSePregunta() = runTest {
        var preguntado = false
        val a = con({ preguntado = true; Respuesta(200, "{}") })
        assertEquals(ResultadoActivacion.FORMATO_INVALIDO, a.activar("https://otra.cosa/qr"))
        assertEquals(ResultadoActivacion.FORMATO_INVALIDO, a.activar("asta_kio_corto"))
        assertFalse(preguntado)
    }

    /** La tablet desactivada en el panel: olvida el código y vuelve a pedirlo. */
    @Test fun alSerRechazadaOlvidaElCodigo() {
        val almacen = AlmacenMemoria(codigo)
        val a = con(ok, almacen)
        a.rechazado()
        assertNull(almacen.codigo)
        assertEquals(EstadoActivacion.Pendiente, a.estado)
    }

    @Test fun elLatidoDistingueRechazoDeFaltaDeRed() = runTest {
        fun api(t: Transporte) = ClienteApi("http://kiosco.test", codigo, t)
        assertEquals(EstadoToken.VALIDO, api { Respuesta(200, "{}") }.comprobar())
        assertEquals(EstadoToken.RECHAZADO, api { Respuesta(401, "") }.comprobar())
        assertEquals(EstadoToken.SIN_RESPUESTA, api { throw IOException("x") }.comprobar())
        assertEquals(EstadoToken.SIN_RESPUESTA, api { Respuesta(500, "") }.comprobar())
    }
}
