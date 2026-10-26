package com.supricom.asta.kiosco.dominio

import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * Vincular la tablet con el código del panel. La misma lógica que
 * `Dominio/Activacion.swift` en iOS.
 *
 * Desde la tienda de apps se instala la MISMA app en todas las tablets, así que
 * el token no puede ir compilado dentro: lo tendría cualquiera que la
 * descargara. La primera vez que se abre, la app pide un código de 6 dígitos
 * que se saca en el panel (Tablets → «Añadir tablet»): lo saca un cliente para
 * su tienda o un administrador para una de Supricom. Se escribe o se escanea su
 * QR, y la tablet recibe su propio token (`POST /api/v1/kiosk/vincular`), que
 * guarda cifrado. El código caduca en minutos y sirve una sola vez.
 *
 * El de los revisores de Apple y Google es igual, con 12 dígitos.
 *
 * Si la tablet se desactiva en el panel, el siguiente latido recibe un 401: la
 * app olvida el token y vuelve a pedir un código.
 *
 * Una compilación con `asta.apiKey` en `local.properties` (desarrollo, o una
 * tablet preparada a mano) se salta todo esto: manda lo compilado.
 */

/** Dónde se guarda el token. Una interfaz para que los tests no toquen el Keystore. */
interface AlmacenCodigo {
    fun leer(): String?
    fun guardar(codigo: String): Boolean
    fun borrar()
}

/**
 * El token cifrado con una clave AES del Android Keystore, que no sale del
 * dispositivo, y guardado en las preferencias privadas de la app. Sin
 * dependencias nuevas.
 */
class AlmacenCodigoSeguro(private val preferencias: SharedPreferences) : AlmacenCodigo {
    private val alias = "asta-codigo-tablet"
    private val claveDato = "codigo"

    private fun clave(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(alias, null) as? SecretKey)?.let { return it }
        val generador = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generador.init(
            KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build(),
        )
        return generador.generateKey()
    }

    override fun leer(): String? = runCatching {
        val guardado = preferencias.getString(claveDato, null) ?: return null
        val (iv, cifrado) = guardado.split(":").map { Base64.decode(it, Base64.NO_WRAP) }
        val c = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, clave(), GCMParameterSpec(128, iv)) }
        String(c.doFinal(cifrado), Charsets.UTF_8)
    }.getOrNull()

    override fun guardar(codigo: String): Boolean = runCatching {
        val c = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, clave()) }
        val cifrado = c.doFinal(codigo.toByteArray(Charsets.UTF_8))
        val valor = Base64.encodeToString(c.iv, Base64.NO_WRAP) + ":" + Base64.encodeToString(cifrado, Base64.NO_WRAP)
        preferencias.edit().putString(claveDato, valor).commit()
    }.getOrDefault(false)

    override fun borrar() {
        preferencias.edit().remove(claveDato).apply()
    }
}

enum class ResultadoActivacion {
    ACTIVADA,
    /** No tiene forma de código (6 o 12 dígitos): ni se pregunta al servidor. */
    FORMATO_INVALIDO,
    /** El servidor no lo acepta: mal escrito, caducado o ya usado. */
    RECHAZADO,
    /** Demasiados códigos equivocados desde esta red: hay que esperar. */
    DEMASIADOS_INTENTOS,
    SIN_CONEXION,
}

/**
 * Lo que se escribió, o lo que trae el QR del panel (`asta-tablet:482913`), solo
 * con los dígitos. `null` si no es un código: 6 dígitos, o 12 el de los
 * revisores. Un QR cualquiera que pase por la cámara no vale.
 */
fun normalizarCodigo(texto: String): String? {
    var t = texto.trim()
    if (t.lowercase().startsWith("asta-tablet:")) t = t.substring("asta-tablet:".length)
    else if (':' in t) return null
    val digitos = t.filter { !it.isWhitespace() && it != '-' }
    if (digitos.length != 6 && digitos.length != 12) return null
    if (!digitos.all { it in '0'..'9' }) return null
    return digitos
}

sealed interface EstadoActivacion {
    data object Pendiente : EstadoActivacion
    data class Activa(val apiKey: String) : EstadoActivacion
}

/**
 * @param claveCompilada la de `local.properties`; si la hay, manda.
 * @param modelo para reconocer la tablet en la lista del panel.
 */
class Activacion(
    private val claveCompilada: String,
    private val almacen: AlmacenCodigo,
    private val base: String,
    private val version: String = "",
    private val modelo: String = "Android",
    private val transporte: Transporte = TransporteHttp,
) {
    private val json = Json { ignoreUnknownKeys = true }

    @Serializable private data class Vinculada(val token: String)
    @Serializable private data class RespuestaVinculada(val data: Vinculada)

    var estado: EstadoActivacion by mutableStateOf(
        when {
            claveCompilada.isNotEmpty() -> EstadoActivacion.Activa(claveCompilada)
            else -> almacen.leer()?.takeIf { it.startsWith("asta_kio_") }?.let { EstadoActivacion.Activa(it) } ?: EstadoActivacion.Pendiente
        },
    )
        private set

    /** Manda el código al servidor y, si lo acepta, guarda el token que devuelve. */
    suspend fun activar(texto: String): ResultadoActivacion {
        val codigo = normalizarCodigo(texto) ?: return ResultadoActivacion.FORMATO_INVALIDO
        val cuerpo = buildJsonObject {
            put("codigo", codigo)
            put("plataforma", "android")
            put("modelo", modelo.take(100))
            if (version.isNotEmpty()) put("version", version.take(20))
        }.toString()
        val cabeceras = buildMap {
            put("Content-Type", "application/json")
            if (version.isNotEmpty()) put("X-App-Version", version)
        }
        val r = runCatching { transporte.enviar(Peticion("$base/api/v1/kiosk/vincular", "POST", cabeceras, cuerpo)) }.getOrNull()
            ?: return ResultadoActivacion.SIN_CONEXION
        return when (r.estado) {
            201 -> {
                val token = runCatching { json.decodeFromString(RespuestaVinculada.serializer(), r.cuerpo).data.token }.getOrNull()
                    ?: return ResultadoActivacion.SIN_CONEXION
                almacen.guardar(token)
                estado = EstadoActivacion.Activa(token)
                ResultadoActivacion.ACTIVADA
            }
            400, 404 -> ResultadoActivacion.RECHAZADO
            429 -> ResultadoActivacion.DEMASIADOS_INTENTOS
            else -> ResultadoActivacion.SIN_CONEXION
        }
    }

    /**
     * El servidor ya no acepta el token guardado (tablet desactivada o token
     * renovado): se olvida y se vuelve a pedir un código. Lo compilado no se olvida.
     */
    fun rechazado() {
        if (claveCompilada.isNotEmpty()) return
        almacen.borrar()
        estado = EstadoActivacion.Pendiente
    }
}
