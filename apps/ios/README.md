# Kiosco de Asta para iPad (SwiftUI)

App nativa del kiosco de piso de venta. Issue #40. Sustituye a la app Expo de
`apps/mobile`, que se queda en el repo como referencia hasta que la versión de
Android en Kotlin haga lo mismo.

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

1. **La API key**, en `Config/Kiosco.xcconfig` (`ASTA_API_KEY`): la de la
   tienda, con el permiso `RECOMMENDER_READ` **y ninguno más**. Se crea en el
   panel, en «Mis API keys». **No se commitea**: el fichero está en `.gitignore`.
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

Misma lógica que la app Expo, con los mismos nombres, para poder compararlas:

| Expo (`apps/mobile/src`) | iOS (`AstaKiosco`) |
|---|---|
| `api.ts` | `Dominio/Api.swift` |
| `cache.ts`, `datos.ts` | `Dominio/Cache.swift`, `Dominio/Datos.swift` |
| `conexion.ts` | `Dominio/Vigilante.swift` |
| `sesion.ts` | `Dominio/Sesion.swift` |
| `producto.ts` | `Dominio/Producto.swift` |
| `tema.ts` | `Vistas/Tema.swift` |
| `App.tsx` y pantallas | `Vistas/` |

- **La sesión (#41)**: se cierra sola a los 4 minutos sin tocar, avisando 30 s
  antes con cuenta atrás; «Terminar» la cierra a mano. Al cerrarse se rehacen
  las pantallas y no queda nada del cliente anterior.
- **Sin conexión (#42)**: se guarda lo consultado (12 h, 200 entradas). Sin red
  o sin ERP se enseña lo último, con su fecha; un 403 o un 404 **no** se tapan.
  El estado de la conexión está siempre visible para el personal, y al volver
  la red la pantalla se pone al día sola.
- **Teclado propio**: el del sistema tapa los resultados y autocorrige los
  modelos. Solo letras, números, guion y espacio.
- **Fuentes**: Archivo y JetBrains Mono van dentro de la app (`Recursos/Fuentes`,
  licencia OFL), así no dependen de la red de la tienda.
