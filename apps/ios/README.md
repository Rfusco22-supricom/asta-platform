# Kiosco de Asta para iPad (SwiftUI)

App nativa del kiosco de piso de venta. Issue #40. Su pareja para tablets
Android, en Kotlin, está en `apps/android`. Las dos sustituyen a la primera
versión, en Expo, que se retiró (#164).

El cliente escribe su modelo de impresora y ve **qué tóner le sirve y si lo hay
en la tienda**. Tres pantallas: atracción → buscar → resultados.

## Compilar

Hace falta Xcode 16 o posterior y [XcodeGen](https://github.com/yonaskolb/XcodeGen).
El `.xcodeproj` no se versiona: sale de `project.yml`.

```bash
brew install xcodegen
cd apps/ios
cp Config/Kiosco.example.xcconfig Config/Kiosco.xcconfig   # y rellenarlo
xcodegen
open AstaKiosco.xcodeproj
```

Tests (lógica: API, caché sin conexión, sesión, conexión y presentación):

```bash
xcodebuild test -project AstaKiosco.xcodeproj -scheme AstaKiosco \
  -destination 'platform=iOS Simulator,name=iPad Pro 11-inch (M5)'
```

## Preparar una tablet

1. **La credencial: ninguna.** La versión de la tienda de apps se compila con
   `ASTA_API_KEY` **vacío** en `Config/Kiosco.xcconfig`. Al abrirse, la tablet
   pide un **código de 6 dígitos** (o su QR) que se saca en el panel, en
   **Tablets → «Añadir tablet»**: lo saca un cliente para su tienda (la tablet
   enseña solo compatibilidades) o un administrador para una tienda de Supricom
   (elige el almacén y enseña existencias). Con él la tablet recibe su **token**
   (`asta_kio_…`), que guarda en el llavero. Solo abre el recomendador
   (`/api/v1/kiosk`). Desactivada en el panel, vuelve a pedir un código. Para la
   revisión de Apple hay un código de 12 dígitos que no caduca (Tablets →
   «Código para los revisores»).

   Para desarrollo o una tablet preparada a mano, el token puede ir compilado
   en `ASTA_API_KEY` («Preparar una tablet a mano» en el panel): entonces no
   pide nada. **No se commitea**: el fichero está en `.gitignore`.
2. **La URL** del middleware (`ASTA_API_BASE`). En un xcconfig `//` empieza un
   comentario, así que va como `https:/$()/…`. En el simulador, `localhost` es el
   Mac.
3. **Bloquear la tablet.** La app ya va a pantalla completa, en horizontal, sin
   barra de estado y sin que la pantalla se apague, pero **eso no impide salirse
   de ella**. Para un kiosco de verdad:
   - **Acceso guiado** (Ajustes → Accesibilidad → Acceso guiado): gratis, y basta
     para un mostrador atendido.
   - **Modo de app única** desde un MDM, si se compran tablets para esto: impide
     salir incluso sin nadie delante.

## Cómo está hecha

Misma lógica que la app de Android, con los mismos nombres, para poder
compararlas y cambiarlas a la vez:

| iOS (`AstaKiosco`) | Android (`app/src/main/java/…/kiosco`) |
|---|---|
| `Dominio/Api.swift` | `dominio/Api.kt` |
| `Dominio/Cache.swift`, `Dominio/Datos.swift` | `dominio/Cache.kt`, `dominio/Datos.kt` |
| `Dominio/Vigilante.swift` | `dominio/Vigilante.kt` |
| `Dominio/Sesion.swift` | `dominio/Sesion.kt` |
| `Dominio/Producto.swift` | `dominio/Producto.kt` |
| `Vistas/Tema.swift` | `ui/Tema.kt` |
| `Vistas/` | `ui/` |

- **Solo Asta (#40).** El kiosco enseña únicamente los consumibles de la marca
  propia: lo pidió la dirección. Si una impresora no tiene ninguno, **no se
  ofrece el original**; se dice «todavía no tenemos Asta para esta impresora» y
  se manda al mostrador, que es quien puede explicar la alternativa. Y eso es
  distinto de no tener cargada la compatibilidad, que tiene su propia pantalla.
- **La sesión (#41)**: se cierra sola a los 4 minutos sin tocar, avisando 30 s
  antes con cuenta atrás; «Terminar» la cierra a mano. Al cerrarse se rehacen
  las pantallas y no queda nada del cliente anterior.
- **Sin conexión (#42)**: se guarda lo consultado (12 h, 200 entradas). Sin red
  o sin ERP se enseña lo último, con su fecha; un 403 o un 404 **no** se tapan.
  El estado de la conexión está siempre visible para el personal, y al volver
  la red la pantalla se pone al día sola.
- **Teclado propio**: el del sistema tapa los resultados y autocorrige los
  modelos. Solo letras, números, guion y espacio.
- **Fuentes**: Sora y DM Mono (las del panel, identidad «Cristal») van dentro de la app (`Recursos/Fuentes`,
  licencia OFL), así no dependen de la red de la tienda.
