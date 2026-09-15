# Runbooks de operación

Qué hacer cuando salta cada alerta de `pnpm alertas` (issue #46).

Cada alerta enlaza aquí por su ancla. Si alguna vez salta una alerta cuyo enlace
no lleva a ninguna parte, **eso es un fallo que hay que arreglar**: una alerta sin
runbook se convierte en una alerta que se ignora.

```bash
pnpm alertas
```

Sale con código 1 si hay alguna crítica, 0 si solo hay avisos. Pensado para un
cron cada pocos minutos.

> **Antes de empezar con cualquiera de estos.** Lo primero es siempre lo mismo:
> `curl $MIDDLEWARE_URL/health`. Dice de un vistazo si Odoo y MySQL responden y
> cuánto tardan, y la mitad de estas alertas se explican ahí.

---

## Qué NO está cubierto todavía

Conviene saberlo antes de confiar en esta lista.

De las reglas escritas, **todas menos `kiosco-mudo` pueden dispararse con datos
reales**. `kiosco-mudo` espera a la Fase 5.

Las que miran `api_request_logs` (`key-401`, `key-429`, `tasa-5xx`,
`odoo-n-mas-uno`) funcionan desde #29, que es cuando la API pública empezó a
escribir esa tabla. Antes leían una tabla vacía: la API ya servía tráfico real
desde #64, pero recibir peticiones no llena la tabla, así que no podían saltar
nunca. Si alguna vez dejan de saltar sin motivo aparente, lo primero es
comprobar que la tabla sigue recibiendo filas:

```sql
SELECT COUNT(*), MAX(created_at) FROM api_request_logs
 WHERE created_at >= UTC_TIMESTAMP() - INTERVAL 1 HOUR;
```

> **Ojo con `NOW()` en estas consultas.** `created_at` se guarda en **UTC**, y
> `NOW()` devuelve la hora del servidor MySQL. Si el servidor no corre en UTC, una
> ventana de "1 hora" con `NOW()` abarca otra cosa — con un servidor a UTC−4, cinco
> horas. Usar siempre `UTC_TIMESTAMP()`.

Y una cosa más: **las alertas no llegan a ningún canal todavía**. Salen por la
salida estándar y por código de salida, y a un webhook si se configura
`ALERTAS_WEBHOOK_URL`. Por correo no, porque no hay SMTP (mismo bloqueo que #53 y
#16). El criterio de aceptación del issue —"un canal que alguien lee"— no está
cumplido hasta que se configure uno.

El comprobador se ejecuta así, y **desde #46 entra en la imagen**, así que
funciona igual en desarrollo y en el contenedor:

```bash
pnpm alertas                     # en desarrollo
node dist/cli/alertas.js         # en el contenedor
```

Vivía en `scripts/`, fuera de `apps/middleware/src`, y esa carpeta NO se copia a
la imagen: en producción el comando no existía. Mismo tropiezo que el CLI de
contraseñas (#74) y el de sync (#80).

Códigos de salida, pensados para un cron: **1** si hay alguna crítica, **0** en
los demás casos. Un aviso no hace fallar el trabajo a propósito — un cron que
manda correo por cada aviso acaba en la papelera, y entonces el día de la crítica
tampoco lo lee nadie.

Y una advertencia que el propio comando ya da: si alguna regla **no se pudo
evaluar**, no dice "sin alertas" en verde. Con MySQL inalcanzable fallan las siete
reglas de base, y un verde ahí se leería como que todo va bien.

---

## `middleware-caido`

**El middleware no responde.**

El panel está caído para todo el mundo. Es la alerta más grave de la lista.

El detalle trae la causa entre paréntesis, y cada una apunta a un sitio distinto:

| causa | qué significa |
|---|---|
| `ECONNREFUSED` | El proceso no está. Se cayó o no arrancó. |
| `ETIMEDOUT` / `TimeoutError` | El proceso está, pero no contesta. Colgado, o la red no llega. |
| `ENOTFOUND` | `MIDDLEWARE_URL` apunta a un nombre que no existe. Suele ser un cambio de configuración. |

1. Mirar el log del proceso. Si murió al arrancar, lo más probable es el
   entorno: `pnpm check:env` dice qué variable falta, con nombre y todo (#9).
2. Si arrancó y luego murió, buscar en el log el último error antes del corte.
3. Si está colgado y no caído, mirar si Odoo responde: un Odoo que acepta la
   conexión y no contesta puede dejar peticiones esperando. El cliente tiene
   timeout propio (`ODOO_TIMEOUT_MS`), así que esto no debería pasar — si pasa,
   es un caso nuevo y conviene anotarlo.

---

## `middleware-degradado`

**El middleware responde, pero alguna dependencia está caída.**

`/health` devolvió `503`. El detalle dice cuál falló.

- **MySQL caída** — no se puede ni entrar al panel: las sesiones viven ahí. Los
  datos de facturación de Odoo no están afectados, pero nadie puede verlos.
- **Odoo caído** — se puede entrar, y no hay nada que mirar: la facturación y la
  cartera se leen en vivo del ERP. Ver también el runbook de @LinoGouveia sobre
  Odoo caído con el kiosco encendido (#49).

No hace falta reiniciar el middleware por esto: reconecta solo cuando la
dependencia vuelve. Comprobado con MySQL — se paró, `/health` pasó a `503`, se
levantó y volvió a `200` sin tocar el servidor.

---

## `sync-atrasado`

**La sincronización de clientes lleva demasiado sin correr.**

Los clientes dados de alta en Odoo desde la última pasada **no pueden entrar al
panel**: no tienen fila en `app_users`. Para ellos el sistema parece roto.

No es urgente a las tres de la mañana. Sí lo es antes de que abran las tiendas.

1. ¿Está programado el job? `pnpm sync:partners` es lo que debería correr por
   cron.
2. Correrlo a mano y mirar la salida. Si falla, el error suele ser de Odoo
   (credenciales, la API key rotada) o de MySQL.
3. Si termina bien, el problema es el cron, no el código.

```sql
SELECT * FROM sync_state WHERE entidad = 'res.partner';
```

`ultima_ejecucion` dice cuándo terminó la última pasada completa;
`ultimo_write_date` es la marca de agua en el reloj **de Odoo**.

---

## `sync-colgado`

**El cerrojo de la sincronización lleva demasiado tiempo puesto.**

`ejecutando = 1` desde hace más de lo razonable. Mientras siga así, **ninguna
pasada nueva puede arrancar**: el cerrojo existe justo para que dos no se
solapen.

Casi siempre es una pasada que murió a media ejecución —el proceso se mató, el
contenedor se reinició— y dejó el cerrojo puesto.

1. Comprobar que de verdad no hay ninguna corriendo. Si la hay, **esperar**:
   soltar el cerrojo con una pasada viva es pedir dos escribiendo a la vez.
2. Si no hay ninguna:

```sql
UPDATE sync_state SET ejecutando = 0, ejecutando_desde = NULL
 WHERE entidad = 'res.partner';
```

3. Volver a lanzar la sincronización y mirar que termine.

No hace falta tocar `ultimo_write_date`: la marca de agua lleva un margen de
seguridad de 60 s y el orden es ascendente, así que repetir un tramo es inocuo.

---

## `sync-nunca`

**La sincronización no ha terminado ninguna pasada.**

En un despliegue nuevo es lo esperado hasta que corre la primera vez. Si sale en
un sistema que llevaba funcionando, es que alguien vació `sync_state`, y entonces
la siguiente pasada va a releer el histórico entero de Odoo. Tarda, pero no rompe
nada.

---

## `accesos-cruzados`

**Varios intentos de acceso a clientes que no son de quien los pide.**

La más importante de todas, y conviene explicar por qué.

El esquema original vivía en PostgreSQL con Row Level Security: aunque el
middleware tuviera un fallo de scoping, la base se negaba a devolver filas de otro
cliente. **MySQL no tiene RLS y no hay equivalente** (#44). Hoy el aislamiento
entre carteras depende ÚNICAMENTE del `where` que arma el middleware.

Un intento suelto es ruido normal: un enlace viejo en un correo, una cartera que
cambió de manos. **Varios seguidos son una de dos cosas, y las dos hay que
mirarlas ahora**:

1. **Un fallo de scoping.** Algún endpoint nuevo se saltó `autorizar()`. Sería
   una fuga de datos entre clientes. Correr `pnpm test:isolation` — son 36 tests
   contra el Odoo real, incluidas tres propiedades sobre pares al azar.
2. **Alguien probando.** El detalle de la alerta dice quién lo intenta y cuántos
   clientes distintos tocó. Muchos clientes distintos desde un mismo actor no es
   un enlace viejo.

```sql
SELECT actor_email, target_id, ip, created_at
  FROM audit_logs
 WHERE action = 'access.denied.partner'
   AND created_at >= NOW() - INTERVAL 1 HOUR
 ORDER BY created_at DESC;
```

Que los intentos queden registrados **y no se puedan borrar desde la aplicación**
es deliberado: `asta_app` solo tiene `SELECT` e `INSERT` sobre `audit_logs`
(#44).

> Un falso positivo conocido: correr la batería de aislamiento genera decenas de
> estos eventos a propósito. Si la alerta salta justo después de que alguien
> ejecutara los tests contra esta base, es eso.

---

## `odoo-lento`

**El p95 de Odoo está por encima del umbral.**

No está caído: está tardando. Lo nota el vendedor antes que ningún monitor,
porque la cartera y la ficha se leen en vivo del ERP.

El p95 sale de las últimas 500 llamadas de **tráfico real**. La sonda de
`/health` no cuenta: es una llamada trivial y, consultada cada pocos segundos,
desplazaría al tráfico de verdad y dejaría el p95 en una cifra bonita que no
describe nada.

1. Ver el desglose en `/health` → `dependencias.odoo.latencia`. Si `p50` está
   bien y `p95` disparado, son unas pocas llamadas pesadas, no Odoo entero.
2. Encontrar cuáles. Con `LOG_LEVEL=info` ya salen en `warn` las que pasan de
   `ODOO_SLOW_RPC_MS`:

```bash
grep '"rpc":true' log | grep '"lenta":true'
```

3. Sospechosos habituales: un `read_group` sobre un rango de fechas muy grande, o
   un N+1 (ver `odoo-n-mas-uno`).
4. Si todas las llamadas están lentas por igual, el problema es de Odoo o de la
   red, no del código.

---

## `odoo-n-mas-uno`

**Peticiones que hacen demasiadas llamadas a Odoo.**

La firma de un N+1 contra el ERP: una petición que consulta cliente por cliente
en vez de en lote.

No rompe nada — por eso no aparece en ninguna otra alerta — pero multiplica la
latencia y el consumo de la cuota de Odoo, y **crece con el número de clientes**
hasta que un día deja de caber.

La referencia de cómo debe hacerse está en `/salesperson/portfolio`: resuelve 792
clientes con **2 RPC en total**, no con 2 por cliente, agrupando con
`commercial_partner_id in [...]`. Si un endpoint nuevo no puede hacer eso, hay
que justificar por qué.

---

## `tasa-5xx`

**Demasiados errores del servidor en la API pública.**

Esto es culpa nuestra, no del cliente: un 5xx es el middleware fallando.

1. Mirar el log filtrando por 5xx y buscar el patrón: ¿un endpoint concreto? ¿un
   cliente concreto? ¿empezó a una hora exacta?
2. Si empezó de golpe, cruzarlo con el último despliegue.
3. Si viene acompañado de `odoo-lento` o `middleware-degradado`, el 5xx es el
   síntoma y la otra alerta es la causa. Atender esa primero.

Se exige un mínimo de 20 peticiones en la ventana antes de calcular la tasa: con
poco tráfico, un solo error dispara cualquier porcentaje.

**Los 501 no cuentan.** Son la respuesta deliberada de los endpoints que todavía no
existen (`/inventory`, `/pricing`, `/recommender`), no un fallo. Antes contaban, y
diez llamadas de un cliente a `/inventory` entre treinta peticiones sanas daban
esta alerta al 25 % con cero errores reales.

---

## `key-401`

**Una API key está acumulando rechazos.**

Dos lecturas posibles, y **no conviene elegir una antes de mirar**:

1. **La integración del cliente se rompió.** Rotaron algo por su lado y no
   avisaron. Es lo más común. Se arregla hablando con el cliente.
2. **La key se filtró y alguien la está probando.** Menos común y más grave.

Cómo distinguirlas: mirar desde **qué IP** llegan los rechazos.

```sql
SELECT ip, error_code, COUNT(*) n, MIN(created_at), MAX(created_at)
  FROM api_request_logs
 WHERE api_key_id = '...' AND status_code = 401
   AND created_at >= UTC_TIMESTAMP() - INTERVAL 1 HOUR
 GROUP BY ip, error_code ORDER BY n DESC;
```

*(Esta consulta usaba `NOW()`, que con un servidor MySQL fuera de UTC mira una
ventana distinta. Ver "Qué NO está cubierto todavía".)*

Una sola IP conocida, de la que ya venía tráfico legítimo → integración rota.
Varias IPs, o una que no había aparecido nunca → revocar la key **antes** de
llamar a nadie. Revocar es un `UPDATE`, no un borrado, así que queda registro.

**Qué rechazos se atribuyen a una key.** Solo los de keys cuyo **prefijo existe**:
revocadas, caducadas, de un usuario dado de baja, fuera de su lista de IPs, o con
el prefijo correcto y el **secreto equivocado**. Este último caso es el que
importa para la segunda lectura: alguien conoce el prefijo de la key y está
probando secretos. Una key totalmente inventada no pertenece a nadie y se registra
sin `api_key_id`; esa la frena el límite por IP de #29, no esta alerta.

---

## `key-429`

**Una API key satura su límite de forma sostenida.**

Salta cuando una misma key recibe algún 429 en al menos `ALERTA_KEY_429_MINUTOS`
minutos distintos de la ventana. No cuenta rechazos, cuenta **minutos**: una
ráfaga de cientos de 429 en un solo minuto —un reintento en bucle— ya la contuvo
el limitador y no hay nada que decidir. Una key que roza su límite minuto tras
minuto es otra cosa.

**No es una caída.** Cuando salta, el limitador ya está protegiendo a Odoo. Por eso
es un aviso y no una alerta crítica. Es una conversación pendiente.

Tres lecturas:

1. **La integración creció y ya no cabe en su límite.** Tráfico legítimo, desde
   las IPs de siempre. Se decide con el cliente y, si procede, se sube:

   ```sql
   UPDATE api_keys SET rate_limit_per_minute = 120 WHERE id = '...';
   ```

   Tiene efecto en la siguiente petición, sin reiniciar nada.

2. **La integración está mal escrita**: consulta en bucle lo que podría cachear,
   o ignora el `Retry-After` y reintenta sin esperar. Subir el límite solo
   empeoraría la carga sobre Odoo. Hay que hablar con quien la mantiene.

3. **La key se filtró y alguien la está exprimiendo.** Tráfico desde IPs nuevas.
   Revocar primero y hablar después.

Cómo distinguirlas:

```sql
SELECT ip, path, COUNT(*) n, SUM(status_code = 429) rechazos
  FROM api_request_logs
 WHERE api_key_id = '...'
   AND created_at >= UTC_TIMESTAMP() - INTERVAL 1 HOUR
 GROUP BY ip, path ORDER BY n DESC;
```

Las IPs de siempre y el mismo `path` una y otra vez apuntan a la 1 o a la 2. Una
IP que no había aparecido nunca, a la 3.

---

## `kiosco-mudo`

**Un kiosco lleva rato sin dar señales en horario laboral.**

Fuera de horario el silencio es lo normal y la alerta no salta: avisar con la
tienda cerrada entrena a la gente a ignorarla. La franja y la zona horaria se
configuran con `ALERTA_KIOSCO_ABRE`, `ALERTA_KIOSCO_CIERRA` y
`ALERTA_KIOSCO_TZ` (por defecto `America/Caracas`).

Casi siempre es la tablet: sin red, apagada, o la aplicación cerrada. Alguien de
la tienda tiene que mirarla físicamente.

Si son **varios kioscos a la vez**, no es la tablet: o es la red de la tienda o
es el middleware. Comprobar `/health` antes de mandar a nadie.

---

## Umbrales

Todos se ajustan por entorno. Los valores por defecto **me los inventé con
criterio pero sin datos de producción detrás**, y conviene revisarlos cuando haya
un mes de tráfico real.

| Variable | Por defecto | Qué controla |
|---|---|---|
| `ALERTA_VENTANA_MIN` | 15 | Ventana de las reglas por tasa |
| `ALERTA_SYNC_HORAS` | 6 | Horas sin sincronizar antes de avisar |
| `ALERTA_SYNC_COLGADO_MIN` | 30 | Minutos con el cerrojo puesto |
| `ALERTA_ACCESOS_CRUZADOS` | 5 | Intentos en la ventana |
| `ALERTA_ODOO_P95_MS` | 3000 | p95 de Odoo |
| `ALERTA_TASA_5XX` | 5 | Porcentaje de 5xx |
| `ALERTA_KEY_401` | 10 | Rechazos de una misma key |
| `ALERTA_KEY_429_MINUTOS` | 5 | Minutos distintos con 429 de una misma key |
| `ALERTA_ODOO_CALLS` | 5 | RPC por petición |
| `ALERTA_KIOSCO_MIN` | 30 | Minutos sin señal de un kiosco |

Una alerta mal calibrada se silencia, y **una alerta silenciada es peor que
ninguna**: da sensación de cobertura donde no la hay.
