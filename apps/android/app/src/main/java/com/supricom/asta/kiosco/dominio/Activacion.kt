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

/**
 * Activación de la tablet con un código (el token `asta_kio_…` de la tablet).
 * La misma lógica que `Dominio/Activacion.swift` en iOS.
 *
 * Desde la tienda de apps se instala la MISMA app en todas las tablets, así que
 * el token no puede ir compilado dentro: lo tendría cualquiera que la
 * descargara. La primera vez que se abre, la app pide el código que da el panel
 * (Aplicación ASTA → Tablets → «Registrar una tablet»), escaneando su QR o
 * escribiéndolo; lo comprueba contra el middleware y lo guarda cifrado.
 *
 * Si la tablet se desactiva en el panel, el siguiente latido recibe un 401: la
 * app olvida el código y vuelve a pedirlo.
 *
 * Una compilación con `asta.apiKey` en `local.properties` (desarrollo, o una
 * tablet preparada a mano) se salta todo esto: manda lo compilado.
 */

/** Dónde se guarda el código. Una interfaz para que los tests no toquen el Keystore. */
interface AlmacenCodigo {
    fun leer(): String?
    fun guardar(codigo: String): Boolean
    fun borrar()
}

/**
 * El código cifrado con una clave AES del Android Keystore, que no sale del
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
    /** No tiene forma de código de tablet: ni se pregunta al servidor. */
    FORMATO_INVALIDO,
    /** El servidor no lo reconoce: mal copiado, ya renovado o tablet desactivada. */
    RECHAZADO,
    SIN_CONEXION,
}

/** Lo que se escribió o leyó del QR, limpio. `null` si no tiene forma de código de tablet. */
fun normalizarCodigo(texto: String): String? {
    val limpio = texto.trim()
    val prefijo = "asta_kio_"
    if (!limpio.startsWith(prefijo) || limpio.length <= prefijo.length + 10) return null
    if (!limpio.all { it.isLetterOrDigit() || it == '_' || it == '-' }) return null
    return limpio
}

sealed interface EstadoActivacion {
    data object Pendiente : EstadoActivacion
    data class Activa(val apiKey: String) : EstadoActivacion
}

/**
 * @param claveCompilada la de `local.properties`; si la hay, manda.
 * @param crearApi el cliente para un código: así los tests le dan un transporte falso.
 */
class Activacion(
    private val claveCompilada: String,
    private val almacen: AlmacenCodigo,
    private val crearApi: (String) -> ClienteApi,
) {
    var estado: EstadoActivacion by mutableStateOf(
        when {
            claveCompilada.isNotEmpty() -> EstadoActivacion.Activa(claveCompilada)
            else -> almacen.leer()?.takeIf { normalizarCodigo(it) != null }?.let { EstadoActivacion.Activa(it) } ?: EstadoActivacion.Pendiente
        },
    )
        private set

    /** Comprueba el código con un latido y, si el servidor lo acepta, lo guarda. */
    suspend fun activar(texto: String): ResultadoActivacion {
        val codigo = normalizarCodigo(texto) ?: return ResultadoActivacion.FORMATO_INVALIDO
        return when (crearApi(codigo).comprobar()) {
            EstadoToken.VALIDO -> {
                almacen.guardar(codigo)
                estado = EstadoActivacion.Activa(codigo)
                ResultadoActivacion.ACTIVADA
            }
            EstadoToken.RECHAZADO -> ResultadoActivacion.RECHAZADO
            EstadoToken.SIN_RESPUESTA -> ResultadoActivacion.SIN_CONEXION
        }
    }

    /**
     * El servidor ya no acepta el código guardado (tablet desactivada o token
     * renovado): se olvida y se vuelve a pedir. Lo compilado no se olvida.
     */
    fun rechazado() {
        if (claveCompilada.isNotEmpty()) return
        almacen.borrar()
        estado = EstadoActivacion.Pendiente
    }
}
