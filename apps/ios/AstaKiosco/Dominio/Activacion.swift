import Foundation
import Observation
import Security

/// Activación de la tablet con un código (el token `asta_kio_…` de la tablet).
/// La misma lógica que `dominio/Activacion.kt` en Android.
///
/// ── Por qué ──────────────────────────────────────────────────────────────────
///
/// Desde la tienda de apps se instala la MISMA app en todas las tablets, así que
/// el token no puede ir compilado dentro: lo tendría cualquiera que la
/// descargara. La primera vez que se abre, la app pide el código que da el
/// panel (Aplicación ASTA → Tablets → «Registrar una tablet»), escaneando su QR o
/// escribiéndolo; lo comprueba contra el middleware y lo guarda en el llavero.
///
/// Si la tablet se desactiva en el panel, el siguiente latido recibe un 401: la
/// app olvida el código y vuelve a pedirlo.
///
/// Una compilación con `ASTA_API_KEY` en su xcconfig (desarrollo, o una tablet
/// preparada a mano) se salta todo esto: manda lo compilado.

/// Dónde se guarda el código. Un protocolo para que los tests no toquen el llavero.
protocol AlmacenCodigo: Sendable {
    func leer() -> String?
    @discardableResult func guardar(_ codigo: String) -> Bool
    func borrar()
}

/// El llavero del iPad: cifrado, solo en ESTE dispositivo (no viaja en copias de
/// iCloud a otra tablet) y legible tras el primer desbloqueo, para que la app
/// arranque sola si la tablet se reinicia de noche.
struct LlaveroCodigo: AlmacenCodigo {
    /// Una propiedad calculada y no guardada: un `[String: Any]` no es Sendable.
    private var consulta: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "com.supricom.asta.kiosco",
            kSecAttrAccount as String: "codigo-tablet",
        ]
    }

    func leer() -> String? {
        var q = consulta
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var resultado: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &resultado) == errSecSuccess,
              let datos = resultado as? Data else { return nil }
        return String(data: datos, encoding: .utf8)
    }

    @discardableResult
    func guardar(_ codigo: String) -> Bool {
        borrar()
        var q = consulta
        q[kSecValueData as String] = Data(codigo.utf8)
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        return SecItemAdd(q as CFDictionary, nil) == errSecSuccess
    }

    func borrar() {
        SecItemDelete(consulta as CFDictionary)
    }
}

enum ResultadoActivacion: Equatable, Sendable {
    case activada
    /// No tiene forma de código de tablet: ni se pregunta al servidor.
    case formatoInvalido
    /// El servidor no lo reconoce: mal copiado, ya renovado o tablet desactivada.
    case rechazado
    case sinConexion
}

/// Lo que se escribió o leyó del QR, limpio: sin espacios ni saltos de línea de
/// más. `nil` si no tiene forma de código de tablet.
func normalizarCodigo(_ texto: String) -> String? {
    let limpio = texto.trimmingCharacters(in: .whitespacesAndNewlines)
    guard limpio.hasPrefix("asta_kio_"), limpio.count > "asta_kio_".count + 10,
          limpio.allSatisfy({ $0.isLetter || $0.isNumber || $0 == "_" || $0 == "-" }) else { return nil }
    return limpio
}

@MainActor @Observable
final class Activacion {
    enum Estado: Equatable {
        case pendiente
        case activa(ConfigApi)
    }

    private(set) var estado: Estado
    private let base: ConfigApi
    private let almacen: any AlmacenCodigo
    private let transporte: any Transporte

    init(base: ConfigApi, almacen: any AlmacenCodigo, transporte: any Transporte = TransporteURLSession()) {
        self.base = base
        self.almacen = almacen
        self.transporte = transporte
        if !base.apiKey.isEmpty {
            estado = .activa(base)
        } else if let guardado = almacen.leer(), normalizarCodigo(guardado) != nil {
            estado = .activa(base.con(apiKey: guardado))
        } else {
            estado = .pendiente
        }
    }

    /// Comprueba el código con un latido y, si el servidor lo acepta, lo guarda.
    func activar(_ texto: String) async -> ResultadoActivacion {
        guard let codigo = normalizarCodigo(texto) else { return .formatoInvalido }
        let config = base.con(apiKey: codigo)
        switch await ClienteApi(config: config, transporte: transporte).comprobar() {
        case .valido:
            almacen.guardar(codigo)
            estado = .activa(config)
            return .activada
        case .rechazado:
            return .rechazado
        case .sinRespuesta:
            return .sinConexion
        }
    }

    /// El servidor ya no acepta el código guardado (tablet desactivada o token
    /// renovado): se olvida y se vuelve a pedir. Lo compilado no se olvida.
    func rechazado() {
        guard base.apiKey.isEmpty else { return }
        almacen.borrar()
        estado = .pendiente
    }
}

extension ConfigApi {
    func con(apiKey: String) -> ConfigApi {
        ConfigApi(base: base, apiKey: apiKey, version: version)
    }
}

extension ConfigApi: Equatable {
    static func == (a: ConfigApi, b: ConfigApi) -> Bool {
        a.base == b.base && a.apiKey == b.apiKey && a.version == b.version
    }
}
