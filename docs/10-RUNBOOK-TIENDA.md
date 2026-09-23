# 10 · Cuando algo se cae y hay clientes delante

Qué ve el personal de tienda, qué le dice al cliente y a quién avisa. Issue #49.

Los runbooks de `05-RUNBOOKS.md` son para quien recibe una alerta y tiene acceso
al servidor. **Este es para el mostrador**, y por eso empieza por lo que se ve en
la tablet, no por lo que pasa por dentro.

> **Una corrección al issue.** #49 pide un runbook para «Supabase caído».
> Supabase no se usa: la base es **MySQL** desde el reconocimiento de Fase 0
> (#8). Abajo está el de MySQL, que es el equivalente real.

---

## Lo primero: mirar la esquina de la tablet

El kiosco enseña **siempre** el estado, arriba a la izquierda, también en la
pantalla de atracción. Dice lo que hay que hacer sin entrar en nada:

| Lo que se ve | Qué pasa | Quién lo arregla |
|---|---|---|
| 🟢 **En línea** | Todo normal. | — |
| 🟡 **Sin datos en vivo** | La tablet habla con nosotros, pero **el ERP (Odoo) no responde**. | Nosotros. Ver §1 |
| 🔴 **Sin conexión** | La tablet **no llega al servidor**: wifi de la tienda, o el servidor caído. | Primero la tienda. Ver §2 |

En amarillo y en rojo, **el kiosco sigue sirviendo**: enseña lo último que
consultó, con la hora («de hace 6 min») y el aviso de confirmar en el mostrador.
Lo que nunca hace es inventarse una existencia.

---

## 1. Odoo no responde (🟡 «Sin datos en vivo»)

Es el corte más probable: Odoo se cae o va lentísimo, y la tienda tiene wifi.

### Qué sigue funcionando

- **Buscar la impresora**, entera: el catálogo de modelos es de nuestra base.
- **Ver qué tóner le sirve**, si esa impresora ya se consultó en las últimas
  12 horas. Sale con la hora de cuándo se supo.
- El panel: **la cartera y las facturas NO**, que salen de Odoo en vivo.

### Qué NO funciona

- La **existencia de ahora mismo**. Ni en el kiosco, ni en `/inventory`, ni en el
  recomendador: el middleware responde `503 ODOO_UNAVAILABLE`.

### Qué se le dice al cliente

> «El tóner que le sirve es este. La existencia que tengo en pantalla es de hace
> un rato y ahora no puedo confirmarla: deje que la compruebe en el mostrador.»

**Lo que no se dice:** «está caído el sistema». El cliente no necesita saber cuál
de nuestras piezas falla, y la frase espanta.

### A quién se avisa

Al canal de guardia, con esta información —que es la que evita la primera ronda
de preguntas—:

- la hora en que se puso en amarillo;
- si el panel también falla o solo el kiosco;
- si hay más tiendas igual.

Quien reciba el aviso sigue `05-RUNBOOKS.md`, sección `odoo-lento`, y comprueba
el estado de Odoo en su panel de servicio.

### Cómo se sabe que volvió

**Sola.** La tablet comprueba cada 15 segundos y, al volver, se pone al día y el
indicador vuelve a verde; la pantalla que se esté viendo se recarga. No hay que
reiniciar nada ni salir de la app.

Para confirmarlo a mano: buscar una impresora conocida y mirar que **ya no salga
el aviso amarillo** de datos guardados.

---

## 2. La tablet no llega al servidor (🔴 «Sin conexión»)

Puede ser el wifi de la tienda o el servidor. **Se distingue en 30 segundos.**

1. Abrir cualquier web en otro dispositivo de la tienda con el mismo wifi.
   - **Tampoco carga** → es la tienda: router, corte del proveedor. Lo resuelve
     la tienda; el kiosco sigue con lo guardado mientras tanto.
   - **Carga bien** → es nuestro. Sigue al paso 2.
2. Avisar al canal de guardia diciendo **«el kiosco no llega al servidor, pero la
   tienda tiene internet»**. Eso ya descarta la mitad de las causas.

Mientras tanto, el kiosco sirve lo consultado en las últimas 12 horas.

Del otro lado salta `kiosco-mudo` en `05-RUNBOOKS.md`, que es la misma avería
vista desde el servidor. Si suena por **varios kioscos a la vez**, no es una
tablet: es la red de la tienda o el middleware.

### Cómo se sabe que volvió

Igual que arriba: el indicador vuelve a verde solo.

---

## 3. El middleware está caído (para quien tiene acceso)

Es la cara técnica del 🔴 anterior cuando la tienda sí tiene internet.

```bash
curl -i https://<dominio-del-middleware>/health
```

- **502 / no responde** → el contenedor no está arriba. Mirar los **logs del
  servicio en EasyPanel**: si falta una variable de entorno, el servidor lo dice
  y no arranca (#9); si es otra cosa, sale en la primera línea.
- **200 `"status": "ok"`** → el middleware está bien; el problema es la red de la
  tienda.
- **503 `"status": "degraded"`** → está arriba pero algo por debajo no responde.
  El cuerpo dice cuál:

  ```json
  { "status": "degraded", "checks": { "odoo": { "ok": false }, "mysql": { "ok": true } } }
  ```

  `odoo.ok: false` → §1. `mysql.ok: false` → §4.

Alerta equivalente: `middleware-caido` en `05-RUNBOOKS.md`.

**Qué NO hacer:** reinstalar, migrar o «probar cosas» en producción con clientes
delante. El kiosco aguanta con la caché; el panel puede esperar unos minutos.

---

## 4. MySQL no responde (el «Supabase caído» de #49)

Es lo más grave, porque es donde viven las cuentas, las API keys, las
compatibilidades y la bitácora.

### Qué deja de funcionar

- **Entrar al panel**: no hay sesiones ni contraseñas que comprobar.
- **La API pública entera**: cada petición verifica su API key contra MySQL.
- **El kiosco**, salvo lo guardado en la tablet.

### Qué sigue

- Odoo, que es de otra pieza: facturar en el mostrador **no depende de esto**.

### Qué se hace

1. Avisar al canal de guardia. Esto **siempre** se escala: no se arregla en
   tienda.
2. Quien tenga acceso: comprobar el servicio de MySQL en EasyPanel y el espacio
   en disco, que es la causa más habitual de que una base deje de aceptar
   escrituras.
3. **No restaurar una copia sin decirlo**: una restauración pierde lo escrito
   desde el respaldo —API keys creadas, compatibilidades validadas, bitácora—.
   La decisión no es del turno de tienda.

Mientras tanto, la tienda **vende como siempre** por Odoo.

---

## 5. Una API key se filtró

Una key da acceso a **las facturas y los datos de ese cliente**. Si aparece en un
repositorio público, en un correo reenviado o en una captura de pantalla:

1. **Revocarla ya**, desde el panel del cliente, en **Cuenta → API keys**. Pide
   escribir el nombre de la key para confirmar, a propósito: revocar corta la
   integración del cliente y no debe hacerse por un clic de más. Es inmediato: la
   siguiente petición con esa key recibe un 401.
2. **Crear otra** y dársela al cliente por un canal privado. El token se enseña
   **una sola vez**.
3. **Mirar qué se hizo con ella**: la bitácora (`api_request_logs`) guarda cada
   petición con su key, y la alerta `key-401` avisa de los intentos con keys
   revocadas. Ahí se ve si alguien la usó y desde dónde.
4. **No hace falta rotar el pepper** por esto: revocar la key la invalida.
   El pepper se rota por otras razones, en `08-ROTACION-PEPPER.md`.

Si lo filtrado es el **pepper** o el entorno del servidor, ese es otro
procedimiento, y sí es urgente: `08-ROTACION-PEPPER.md`, §2.

---

## 6. Lo que el kiosco hace solo, y conviene saber

Para no llamar a guardia por algo que ya está previsto:

- **Guarda lo que se consulta** en la propia tablet y lo enseña cuando no hay
  datos en vivo, **con la hora**. Caduca a las 12 horas: cubre una jornada.
- **Nunca enseña datos guardados como si fueran de ahora.** El aviso amarillo va
  encima, antes de la existencia.
- **No tapa un error de configuración con la caché.** Si la tablet dice «esta
  tablet no está autorizada», es su API key: eso no se arregla esperando.
- **Cierra la consulta del cliente a los 4 minutos** sin uso, avisando 30
  segundos antes, y borra lo que había en pantalla (#41).
- **Se pone al día sola** cuando vuelve el servicio.

## 7. A quién se avisa, y por dónde

| Qué pasa | Quién | Cuándo |
|---|---|---|
| 🟡 Sin datos en vivo más de 15 min | guardia | en cuanto se note |
| 🔴 Sin conexión y la tienda sí tiene internet | guardia | inmediato |
| No se puede entrar al panel | guardia | inmediato |
| Una API key filtrada | guardia **y** responsable del cliente | inmediato |

> **Pendiente, y hay que decirlo:** el canal de guardia **todavía no existe como
> tal**. Las alertas salen por la salida estándar del comprobador y, si se
> configura `ALERTAS_WEBHOOK_URL`, a ese webhook; no hay correo (#53, #16). Hasta
> que lo haya, «avisar a guardia» significa escribir al grupo del equipo. Esto es
> lo primero que hay que cerrar de este runbook.
