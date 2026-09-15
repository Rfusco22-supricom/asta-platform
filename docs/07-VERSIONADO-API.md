# 07 · Versionado de la API pública

Política de cambios de `/api/v1/public/*` y `/api/v1/descargas/*`. Issue #37.

Existe **antes** del primer cliente integrado a propósito: una vez que otra
empresa lee nuestras respuestas, cambiar su forma es un incidente en un sistema
que no controlamos.

---

## 1. Qué promete la API

La versión va en la ruta: `/api/v1`. Mientras una versión esté publicada, un
cliente que la usa **no tiene que tocar su código** por nada de lo que hagamos.

Esa promesa tiene dos mitades. La nuestra es no hacer cambios incompatibles
(§2). La del cliente es leer las respuestas de forma tolerante (§4). Sin la
segunda, hasta añadir un campo rompería a alguien, y no se podría evolucionar
nada.

## 2. Qué es un cambio incompatible

Un cambio es **incompatible** si un cliente que cumple §4 puede dejar de
funcionar, o puede seguir funcionando **con datos de significado distinto**.
Lo segundo es peor que lo primero: un error se ve; un número que cambió de
significado, no.

| Incompatible — exige `v2` | Ejemplo |
|---|---|
| Quitar o renombrar un campo de la respuesta | `folio` pasa a llamarse `numero` |
| Cambiar el tipo o el formato de un campo | `total` pasa de número a texto; `fecha` de `YYYY-MM-DD` a timestamp |
| Hacer `null` un campo que nunca lo era | `sku` empieza a llegar vacío |
| **Cambiar el significado de un campo sin cambiar su forma** | `total` pasa de moneda de la compañía a moneda de la factura |
| Quitar un endpoint, un parámetro o un scope | |
| Hacer obligatorio un parámetro que era opcional | |
| Rechazar una entrada que antes se aceptaba | bajar el máximo de `porPagina` de 100 a 50 |
| Cambiar el valor por defecto de un parámetro | `porPagina` por defecto de 50 a 20 |
| Cambiar el status HTTP o el `code` de error de una situación existente | una factura ajena pasa de 404 a 403 |
| Cambiar el orden documentado de un listado | |
| Cambiar cómo se autentica | cabecera `X-API-Key` → `Authorization` |

| Compatible — puede salir en `v1` | Condición |
|---|---|
| Añadir un endpoint | |
| Añadir un parámetro **opcional** | Sin él, la respuesta es la de antes |
| Añadir un campo a una respuesta | §4.1 |
| Añadir un valor a una enumeración de respuesta | §4.2, y se anuncia (§5) |
| Añadir un código de error nuevo | Para una situación que antes no existía; §4.2 |
| Añadir un scope | Las keys existentes no lo reciben solas |
| Subir un máximo (`porPagina`, rate limit) | |
| Cambiar el texto de `error.message` | No es contrato: §4.3 |
| Añadir cabeceras de respuesta | |
| Corregir un fallo de seguridad | Siempre, aunque rompa. Ver §3.2 |

**Ante la duda, es incompatible.**

## 3. Cuánto dura una versión

### 3.1 Convivencia

Cuando se publica `v2`, `v1` se mantiene **al menos 6 meses**, sin cambios salvo
correcciones. La fecha de retirada se fija y se anuncia **el mismo día** que
sale `v2`, no después.

Seis meses porque quien integra con nosotros es el departamento de sistemas de
un cliente, con su propia planificación: menos de un trimestre de margen no es
realista, y más de medio año obliga a mantener dos versiones de todo.

### 3.2 La excepción: seguridad

Un fallo que expone datos de un cliente a otro, o que permite actuar en nombre
de otro, **se corrige en `v1` en cuanto se detecta**, aunque rompa
integraciones. Se avisa a la vez que se despliega, no con antelación: avisar
antes es publicar cómo explotarlo.

### 3.3 Antes del primer cliente

Mientras **ningún cliente externo** use una API key de producción, `v1` puede
cambiar sin seguir este documento. Es ahora cuando hay que resolver, por
ejemplo, la pregunta abierta de #32 sobre la moneda de `total`.

El primer uso externo se registra aquí, con fecha. Desde ese momento rige todo
lo anterior.

> **Primer cliente integrado:** _pendiente_

## 4. Qué se le pide al cliente

Va en la documentación pública (#35), con estas palabras o parecidas.

### 4.1 Ignorar lo que no conoce

Un campo nuevo en una respuesta **no es un error**. Un cliente que valida las
respuestas con un esquema estricto, que rechaza campos desconocidos, se rompe
con cambios que esta política permite.

### 4.2 Tener un caso por defecto en las enumeraciones

`estadoPago`, `stock` y `error.code` pueden recibir valores nuevos. Un `switch`
sin rama por defecto se rompe con eso. Lo razonable es tratar el valor
desconocido como el más prudente: un `stock` que no se entiende, como
`agotado`; un `error.code` que no se entiende, por su status HTTP.

> Nota interna: `errorCodeSchema` es una enumeración cerrada para que **el
> panel** pueda hacer un `switch` exhaustivo, porque el panel se despliega a la
> vez que el middleware. Un cliente externo no, y por eso a él se le pide lo
> contrario.

### 4.3 No depender de `error.message`

Es texto para personas y puede cambiar. Lo que se programa es `error.code`.

### 4.4 Leer `Deprecation` y `Sunset`

Ver §5.

## 5. Cómo se avisa

| Qué | Cuándo | Por dónde |
|---|---|---|
| Cambio compatible | Al desplegar | Registro de cambios de la documentación |
| Valor nuevo en una enumeración de respuesta | **30 días antes** | Registro de cambios + correo |
| Nueva versión y fecha de retirada de la anterior | El día que sale | Registro de cambios + correo + cabeceras |
| Recordatorio de retirada | 60 y 15 días antes | Correo |
| Corrección de seguridad que rompe | Al desplegar | Correo |

**Correo:** a los dueños de las keys activas —no revocadas y usadas en los
últimos 90 días (`api_keys.last_used_at`)— de la versión afectada. Una key sin
uso en 90 días se da por abandonada; su dueño se entera por el registro de
cambios.

**Cabeceras**, en cada respuesta de una versión con fecha de retirada:

```
Deprecation: @1790812800
Sunset: Thu, 01 Apr 2027 00:00:00 GMT
Link: <https://…/docs/cambios>; rel="deprecation"
```

`Deprecation` (RFC 9745) y `Sunset` (RFC 8594) son estándar: muchas librerías
HTTP y pasarelas las registran solas, así que llegan también a quien no lee el
correo.

**Después de la fecha de retirada**, la versión responde `410 Gone` durante
3 meses, con un cuerpo que dice a qué versión migrar. Un 404 haría pensar en un
fallo nuestro.

## 6. Qué NO cubre

- **Las rutas del panel** (`/api/v1/auth`, `/salesperson`, `/admin`,
  `/account`): el panel y el middleware se despliegan juntos y cambian a la vez.
- **Los endpoints que responden `501`**: no están publicados, y su forma puede
  cambiar hasta que se implementen.
- **El rate limit de cada key**: es configuración por cliente, no contrato de
  versión. Bajarlo se habla con ese cliente.
