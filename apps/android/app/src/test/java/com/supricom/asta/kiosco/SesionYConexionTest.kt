package com.supricom.asta.kiosco

import com.supricom.asta.kiosco.dominio.EstadoConexion
import com.supricom.asta.kiosco.dominio.Informe
import com.supricom.asta.kiosco.dominio.Sesion
import com.supricom.asta.kiosco.dominio.Vigilante
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * #41 · La sesión se cierra sola, avisando antes, y un toque la reinicia.
 * #42 · El estado de la conexión, y la recarga al volver la red.
 *
 * Con tiempo virtual: los cuatro minutos pasan sin esperarlos.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SesionYConexionTest {
    @Test fun avisaALosTresYMedioYCierraALosCuatro() = runTest {
        val avisos = mutableListOf<Boolean>()
        val cierres = mutableListOf<Sesion.Motivo>()
        Sesion(backgroundScope, alAvisar = { avisos += it }, alCerrar = { cierres += it })
        advanceTimeBy(3 * 60_000L + 29_999)
        assertEquals(emptyList<Boolean>(), avisos)
        advanceTimeBy(2)
        assertEquals(listOf(true), avisos)
        advanceTimeBy(30_000)
        assertEquals(listOf(true, false), avisos)
        assertEquals(listOf(Sesion.Motivo.TIMEOUT), cierres)
    }

    @Test fun unToqueQuitaElAvisoYReiniciaLosRelojes() = runTest {
        val avisos = mutableListOf<Boolean>()
        val cierres = mutableListOf<Sesion.Motivo>()
        val s = Sesion(backgroundScope, alAvisar = { avisos += it }, alCerrar = { cierres += it })
        advanceTimeBy(3 * 60_000L + 40_000)
        s.tocar()
        assertEquals(listOf(true, false), avisos)
        advanceTimeBy(3 * 60_000L)
        assertEquals(emptyList<Sesion.Motivo>(), cierres)
        advanceTimeBy(60_001)
        assertEquals(listOf(Sesion.Motivo.TIMEOUT), cierres)
    }

    @Test fun terminarCierraUnaVezYNoQuedaNadaArmado() = runTest {
        val cierres = mutableListOf<Sesion.Motivo>()
        val s = Sesion(backgroundScope, alAvisar = {}, alCerrar = { cierres += it })
        s.terminar()
        s.terminar()
        advanceTimeBy(10 * 60_000L)
        assertEquals(listOf(Sesion.Motivo.LOGOUT), cierres)
    }

    @Test fun distingueSinRedDeSinErpYSoloSondeaMientrasEstaCaida() = runTest {
        var llamadas = 0
        var responde = false
        val v = Vigilante(backgroundScope) { llamadas++; responde }
        advanceTimeBy(60_000)
        assertEquals(0, llamadas)

        v.reportar(Informe.SIN_ERP)
        assertEquals(EstadoConexion.SIN_DATOS_VIVOS, v.estado.value)
        v.reportar(Informe.SIN_RED)
        assertEquals(EstadoConexion.SIN_CONEXION, v.estado.value)
        advanceTimeBy(Vigilante.REINTENTO_MS * 2 + 1)
        assertEquals(2, llamadas)

        responde = true
        advanceTimeBy(Vigilante.REINTENTO_MS)
        runCurrent()
        assertEquals(EstadoConexion.CONECTADO, v.estado.value)
        // Al volver, una sola recarga, y se deja de sondear.
        assertEquals(1, v.recargas.value)
        advanceTimeBy(Vigilante.REINTENTO_MS * 4)
        assertEquals(3, llamadas)
    }
}
