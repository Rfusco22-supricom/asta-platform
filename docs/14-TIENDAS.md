# La aplicación ASTA en App Store y Google Play

Todo lo que piden las dos tiendas para publicar la aplicación de las tablets
(`apps/ios`, `apps/android`), listo para copiar. Las cuentas y las subidas las
hace Supricom: piden datos de la empresa, pago y contraseñas.

| | |
|---|---|
| Nombre en la tienda | **ASTA · Encuentra tu tóner** |
| Nombre bajo el icono | ASTA |
| Identificador (iOS y Android) | `com.supricom.asta` — **no se puede cambiar una vez publicada** |
| Versión | 1.0.0 (iOS `MARKETING_VERSION`, Android `versionName`) |
| Dispositivos | Solo iPad / solo tablets (pantalla de 600 dp o más), en horizontal |
| Política de privacidad | https://asta-panel.larlxe.easypanel.host/privacidad |
| Soporte | https://asta-panel.larlxe.easypanel.host/soporte |
| Correo de contacto | apps@supricom.com.ve (el de las dos cuentas) |

Si el panel cambia de dirección, hay que cambiarla también en las dos tiendas.

## 1. Las cuentas

Las dos, **de empresa** (a nombre de Supricom, no de una persona). Las dos
piden el **número D-U-N-S** de la empresa.

### El D-U-N-S (lo que más tarda)

1. Buscar si Supricom ya tiene uno: <https://developer.apple.com/enroll/duns-lookup/>.
   Escribir la razón social y la dirección **exactamente como en el RIF**.
2. Si no sale, pedirlo desde esa misma página. Es gratis y suele tardar de 5 a
   14 días hábiles. Llega por correo.
3. El nombre y la dirección de la cuenta de Apple y la de Google tienen que
   coincidir con los del D-U-N-S.

### Apple Developer Program (99 USD al año)

1. Una cuenta de Apple de la empresa (no personal), con verificación en dos
   pasos.
2. <https://developer.apple.com/programs/enroll/> → **Organización**. Pide el
   D-U-N-S, una web pública de la empresa y que quien la abre pueda firmar por
   ella. Apple puede llamar para confirmarlo.
3. Cuando esté aprobada: en este Mac, **Xcode → Settings → Accounts**, añadir
   esa cuenta (para firmar y subir).

### Google Play Console (25 USD, una vez)

1. Una cuenta de Google de la empresa.
2. <https://play.google.com/console/signup> → **Organización**. Pide el D-U-N-S,
   la web y un teléfono y correo de contacto. Google verifica la empresa y a la
   persona que la abre.
3. Con cuenta de organización **no** hacen falta los 14 días de pruebas con 12
   personas que Google exige a las cuentas personales nuevas.

## 2. Las fichas de la tienda

**Subtítulo** (App Store, 30 caracteres): El tóner de tu impresora

**Descripción breve** (Google Play, 80 caracteres):
Escribe el modelo de tu impresora y mira qué tóner o tinta ASTA le sirve.

**Texto promocional** (App Store, 170 caracteres):
La tablet de tu tienda ASTA: escribe el modelo de la impresora y en segundos ves el tóner o la tinta que le sirve, y si hay en tienda.

**Descripción** (las dos):

> ASTA · Encuentra tu tóner es la aplicación de las tablets de las tiendas que
> venden ASTA.
>
> El cliente escribe el modelo de su impresora —«M404», «L3250», «MF643»— y la
> aplicación le enseña el tóner, la tinta o el tambor ASTA que le sirve, con su
> código, y si hay en la tienda en ese momento. Sin preguntar al mostrador y sin
> llevarse uno que no le sirve.
>
> • Miles de impresoras HP, Canon, Epson, Brother y Samsung.
> • Tóners, tintas en botella, cartuchos de tinta y tambores.
> • Pensada para una tablet en un soporte: letras grandes, en horizontal.
>
> La aplicación se vincula a una tienda con un código del panel de ASTA: la
> tienda la registra en «Mis tablets» y la tablet queda lista. Si eres cliente
> de Supricom y quieres una para tu tienda, pídesela a tu vendedor.

**Palabras clave** (App Store, 100 caracteres):
tóner,tinta,impresora,cartucho,toner,HP,Canon,Epson,Brother,Samsung,compatible,botella,tambor

**Categoría:** Negocios (secundaria en App Store: Utilidades).

**Icono:** `apps/ios/AstaKiosco/Recursos/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png`
(App Store lo toma de la versión; Google Play pide uno de 512 × 512, que se saca
de ese mismo).

**Capturas:** cinco por tienda, en este orden: la pantalla de inicio, escribiendo
el modelo («M404»), la lista de impresoras, el resultado de un tóner (HP M404DN)
y el de una tinta en botella (Canon G3170, «USA LA TINTA»). Con datos reales y
una tablet de cliente (sin existencias a la vista).

| | Tamaño | Archivos |
|---|---|---|
| App Store, iPad 13" | 2752 × 2064 | `ipad-1-inicio.png` … `ipad-5-tinta.png` |
| Google Play, tablet | 2560 × 1600 | `tablet-1-inicio.png` … `tablet-5-tinta.png` |
| Google Play, icono | 512 × 512 | `icono-512.png` |
| Google Play, gráfico destacado | 1024 × 500 | `grafico-1024x500.png` |

No se versionan (pesan): se generan de nuevo para cada versión que cambie la
pantalla. En iPad, con la prueba `AstaKioscoUITests/CapturasTests.swift`
(esquema *Capturas*: recorre la app y guarda las cinco), con una tablet de
prueba vinculada a un middleware local. Las imágenes del simulador salen con una
nota de orientación: hay que girarlas a 2752 × 2064 y quitársela, o App Store
Connect las puede enseñar de lado. En Android, en el emulador de tablet con
`adb exec-out screencap -p`.

## 3. Para los revisores

Las dos tiendas revisan la aplicación y tienen que poder usarla sin una tablet
de una tienda. Para eso está el **código de revisores**: 12 dígitos, no caduca y
se puede revocar. Se genera en el panel, en **Tablets**, sección «Código para los revisores de Apple y Google».

**Notas para la revisión** (App Store: *App Review Information → Notes*;
Google Play: *Acceso a la app → Instrucciones*):

> This app is used on tablets inside the stores that sell ASTA products. A store
> links each tablet from its ASTA dashboard with a one-time code.
>
> To review it, open the app and enter this code when it asks for one:
> **XXXX XXXX XXXX**
>
> Then type a printer model, for example «M404», «L3250» or «P1102», to see the
> compatible ASTA toner or ink. The camera is only used, if chosen, to scan the
> QR version of the same code.

En App Store no hace falta usuario ni contraseña de demostración: el código lo
sustituye.

## 4. Privacidad

Lo que la aplicación manda está en la política (`apps/web/app/privacidad`). Si
cambia lo que la aplicación envía, hay que cambiar la política y estas respuestas.

### App Store → App Privacy

- **¿Recoges datos?** Sí.
- **Search History** (historial de búsqueda): *App Functionality* y *Analytics*.
  **No** vinculado a la identidad del usuario. **No** se usa para rastrear.
- **Product Interaction** (dentro de *Usage Data*): igual que el anterior.
- Nada más: ni contacto, ni ubicación, ni identificadores, ni compras.

### Google Play → Seguridad de los datos

- ¿Se recogen o comparten datos? **Sí, se recogen; no se comparten.**
- Cifrados en tránsito: **Sí**.
- Forma de pedir que se borren: **Sí**, por el correo de la política.
- Tipos: **Actividad en la app → Historial de búsquedas en la app** y **Otras
  acciones del usuario**. Obligatorio (no opcional). Para: *Funciones de la app*
  y *Analíticas*.
- Ninguno más.

## 5. El resto de cuestionarios

| Pregunta | Respuesta |
|---|---|
| Cifrado / exportación (App Store) | Ya va en la app: `ITSAppUsesNonExemptEncryption = NO` (solo HTTPS). |
| Clasificación por edad | Herramienta de tienda, sin contenido sensible: **4+** (Apple), **Para todos** (IARC). |
| Público objetivo (Google Play) | **18 años o más**: es para tiendas. |
| ¿Contiene anuncios? | **No**. |
| ¿Es de un gobierno, de salud o financiera? | **No**. |
| Precio | **Gratis**. |
| Países | Venezuela (se pueden añadir más). |

## 6. Distribución: que no la encuentre cualquiera

- **App Store:** publicar como app **no listada** (*Unlisted App
  Distribution*). Cuando Apple apruebe la primera versión, se pide en
  <https://developer.apple.com/contact/request/unlisted-app/>. Solo se instala
  con el enlace directo, que se manda a los clientes.
- **Google Play:** publicación normal (Google no tiene «no listada» para apps
  públicas). Como solo sirve con un código del panel, quien la encuentre sin ser
  cliente no puede usarla.

## 7. Compilar y subir

### iOS

1. `cd apps/ios && xcodegen`, y abrir `AstaKiosco.xcodeproj`.
2. En el target *AstaKiosco* → *Signing & Capabilities*: el equipo de Supricom.
3. Destino *Any iOS Device*, **Product → Archive**.
4. En el Organizer: *Distribute App → App Store Connect → Upload*.
5. Cada subida necesita un `CURRENT_PROJECT_VERSION` mayor en `project.yml`.

### Android

La **clave de subida** la crea Supricom una vez y no se puede perder: sin ella
no se pueden subir versiones nuevas (Google puede cambiarla, pero tarda días).

1. Crearla (pide una contraseña; guardarla en el gestor de contraseñas):

   ```bash
   keytool -genkeypair -v -keystore ~/asta-subida.jks -alias asta -keyalg RSA -keysize 2048 -validity 10000
   ```

2. Crear `apps/android/keystore.properties` (no se versiona):

   ```properties
   storeFile=/Users/<usuario>/asta-subida.jks
   storePassword=<la contraseña>
   keyAlias=asta
   keyPassword=<la contraseña>
   ```

3. Copia de seguridad de `asta-subida.jks` y de la contraseña fuera de este Mac.
4. `cd apps/android && ./gradlew bundleRelease` → `app/build/outputs/bundle/release/app-release.aab`.
5. En Play Console, *Prueba interna* primero; luego *Producción*. Aceptar **Play
   App Signing** (Google guarda la clave de firma final; la nuestra es solo la de
   subida).
6. Cada subida necesita un `versionCode` mayor en `app/build.gradle.kts`.

### Las dos

Las versiones de tienda se compilan **sin** clave dentro: `ASTA_API_KEY` vacío
en `Config/Kiosco.xcconfig` y `asta.apiKey` vacío en `local.properties`, y
`apiBase` apuntando a producción. Así cada tablet se vincula con su propio código.
