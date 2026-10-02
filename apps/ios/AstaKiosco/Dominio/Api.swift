import Foundation

/// Cliente de la API pública para el kiosco (#40). El mismo contrato que
/// `dominio/Api.kt` en la app de Android (`apps/android`).
///
/// ── Por qué una API key y no un token de dispositivo ─────────────────────────
///
/// `kiosk_devices` todavía no dice a qué almacén pertenece cada tablet, y la
/// existencia que publica el recomendador es la del almacén del cliente del
/// token. Mientras tanto la tablet usa la API key de la tienda, con el permiso
/// `RECOMMENDER_READ` y nada más. Se pone en `Config/Kiosco.xcconfig`, que no se
/// versiona.
///
/// ── Errores ──────────────────────────────────────────────────────────────────
///
/// Nada aquí lanza: cada llamada devuelve un `Resultado` que hay que mirar. En
/// una pantalla de piso de venta, un error sin tratar deja la tablet en blanco
/// delante del cliente.

/// `erp` es su propio motivo, y no `servidor`: el middleware contestó y dijo que
/// el ERP no responde. Es el corte más probable —Odoo cae, la tienda tiene wifi—
/// y ahí la caché SÍ rescata, mientras que un 500 nuestro o un 403 no.
enum MotivoFallo: Equatable, Sendable {
    case red, erp, servidor, permiso
}

enum Resultado<T: Sendable>: Sendable {
    case ok(T)
    case fallo(MotivoFallo)
}

extension Resultado: Equatable where T: Equatable {}

/// Lo mínimo de `URLSession` que hace falta: así los tests responden lo que
/// quieren sin red.
protocol Transporte: Sendable {
    func enviar(_ peticion: URLRequest) async throws -> (Data, HTTPURLResponse)
}

struct TransporteURLSession: Transporte {
    func enviar(_ peticion: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let (datos, respuesta) = try await URLSession.shared.data(for: peticion)
        guard let http = respuesta as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        return (datos, http)
    }
}

struct ConfigApi: Sendable {
    let base: String
    let apiKey: String

    /// La de `Info.plist`, que sale del xcconfig de la tablet.
    static func delBundle(_ bundle: Bundle = .main) -> ConfigApi {
        ConfigApi(
            base: (bundle.object(forInfoDictionaryKey: "AstaApiBase") as? String) ?? "",
            apiKey: (bundle.object(forInfoDictionaryKey: "AstaApiKey") as? String) ?? ""
        )
    }
}

struct ClienteApi: Sendable {
    let config: ConfigApi
    var transporte: any Transporte = TransporteURLSession()

    private struct RespuestaBusqueda: Decodable {
        struct Meta: Decodable { let busquedaId: String? }
        let data: [Impresora]
        let sugerencias: [Impresora]
        let meta: Meta
    }

    private struct RespuestaCompatibles: Decodable {
        let data: [ProductoCompatible]
    }

    private struct CuerpoError: Decodable {
        struct Detalle: Decodable { let code: String? }
        let error: Detalle?
    }

    /// El 503 del middleware cuando Odoo no responde (`ODOO_UNAVAILABLE`).
    private static func esErpCaido(_ estado: Int, _ datos: Data) -> Bool {
        guard estado == 503 else { return false }
        return (try? JSONDecoder().decode(CuerpoError.self, from: datos))?.error?.code == "ODOO_UNAVAILABLE"
    }

    private func pedir<T: Decodable & Sendable>(_ ruta: String, metodo: String = "GET", cuerpo: Data? = nil) async -> Resultado<T> {
        guard let url = URL(string: config.base + ruta) else { return .fallo(.red) }
        var peticion = URLRequest(url: url, timeoutInterval: 15)
        peticion.httpMethod = metodo
        peticion.setValue(config.apiKey, forHTTPHeaderField: "X-API-Key")
        if let cuerpo {
            peticion.httpBody = cuerpo
            peticion.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }

        let datos: Data
        let respuesta: HTTPURLResponse
        do {
            (datos, respuesta) = try await transporte.enviar(peticion)
        } catch {
            // Sin conexión, o el servidor no responde: la pantalla dice "sin
            // conexión" en vez de "error".
            return .fallo(.red)
        }

        switch respuesta.statusCode {
        case 401, 403: return .fallo(.permiso)
        case 200..<300: break
        default: return .fallo(Self.esErpCaido(respuesta.statusCode, datos) ? .erp : .servidor)
        }
        guard let valor = try? JSONDecoder().decode(T.self, from: datos) else { return .fallo(.servidor) }
        return .ok(valor)
    }

    func buscarImpresoras(_ q: String) async -> Resultado<Busqueda> {
        let consulta = q.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed.subtracting(CharacterSet(charactersIn: "&=+?#"))) ?? ""
        let r: Resultado<RespuestaBusqueda> = await pedir("/api/v1/public/recommender/printers?q=\(consulta)&limit=12")
        switch r {
        case let .ok(b): return .ok(Busqueda(impresoras: b.data, sugerencias: b.sugerencias, busquedaId: b.meta.busquedaId))
        case let .fallo(m): return .fallo(m)
        }
    }

    func compatiblesDe(_ impresoraId: Int, busquedaId: String?) async -> Resultado<[ProductoCompatible]> {
        let q = busquedaId.flatMap { $0.addingPercentEncoding(withAllowedCharacters: .alphanumerics) }.map { "?busquedaId=\($0)" } ?? ""
        let r: Resultado<RespuestaCompatibles> = await pedir("/api/v1/public/recommender/printers/\(impresoraId)/compatible\(q)")
        switch r {
        case let .ok(c): return .ok(c.data)
        case let .fallo(m): return .fallo(m)
        }
    }

    /// `/health` no pide API key y es lo más barato que responde el middleware.
    func estaVivo() async -> Bool {
        guard let url = URL(string: config.base + "/health") else { return false }
        guard let (_, respuesta) = try? await transporte.enviar(URLRequest(url: url, timeoutInterval: 10)) else { return false }
        return (200..<300).contains(respuesta.statusCode)
    }

    private struct Vacio: Decodable, Sendable {}

    /// Qué producto miró el cliente (#43). Se lanza y se olvida: que la
    /// telemetría falle no puede estropear lo que el cliente está haciendo.
    func registrarClic(busquedaId: String?, productId: Int) {
        guard let busquedaId, let cuerpo = try? JSONEncoder().encode(["productId": productId]) else { return }
        Task { let _: Resultado<Vacio> = await pedir("/api/v1/public/recommender/busquedas/\(busquedaId)/clic", metodo: "POST", cuerpo: cuerpo) }
    }
}
