# Kiosco de Asta para tablets Android (Kotlin + Jetpack Compose)

App nativa del kiosco de piso de venta. Issue #40. Es la pareja de la de iPad
(`apps/ios`) y sustituye a la app Expo de `apps/mobile`, que se borra cuando
esta y la de iOS estén en uso.

El cliente escribe su modelo de impresora y ve **qué tóner le sirve y si lo hay
en la tienda**. Tres pantallas: atracción → buscar → resultados.

## Compilar

JDK 17 y el SDK de Android (plataforma 37). Con Android Studio basta abrir esta
carpeta. Desde la terminal:

```bash
cd apps/android
./gradlew :app:assembleDebug        # app/build/outputs/apk/debug/app-debug.apk
./gradlew :app:testDebugUnitTest    # lógica: API, caché sin conexión, sesión, conexión y presentación
```

## Preparar una tablet

1. **`local.properties`**, que no se versiona:

   ```properties
   sdk.dir=/ruta/al/Android/sdk
   asta.apiBase=https://el-middleware
   asta.apiKey=asta_live_…
   ```

   La key es la de la tienda, con el permiso `RECOMMENDER_READ` **y ninguno
   más**. Se crea en el panel, en «Mis API keys». Sin `asta.apiBase`, la app
   apunta a `http://10.0.2.2:3001`, que es el `localhost` de la máquina
   anfitriona visto desde el emulador.
2. **Bloquear la tablet.** La app ya va en horizontal, a pantalla completa con
   las barras ocultas y sin que la pantalla se apague, pero **eso no impide
   salirse de ella**. Para un kiosco de verdad:
   - **Fijar la pantalla** (Ajustes → Seguridad → Fijar apps): gratis, y basta
     para un mostrador atendido.
   - **Modo dispositivo dedicado** (device owner / lock task), si se compran
     tablets para esto: impide salir incluso sin nadie delante.

## Cómo está hecha

La misma lógica que la app Expo y la de iOS, con los mismos nombres:

| Expo (`apps/mobile/src`) | iOS (`apps/ios`) | Android (`app/src/main/java/…/kiosco`) |
|---|---|---|
| `api.ts` | `Dominio/Api.swift` | `dominio/Api.kt` |
| `cache.ts`, `datos.ts` | `Dominio/Cache.swift`, `Datos.swift` | `dominio/Cache.kt`, `Datos.kt` |
| `conexion.ts` | `Dominio/Vigilante.swift` | `dominio/Vigilante.kt` |
| `sesion.ts` | `Dominio/Sesion.swift` | `dominio/Sesion.kt` |
| `producto.ts` | `Dominio/Producto.swift` | `dominio/Producto.kt` |
| `tema.ts` | `Vistas/Tema.swift` | `ui/Tema.kt` |

- **La sesión (#41)**: se cierra sola a los 4 minutos sin tocar, avisando 30 s
  antes con cuenta atrás; «Terminar» la cierra a mano. Al cerrarse se rehacen
  las pantallas y no queda nada del cliente anterior. Los tests la prueban con
  tiempo virtual de corrutinas.
- **Sin conexión (#42)**: se guarda lo consultado (12 h, 200 entradas). Sin red
  o sin ERP se enseña lo último, con su fecha; un 403 o un 404 **no** se tapan.
  El estado de la conexión está siempre visible, y al volver la red la pantalla
  se pone al día sola.
- **Teclado propio**: el del sistema tapa los resultados y autocorrige los
  modelos. Solo letras, números, guion y espacio.
- **Fuentes**: Archivo y JetBrains Mono van dentro de la app (`res/font`,
  licencia OFL en `licencias/`).
- **Tamaño de letra**: no sigue al del sistema. El kiosco ya es grande, y ese
  ajuste lo puso alguien en una tablet compartida, no el cliente.
