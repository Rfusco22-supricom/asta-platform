# 13 · Poner el kiosco en un iPad de verdad

Del proyecto a una tablet en el mostrador. Issue #40.

El simulador no sirve para la tienda: hay que firmar la app con una cuenta de
Apple e instalarla en el equipo. Esta guía es para quien tiene esa cuenta.

> **Dos cosas hay que resolver antes, y ninguna se arregla desde el código.**
> Están comprobadas, con fecha, en «Lo que falta» al final. En resumen:
>
> 1. **Este Mac no tiene ninguna identidad de firma** (`security find-identity -v
>    -p codesigning` → *0 valid identities found*). Sin una cuenta de Apple en
>    Xcode no se puede instalar en ningún iPad.
> 2. **El middleware no responde desde fuera**: su dominio público da **502**. La
>    tablet no tendría a quién preguntar.

---

## 1. La cuenta de Apple: qué hace falta de verdad

| | Apple ID gratis | Apple Developer Program (99 $/año) |
|---|---|---|
| Instalar en un iPad propio, por cable | sí | sí |
| **Cuánto dura la app instalada** | **7 días** y deja de abrir | **1 año** |
| TestFlight (instalar sin cable, varias tiendas) | no | sí |
| Modo de app única con MDM | no | sí |

Para un kiosco que está encendido todos los días, **el Apple ID gratis no
sirve**: a la semana la app deja de abrirse y hay que volver a conectar la tablet
al Mac. Vale solo para una prueba de un rato.

Con cuenta de pago hay dos caminos. **Para una tienda, el cable. Para varias,
TestFlight.**

---

## 2. Instalar por cable (una tablet)

1. **Xcode → Settings → Accounts → +** e iniciar sesión con el Apple ID de la
   cuenta de desarrollador. Es el paso que hoy falta en este Mac.
2. La API key y la URL del middleware, en `apps/ios/Config/Kiosco.xcconfig`:

   ```
   ASTA_API_BASE = https:/$()/middleware-de-produccion
   ASTA_API_KEY = la-de-esta-tienda
   ```

   La barra rara no es una errata: en un `xcconfig`, `//` empieza un comentario,
   así que la URL se escribe `https:/$()/…`. **Ese fichero no se sube**: está en
   `.gitignore`, y cada tienda lleva la suya.

   La key se crea en el panel, en «Mis API keys», **con el permiso
   `RECOMMENDER_READ` y ninguno más**: si la tablet se pierde, lo único que se
   puede hacer con ella es consultar qué tóner sirve.

3. Generar el proyecto e abrirlo:

   ```bash
   cd apps/ios && xcodegen && open AstaKiosco.xcodeproj
   ```

4. En Xcode, con el target `AstaKiosco` seleccionado: **Signing & Capabilities →
   Team**, elegir el equipo. *Automatically manage signing* se queda marcado.
5. Conectar el iPad por cable, elegirlo arriba como destino y **⌘R**.
6. La primera vez, en el iPad: **Ajustes → General → VPN y gestión de
   dispositivos → confiar** en el perfil de desarrollador.

Si da `Unable to install` o `Untrusted Developer`, es el paso 6.

---

## 3. TestFlight (varias tablets, sin cable)

Para cuando haya más de una tienda. Lo hace la cuenta de desarrollador:

1. En App Store Connect, crear la app con el identificador
   **`com.supricom.asta.kiosco`** (es el que pone `project.yml`; cambiarlo
   obliga a crear otra app).
2. Subir la versión: en Xcode, **Product → Archive** y luego *Distribute App →
   App Store Connect → Upload*.
3. En App Store Connect, **TestFlight**, añadir al personal de tienda como
   probadores internos. Les llega un correo y se instala desde la app TestFlight.
4. Cada subida necesita un `CURRENT_PROJECT_VERSION` distinto: se sube en
   `project.yml` (`CURRENT_PROJECT_VERSION: "2"`, y así).

Una compilación de TestFlight **caduca a los 90 días**. Para una tablet que no
se toca en meses, el cable del punto 2 da menos trabajo.

---

## 4. Dejar la tablet hecha un kiosco

La app ya se abre a pantalla completa, en horizontal, sin barra de estado y sin
que la pantalla se apague. **Eso no impide que alguien se salga de ella.**

- **Acceso guiado** (Ajustes → Accesibilidad → Acceso guiado): se activa
  pulsando tres veces el botón lateral con la app abierta, y pide un código para
  salir. Gratis y suficiente para un mostrador atendido.
- **Modo de app única**, desde un MDM con las tablets inscritas en Apple Business
  Manager: la tablet no puede salir de la app ni reiniciándose. Es lo correcto si
  se compran equipos para esto.

Y dos ajustes que se olvidan siempre: **bloqueo automático en «Nunca»** (Ajustes
→ Pantalla y brillo) y la tablet **enchufada a la corriente**.

---

## 5. Comprobar que quedó bien

En la tablet, sin preguntarle a nadie:

1. El indicador de arriba a la izquierda, **en verde**. Si está en rojo, la
   tablet no llega al middleware: ver `10-RUNBOOK-TIENDA.md`, §2.
2. Buscar una impresora que sí tenga consumible Asta validado y comprobar que
   sale **con el sello ★ RECOMENDADO**.
3. Dejarla cuatro minutos sin tocar: tiene que volver sola a la pantalla de
   atracción (#41).
4. Quitarle el wifi y repetir una búsqueda ya hecha: tiene que salir lo guardado
   **con su hora** (#42).

---

## Lo que falta, comprobado el 2026-10-02

**1. La firma.** En este Mac, `security find-identity -v -p codesigning`
devuelve *0 valid identities found*: nadie ha iniciado sesión con una cuenta de
Apple en Xcode. Es el paso 1 de arriba y **solo lo puede hacer una persona con
esa cuenta**; no se automatiza desde aquí.

**2. El middleware no está publicado.**

```
curl -o /dev/null -w '%{http_code}' https://asta-middleware.larlxe.easypanel.host/health   → 502
```

Hoy solo está expuesto el panel. Mientras el middleware no responda desde
internet, **una tablet en una tienda no tiene a quién preguntar**: el kiosco
arrancaría en rojo y solo serviría lo que tuviera en caché, que al principio es
nada. Hay que arreglarlo en el dominio del servicio `middleware` en EasyPanel
(ver `06-DESPLIEGUE-EASYPANEL.md`), y eso necesita el panel de EasyPanel.

**3. Y aunque se arregle: en producción no hay compatibilidades validadas.** Las
tablas de impresoras están cargadas, pero sin cadenas validadas
(impresora → cartucho → producto) el kiosco contestará «pregunta en el
mostrador» a casi todo. La pantalla de cobertura del panel dice cuánto falta, y
el orden está en `09-BASELINE-PRISMA.md`: los tres importadores y después la
revisión.

En otras palabras: **la app está lista antes que los datos.** Para una prueba en
una tablet con el middleware de desarrollo, el punto 2 de esta guía basta hoy.
