# 08 · Rotación de `API_KEY_PEPPER`

Procedimiento para cambiar el pepper de las API keys. Issue #45.

**Resumen:** con `API_KEY_PEPPER_ANTERIOR`, rotar **no obliga a reemitir las
keys**. Cada key pasa al pepper nuevo la primera vez que se usa. Solo hay que
avisar a los dueños de las keys que no se usen durante la ventana de transición.

---

## 1. Qué protege el pepper, y qué no

El pepper interviene en dos cosas:

| Uso | Qué pasa si se filtra el pepper |
|---|---|
| **Hash de las API keys** (`api_keys.key_hash`, HMAC-SHA256) | **Casi nada.** El secreto de cada key son 32 bytes aleatorios: ni con el pepper y la tabla completa se puede recuperar una key, porque no hay diccionario que probar. |
| **Firma de los enlaces de PDF** (#32, clave derivada con HKDF) | **Esto sí importa.** Con el pepper se pueden firmar enlaces de descarga. Para que uno sirva con las facturas de **otro** cliente hace falta además el id interno de una key vigente de ese cliente, un UUID que solo está en la base. Con el pepper **y** la base, se descargan facturas de cualquier cliente. |

De ahí salen las dos decisiones de este documento: **cuándo** rotar (§2) y por
qué la transición puede ser larga para las keys pero es **inmediata** para los
enlaces (§3).

## 2. Cuándo rotar

| Situación | ¿Rotar el pepper? | Qué hacer |
|---|---|---|
| **Se filtró el pepper**: el `.env` de producción, una captura de las variables de EasyPanel, una copia de seguridad del entorno, alguien con acceso que ya no debe tenerlo | **Sí, hoy.** | Este procedimiento. Si además pudo leer la base, es urgente: ver §1. |
| Se comprometió el servidor o el panel de EasyPanel | **Sí**, junto con todo lo demás | Este procedimiento, más `JWT_SECRET`, la contraseña de MySQL y la API key de Odoo. |
| Se filtró **la base**, sin el pepper | No | Los hashes no sirven sin el pepper. Revisar qué más contenía la copia. |
| Se filtró **una API key** | **No** | Revocarla en el panel. Rotar el pepper no la invalida: la key migra en su siguiente uso. |
| Rotación periódica | **No** | Ver abajo. |

**No se rota de forma periódica.** Rotar no refuerza unos hashes que ya son
irrompibles (§1), y cada rotación deja sin servicio a las integraciones que no
usen su key durante la ventana. Coste sin beneficio. Se rota cuando hay motivo.

## 3. Cómo funciona la transición

Durante la rotación hay **dos** peppers configurados:

```
API_KEY_PEPPER=<nuevo>
API_KEY_PEPPER_ANTERIOR=<el que se retira>
```

- **Una key hasheada con el anterior se sigue aceptando**, y en ese mismo uso se
  vuelve a hashear con el nuevo. Es el único momento en que el token existe en
  claro, así que es el único en que se puede migrar sin molestar al cliente.
- **Una key nueva** se hashea con el nuevo desde el principio.
- **Los enlaces de PDF solo aceptan el nuevo.** Los emitidos antes de desplegar
  dejan de valer en el acto (404 `LINK_NOT_VALID`). Duran 5 minutos, así que
  afecta como mucho a quien estuviera descargando en ese momento, y es
  precisamente lo que hay que cortar si el pepper se filtró.

Al quitar `API_KEY_PEPPER_ANTERIOR`, las keys que no se usaron durante la
ventana dejan de funcionar (401 `INVALID_API_KEY`), y sus dueños tienen que
crear otra en «Mis API keys».

**Ventana: 30 días.** Mantener el pepper anterior para verificar hashes no abre
nada (§1), así que no hay prisa por cerrarla. 30 días cubren a una integración
que se ejecuta una vez al mes.

## 4. Procedimiento

### Día 0 · Rotar

1. **Generar el pepper nuevo**, en una máquina de confianza:
   ```bash
   openssl rand -base64 48
   ```
2. **En EasyPanel, servicio `asta-middleware`, variables de entorno:**
   - `API_KEY_PEPPER_ANTERIOR` = el valor **actual** de `API_KEY_PEPPER`.
   - `API_KEY_PEPPER` = el valor nuevo.

   El servidor se niega a arrancar si las dos son iguales: es el error típico al
   copiar y pegar.
3. **Desplegar** y **anotar la hora en UTC**. Es el `--desde` del resto del
   procedimiento. Anotarla en el issue o el canal del incidente.
4. **Comprobar**, en este orden:
   - `/health` responde 200.
   - Una API key que ya existía sigue funcionando. La primera petición la migra.
   - Crear una key de prueba en el panel, usarla y revocarla.
   - Pedir un enlace de PDF y descargarlo.

**Si algo falla y hay que volver atrás: intercambiar los valores, no vaciar.**

```
API_KEY_PEPPER=<el anterior>
API_KEY_PEPPER_ANTERIOR=<el nuevo>
```

Vaciar `API_KEY_PEPPER_ANTERIOR` dejaría fuera a las keys que ya migraron: sus
hashes están calculados con el pepper nuevo, y ese valor desaparecería. Con los
valores intercambiados se aceptan las dos. Las keys vuelven a migrar solas, esta
vez hacia el anterior.

### Día 15 · Avisar a quien no ha migrado

```bash
pnpm keys:pendientes --desde 2026-09-15T14:00:00Z
```

Lista, por cliente, las keys activas que existían al rotar y no se han usado
desde entonces. Escribir a cada dueño con la plantilla de §5. Solo a ellos: al
resto la rotación no le afecta.

### Día 28 · Recordatorio

Volver a ejecutar el script y escribir **solo** a los que siguen en la lista.

### Día 30 · Cerrar

1. Ejecutar el script una última vez. Lo que salga dejará de funcionar.
2. En EasyPanel, **vaciar** `API_KEY_PEPPER_ANTERIOR` y desplegar.
3. Comprobar que `/health` responde y que una key migrada funciona.
4. **Destruir el pepper anterior** en todos los sitios donde esté: gestor de
   contraseñas, notas, copias del `.env`. Mientras exista, sigue sirviendo para
   firmar enlaces si alguien vuelve a configurarlo.

## 5. Plantilla de aviso

> **Asunto:** Acción necesaria antes del {fecha de cierre}: tu API key de Asta
>
> Hola, {nombre}:
>
> Hemos renovado una clave interna de seguridad de la API de Asta. Las
> integraciones que la usan con normalidad no tienen que hacer nada: se
> actualizan solas.
>
> Estas API keys de tu cuenta **no se han usado** desde el {fecha de rotación}
> y **dejarán de funcionar el {fecha de cierre}**:
>
> - {nombre de la key} — `{identificador}`
>
> Tienes dos opciones:
>
> 1. **Si la key sigue en uso**, basta con que tu integración haga cualquier
>    petición antes del {fecha de cierre}. Queda actualizada en ese momento.
> 2. **Si ya no la usas**, no hagas nada, o revócala en el panel, en
>    «Mis API keys».
>
> Si tras esa fecha tu integración responde `401 INVALID_API_KEY`, crea una key
> nueva en «Mis API keys» y sustitúyela.
>
> {Párrafo sobre el motivo, SOLO si lo decide quien lleve el incidente. Si la
> rotación es por una filtración, esta plantilla no dice nada sobre si hubo
> datos afectados: eso no se afirma por plantilla.}

`{identificador}` es el que devuelve el script (`asta_live_ab12cd34…WXYZ`),
el mismo que el cliente ve en el panel. **Nunca** se incluye la key completa: no
la tenemos.

## 6. Qué NO cubre

- **`JWT_SECRET`**: es otro secreto. Rotarlo cierra todas las sesiones del
  panel; no afecta a las API keys.
- **Revocar keys**: eso se hace en el panel, y no tiene nada que ver con el
  pepper.
- **Alertas**: no hay una alerta de "rotación a medio hacer". Por eso el
  procedimiento fija fechas.
