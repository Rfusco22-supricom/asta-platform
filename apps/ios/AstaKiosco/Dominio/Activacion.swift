import Foundation
import Observation
import Security

/// Vincular la tablet con el código del panel. La misma lógica que
/// `dominio/Activacion.kt` en Android.
///
/// ── Por qué ──────────────────────────────────────────────────────────────────
///
/// Desde la tienda de apps se instala la MISMA app en todas las tablets, así que
/// el token no puede ir compilado dentro: lo tendría cualquiera que la
/// descargara. La primera vez que se abre, la app pide un código de 6 dígitos
/// que se saca en el panel (Tablets → «Añadir tablet»): lo saca un cliente para
/// su tienda o un administrador para una de Supricom. Se escribe o se escanea su
/// QR, y la tablet recibe su propio token (`POST /api/v1/kiosk/vincular`), que
/// guarda en el llavero. El código caduca en minutos y sirve una sola vez.
///
/// El de los revisores de Apple y Google es igual, con 12 dígitos.
///
/// Si la tablet se desactiva en el panel, el siguiente latido recibe un 401: la
/// app olvida el token y vuelve a pedir un código.
///
/// Una compilación con `ASTA_API_KEY` en su xcconfig (desarrollo, o una tablet
/// preparada a mano) se salta todo esto: manda lo compilado.

/// Dónde se guarda el token. Un protocolo para que los tests no toquen el llavero.
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
    /// No tiene forma de código (6 o 12 dígitos): ni se pregunta al servidor.
    case formatoInvalido
    /// El servidor no lo acepta: mal escrito, caducado o ya usado.
    case rechazado
    /// Demasiados códigos equivocados desde esta red: hay que esperar.
    case demasiadosIntentos
    case sinConexion
}

/// Lo que se escribió, o lo que trae el QR del panel (`asta-tablet:482913`),
/// solo con los dígitos. `nil` si no es un código: 6 dígitos, o 12 el de los
/// revisores. Un QR cualquiera que pase por la cámara no vale.
func normalizarCodigo(_ texto: String) -> String? {
    var t = texto.trimmingCharacters(in: .whitespacesAndNewlines)
    if t.lowercased().hasPrefix("asta-tablet:") { t = String(t.dropFirst("asta-tablet:".count)) }
    else if t.contains(":") { return nil }
    let digitos = t.filter { !$0.isWhitespace && $0 != "-" }
    guard digitos.count == 6 || digitos.count == 12, digitos.allSatisfy({ $0.isASCII && $0.isNumber }) else { return nil }
    return digitos
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
    private let modelo: String

    init(base: ConfigApi, almacen: any AlmacenCodigo, modelo: String = "iPad", transporte: any Transporte = TransporteURLSession()) {
        self.base = base
        self.almacen = almacen
        self.modelo = modelo
        self.transporte = transporte
        if !base.apiKey.isEmpty {
            estado = .activa(base)
        } else if let guardado = almacen.leer(), guardado.hasPrefix("asta_kio_") {
            estado = .activa(base.con(apiKey: guardado))
        } else {
            estado = .pendiente
        }
    }

    private struct Vinculada: Decodable { struct D: Decodable { let token: String }; let data: D }

    /// Manda el código al servidor y, si lo acepta, guarda el token que devuelve.
    func activar(_ texto: String) async -> ResultadoActivacion {
        guard let codigo = normalizarCodigo(texto), let url = URL(string: base.base + "/api/v1/kiosk/vincular") else { return .formatoInvalido }
        var p = URLRequest(url: url, timeoutInterval: 15)
        p.httpMethod = "POST"
        p.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if !base.version.isEmpty { p.setValue(base.version, forHTTPHeaderField: "X-App-Version") }
        var cuerpo = ["codigo": codigo, "plataforma": "ios", "modelo": String(modelo.prefix(100))]
        if !base.version.isEmpty { cuerpo["version"] = String(base.version.prefix(20)) }
        p.httpBody = try? JSONEncoder().encode(cuerpo)

        guard let (datos, r) = try? await transporte.enviar(p) else { return .sinConexion }
        switch r.statusCode {
        case 201:
            guard let token = (try? JSONDecoder().decode(Vinculada.self, from: datos))?.data.token else { return .sinConexion }
            almacen.guardar(token)
            estado = .activa(base.con(apiKey: token))
            return .activada
        case 400, 404: return .rechazado
        case 429: return .demasiadosIntentos
        default: return .sinConexion
        }
    }

    /// El servidor ya no acepta el token guardado (tablet desactivada o token
    /// renovado): se olvida y se vuelve a pedir un código. Lo compilado no se olvida.
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
