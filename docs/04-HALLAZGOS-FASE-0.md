# Hallazgos de Fase 0 — reconocimiento de Odoo

**Fecha:** 2026-09-11
**Instancia:** `supricom2.odoo.com` · db `supricom-prod1-25424683` · **Odoo 17.0+e**
**Usuario:** `webmaster02@supricom.com.ve` (uid 388, no es admin)
**Snapshot crudo:** se genera con `pnpm probe`; NO está en el repositorio.
Contiene el correo y el uid del usuario de servicio, nombres de clientes y
precios reales, así que se quedó fuera del control de versiones.

---

## Resumen ejecutivo

De los cinco supuestos que la arquitectura daba por ciertos, **tres son falsos y
uno funciona distinto de lo previsto.** No es un problema de configuración: son
piezas del modelo de datos que todavía no existen en Odoo.

| # | Supuesto | Realidad | Impacto |
|---|---|---|---|
| #3 | `x_client_tier` clasifica al cliente | **No existe.** `res.partner` no tiene ni un campo `x_*` | El modelo Bronce/Plata/Gold hay que crearlo |
| #5 | Tres tarifas, una por nivel | **El mecanismo funciona**, pero los 2944 clientes usan la misma tarifa | Falta ASIGNAR tarifas, no arreglarlas |
| — | Precio vía `context: {pricelist}` | **Odoo 17 eliminó esa vía.** Hay que leer `product.pricelist.item` | Cambia el diseño del endpoint de precios |
| #4 | `asta.printer.model` existe | **No existe.** Solo `pos.printer` (hardware de punto de venta) | El recomendador es un módulo a desarrollar |
| #7 | Medir cobertura tóner↔impresora | **0% — el campo no existe** | La Fase 5 se pospone |
| #6 | Volumen razonable | Confirmado y manejable | Redis recomendado |

**Lo importante:** esto no invalida la arquitectura. El middleware, el módulo de
vendedores y la API pública siguen en pie tal como están diseñados. Lo que cambia
es que **el recomendador y el modelo de niveles dejan de ser "integración" y pasan
a ser "desarrollo en Odoo"**, y eso hay que meterlo en el plan antes de prometer
fechas.

---

## #3 · El modelo de niveles no existe

`res.partner` tiene 270 campos y **ninguno empieza por `x_`**. No hay
`x_client_tier` ni nada equivalente.

Lo más cercano son los tags (`res.partner.category`), pero son etiquetas
organizativas, no niveles comerciales:

```
[5]  Cliente        [1]  Proveedor      [12] Instalador     [13] Vendedor
[2]  OSC            [4]  Supricom Caracas               [3] Supricom Panama
[6]  DUPLICADO      [11] Revisar
```

No hay rastro de Bronce, Plata ni Gold en ninguna parte de la instancia.

### Qué hacer

**Recomendación: no crear `x_client_tier`.** Odoo ya tiene el mecanismo nativo para
esto — `res.partner.property_product_pricelist`, que es exactamente "qué tarifa le
corresponde a este cliente". Duplicar esa información en un campo de texto paralelo
crea dos fuentes de verdad que se desincronizan.

La propuesta:

1. Crear **tres tarifas** reales (Bronce, Plata, Gold) con sus reglas de precio.
2. Asignar a cada cliente su `property_product_pricelist`.
3. El "tier" del middleware se **deriva** de la tarifa asignada, con una tabla de
   mapeo `pricelistId -> AppRole` en Postgres (no en Odoo).

Ventaja: el área comercial mueve a un cliente de nivel cambiando su tarifa en la
ficha, que es donde ya lo haría de forma natural. Sin campos custom, sin
sincronización doble.

Si aun así se quiere un campo explícito para reportes, que sea un `many2one` a un
modelo `asta.client.tier` que **lleve la tarifa asociada**, para que la relación
nivel→precio siga siendo un dato único.

---

## #5 · Las tarifas existen, la diferenciación no

18 tarifas tienen reglas cargadas. Las más pobladas:

```
  3670 reglas -> [15866] Lista de Precios (USD)          <- la que usan TODOS
  3586 reglas -> [15863] Lista de Precios O (USD)
  3388 reglas -> [15836] Supricom S.A - Lista USD
  3353 reglas -> [15862] Lista de Precios P (USD)
  3276 reglas -> [1]     Lista de precios VEF predeterminada (VEF)
  ...
```

Pero al leer la tarifa asignada cliente por cliente:

```
  2942 clientes -> [15866] Lista de Precios (USD)
  TOTAL leidos: 2942
```

**Los 2944 clientes apuntan a la misma tarifa.**

### CORRECCIÓN (Lino, rama `arreglar-probe-precios`)

La primera versión de este apartado se basaba en comparar **un solo producto**,
que resultó no tener regla en ninguna tarifa. De ahí salió un aviso —"verificar
las reglas de tarifa"— que insinuaba que el mecanismo estaba roto. **No lo
está.**

Midiendo sobre el catálogo entero, y excluyendo las tarifas archivadas:

```
6 tarifas ARCHIVADAS acumulan 16.546 reglas — el 47,3% del total
   (ruido que la medición anterior contaba como si estuviera vigente)

3262 productos presentes en las 3 tarifas más pobladas
 510 de 513 comparables dan precios DISTINTOS entre tarifas
```

Es decir: **las tarifas están bien cargadas y diferencian precios de verdad.**
Lo que no existe es la asignación: los 2944 clientes apuntan al mismo sitio.

La distinción importa para el plan. "Arreglar las tarifas" sería un trabajo de
datos largo; **asignarlas** es una decisión comercial y una actualización masiva
de `property_product_pricelist`. Es mucho menos trabajo del que parecía.

### Sigue siendo una decisión de negocio

Alguien tiene que responder qué tarifa le toca a cada cliente. Sin eso, el
endpoint de precios devuelve el mismo número a todo el mundo y la funcionalidad
no existe aunque el código esté perfecto.

Pero la pregunta ha cambiado a mejor: ya no es "¿cuánto descuento lleva cada
nivel y hay que cargar miles de reglas?", sino "¿cuál de las tarifas que YA
existen le corresponde a cada cliente?".

---

## Cómo se leen los precios en Odoo 17 (corrige la arquitectura)

La arquitectura asumía `context: { pricelist: N }`. **Eso ya no funciona.** Probado
contra la instancia:

| Vía | Resultado |
|---|---|
| `product.product.read(['price'], context={pricelist})` | `ValueError: Invalid field 'price'` — el campo se eliminó en Odoo 17 |
| `read(['lst_price'], context={pricelist})` | Devuelve el precio base, **ignora la tarifa** |
| `product.pricelist.price_get(...)` | `The method does not exist` (eliminado en 15+) |
| `product.pricelist.get_products_price(...)` | `The method does not exist` |
| `product.pricelist._get_product_price(...)` | `Private methods cannot be called remotely` |
| **`product.pricelist.item.search_read(...)`** | **Funciona** |

### La vía correcta para este proyecto

Leer las reglas directamente:

```js
searchRead('product.pricelist.item',
  [['pricelist_id', '=', pricelistId], ['product_tmpl_id', 'in', templateIds]],
  ['product_tmpl_id', 'compute_price', 'fixed_price', 'percent_price', 'base',
   'min_quantity', 'date_start', 'date_end'])
```

Es viable porque en esta instancia **34.999 de 35.000 reglas son `compute_price =
'fixed'`** (hay exactamente una `formula`). El precio sale directo de `fixed_price`.

Consideraciones al implementarlo:

- Respetar `min_quantity`, `date_start` y `date_end`: una regla puede estar vencida.
- Un producto puede tener varias reglas en la misma tarifa; gana la más específica.
- La única regla `formula` hay que tratarla aparte o ignorarla conscientemente.
- **Ventaja inesperada:** se puede pedir el precio de 100 SKUs en un solo RPC, que
  es justo lo que el endpoint `/pricing` en lote necesita.

### Dato adicional: el precio no vive en el producto

De 3748 productos vendibles, **solo 2 tienen `list_price > 1`**. El campo
`list_price` está prácticamente sin usar. Todo el precio real vive en las reglas de
tarifa. Hay además una docena de campos de precio personalizados
(`list_price_usd`, `list_price_vat_usd`, `company_sale_price_usd`,
`costo_reposicion_usd`, `min_price`...) que sugieren customización previa alrededor
del precio — conviene entender cuáles están vivos antes de tocar nada.

---

## #4 · El recomendador no tiene sobre qué construirse

- `asta.printer.model` **no existe**. Lo único con "printer" en el nombre es
  `pos.printer`, que es el driver de la impresora de tickets del punto de venta.
- `printer_compatibilities_ids` **no existe** ni en `product.template` ni en
  `product.product`.

Lo que **sí** hay, y sirve de cimiento:

- **`spiff.brand`** — 109 marcas, e incluye las relevantes: `BROTHER`, `CANON`,
  `EPSON`, `HP`, `SAMSUNG`, `XEROX`. Está enlazado desde `product.product.x_studio_marca`.
- **536 templates** con "toner" en el nombre.
- Categoría **[2614] CONSUMIBLES**.

O sea: hay catálogo de tóner y hay marcas, pero **no hay ninguna relación
impresora↔tóner registrada**. Ni una sola.

---

## #7 · Veredicto sobre la Fase 5

**Cobertura: 0%.** No por data incompleta, sino porque el modelo de datos no existe.

Según el umbral que fijamos en el propio issue #7 (`< 60% → la Fase 5 se pospone`),
el veredicto es **posponer**. Pero conviene ser preciso sobre qué significa aquí:

No es "hay que completar unos datos". Es **un proyecto en sí mismo**, con tres
partes:

1. **Desarrollo en Odoo** (~1 semana): módulo `asta.printer.model` con `name`,
   `brand_id`, `aliases`, `active`, más el many2many
   `printer_compatibilities_ids` en `product.template`.
2. **Carga de datos** (el trabajo real, semanas): mapear qué tóner sirve para qué
   impresora, para cientos de modelos. Se puede acelerar mucho partiendo de las
   tablas de compatibilidad que publican los propios fabricantes, pero hay que
   validarlas contra el catálogo de ASTA.
3. **Recién entonces** la Fase 5 tal como está planeada.

### Recomendación

Sacar la Fase 5 del camino crítico y abrirla como epic aparte. Lo que sigue en pie
sin tocar nada:

- **Fase 1** (cimientos) — no dependía de esto
- **Fase 2** (identidad) — no dependía de esto
- **Fase 3** (vendedores) — **completamente viable hoy**, usa solo modelos estándar
- **Fase 4** (API pública) — viable, salvo que `/pricing` devolverá el mismo precio
  a todos hasta que se resuelva la política comercial de #5

---

## #6 · Volumen y latencia

```
res.partner activos          9.175
clientes (customer_rank>0)   2.942
productos vendibles          3.748
facturas último año         14.879
facturas históricas         15.162
clientes con facturas        2.251
```

Peor caso del endpoint de facturación: **BUSINESS SUPPLIERS S A, 181 facturas**.
Es un caso cómodo para `read_group` — la agregación vuelve en una fila.

Casi toda la facturación histórica (14.879 de 15.162) es del último año, lo que
sugiere una migración reciente. Conviene confirmarlo: si hay histórico anterior sin
migrar, el "total facturado" del panel no reflejará la relación completa con el
cliente, y algún vendedor lo va a notar.

**Latencia:** p50 200 ms · p95 210 ms · min 99 ms. Muy consistente, sin picos.
Aceptable, pero 200 ms por RPC significa que el cache de la Fase 4 aporta valor
real desde el primer día.

**Redis:** recomendado. Con 2942 clientes y 3748 productos, el cache de catálogo y
precios justifica la infraestructura. Ver el issue #14.

---

## #1 · Usuario de servicio

`webmaster02@supricom.com.ve` → **uid 388**. No es admin (uid 1), que era el riesgo
principal. Pendiente de revisar si sus permisos están acotados a lectura sobre los
modelos necesarios o si tiene más de lo que el middleware requiere.

**Nota de seguridad:** la API key de este usuario se compartió por un canal de
chat. Conviene rotarla (Preferencias › Seguridad de la cuenta › Claves de API) una
vez terminado el reconocimiento.
