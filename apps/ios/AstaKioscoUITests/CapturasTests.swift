import XCTest

/// Las capturas para App Store (`docs/14-TIENDAS.md`): recorre la aplicación
/// como un cliente y guarda una imagen de cada pantalla. Lo mismo que se hizo a
/// mano en Android.
///
/// No es una prueba de las de siempre: necesita una tablet de prueba vinculada
/// (`ASTA_API_KEY` en `Config/Kiosco.xcconfig`) contra un middleware con datos,
/// y solo corre con su esquema:
///
///     TEST_RUNNER_CAPTURAS_DIR=/ruta/donde/guardarlas xcodebuild test -scheme Capturas \
///       -destination 'platform=iOS Simulator,name=iPad Pro 13-inch (M5)'
///
/// (`TEST_RUNNER_` delante: así xcodebuild le pasa la variable a la prueba.)
///
/// Sin `CAPTURAS_DIR` se salta.
@MainActor
final class CapturasTests: XCTestCase {
    private var app: XCUIApplication!
    private var carpeta: URL!

    override func setUp() async throws {
        let ruta = ProcessInfo.processInfo.environment["CAPTURAS_DIR"] ?? ""
        try XCTSkipIf(ruta.isEmpty, "Sin CAPTURAS_DIR no hay dónde guardarlas.")
        carpeta = URL(fileURLWithPath: ruta, isDirectory: true)
        try FileManager.default.createDirectory(at: carpeta, withIntermediateDirectories: true)
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .landscapeLeft
        app = XCUIApplication()
        app.launch()
    }

    func testCapturas() throws {
        // Toda la pantalla de inicio es el botón («Toca para empezar»).
        let empezar = app.buttons["Empezar a buscar tu tóner"]
        if !empezar.waitForExistence(timeout: 20) {
            captura("error-arranque")
            XCTFail("No llegó a la pantalla de inicio: ¿está vinculada la tablet? Ver error-arranque.png.\n\(app.debugDescription.prefix(3000))")
            return
        }
        // El modelo de ejemplo cambia con un fundido: se espera a que esté quieto.
        sleep(2)
        captura("ipad-1-inicio")

        empezar.tap()
        escribir("M404")
        sleep(1)
        captura("ipad-2-buscar")

        app.buttons["Buscar"].tap()
        let impresora = app.buttons["HP M404DN"]
        XCTAssertTrue(impresora.waitForExistence(timeout: 30))
        captura("ipad-3-lista")

        impresora.tap()
        XCTAssertTrue(app.staticTexts["CF258A"].waitForExistence(timeout: 30))
        sleep(1)
        captura("ipad-4-toner")

        app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Buscar otra")).firstMatch.tap()
        escribir("G3170")
        app.buttons["Buscar"].tap()
        let canon = app.buttons["Canon G3170"]
        XCTAssertTrue(canon.waitForExistence(timeout: 30))
        canon.tap()
        XCTAssertTrue(app.staticTexts["GI-11"].waitForExistence(timeout: 30))
        sleep(1)
        captura("ipad-5-tinta")
    }

    /// Con el teclado de la aplicación, tecla a tecla.
    private func escribir(_ texto: String) {
        for c in texto {
            let tecla = app.buttons[String(c)]
            XCTAssertTrue(tecla.waitForExistence(timeout: 10), "No está la tecla \(c)")
            tecla.tap()
        }
    }

    private func captura(_ nombre: String) {
        let imagen = XCUIScreen.main.screenshot()
        try? imagen.pngRepresentation.write(to: carpeta.appendingPathComponent("\(nombre).png"))
        let adjunto = XCTAttachment(screenshot: imagen)
        adjunto.name = nombre
        adjunto.lifetime = .keepAlways
        add(adjunto)
    }
}
