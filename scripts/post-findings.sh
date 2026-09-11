#!/usr/bin/env bash
#
# Publica los hallazgos del odoo-probe como comentarios en los issues de Fase 0.
#
#   Uso:  bash scripts/post-findings.sh owner/repo
#
# No cierra ningun issue: los hallazgos abren decisiones que tiene que tomar
# una persona, no un script.

set -euo pipefail
REPO="${1:?Uso: bash scripts/post-findings.sh owner/repo}"
DOC="docs/04-HALLAZGOS-FASE-0.md"

comment() {
  local n="$1"
  gh issue comment "$n" --repo "$REPO" --body-file - >/dev/null
  echo "    · comentado #$n"
}

label() {
  gh issue edit "$1" --repo "$REPO" --add-label "$2" >/dev/null || true
}

echo "==> Publicando hallazgos en $REPO"

comment 1 <<'BODY'
## Resultado del reconocimiento

`webmaster02@supricom.com.ve` autentica correctamente contra
`supricom-prod1-25424683` y devuelve **uid 388**.

**No es admin (uid 1)**, que era el riesgo principal de este issue.

Pendiente antes de cerrar:

- [ ] Revisar que sus permisos esten acotados a lectura sobre `res.partner`,
      `product.*`, `account.move` y no tenga mas de lo necesario
- [ ] **Rotar la API key.** Se compartio por un canal de chat durante el
      arranque, asi que conviene emitir una nueva
      (Preferencias > Seguridad de la cuenta > Claves de API)

Detalle completo en `docs/04-HALLAZGOS-FASE-0.md`.
BODY

comment 2 <<'BODY'
## Hecho

`scripts/odoo-probe.ts` corrido contra produccion. Resultado: **3 bloqueos, 1
aviso, 6 comprobaciones**.

- Instancia: **Odoo 17.0+e**
- Snapshot del esquema: `docs/odoo-schema-snapshot.json` (8 modelos, 2033 campos)
- Informe interpretado: `docs/04-HALLAZGOS-FASE-0.md`

El script es de solo lectura y re-ejecutable (`pnpm probe`). Conviene volver a
correrlo despues de cada cambio en Odoo para diffear el snapshot.

Los hallazgos estan comentados en los issues #3, #4, #5, #6 y #7.
BODY

comment 3 <<'BODY'
## Resultado: `x_client_tier` NO existe

`res.partner` tiene 270 campos y **ninguno empieza por `x_`**.

Lo mas cercano son los tags (`res.partner.category`), pero son etiquetas
organizativas, no niveles comerciales:

```
[5]  Cliente     [1]  Proveedor         [12] Instalador   [13] Vendedor
[2]  OSC         [4]  Supricom Caracas  [3]  Supricom Panama
[6]  DUPLICADO   [11] Revisar
```

No hay rastro de Bronce, Plata ni Gold en la instancia.

## Recomendacion: NO crear `x_client_tier`

Odoo ya tiene el mecanismo nativo — `res.partner.property_product_pricelist`, que
es literalmente "que tarifa le corresponde a este cliente". Un campo de texto
paralelo crearia dos fuentes de verdad que se desincronizan.

Propuesta:

1. Crear tres tarifas reales (Bronce, Plata, Gold) con sus reglas
2. Asignar a cada cliente su `property_product_pricelist`
3. El tier del middleware se **deriva** de la tarifa, con un mapeo
   `pricelistId -> AppRole` en Postgres

Asi el area comercial mueve a un cliente de nivel cambiando su tarifa en la ficha,
que es donde lo haria de forma natural. Sin campos custom ni sincronizacion doble.

**Ojo tecnico:** `property_product_pricelist` es un campo `property` (vive en
`ir.property`), asi que **no se puede agrupar en SQL** — `read_group` sobre el
falla con `Cannot convert field to SQL`. Hay que leerlo por registro.

Detalle en `docs/04-HALLAZGOS-FASE-0.md`.
BODY

comment 4 <<'BODY'
## Resultado: NO existe

- **`asta.printer.model` no existe.** Lo unico con "printer" en el nombre es
  `pos.printer`, que es el driver de la impresora de tickets del punto de venta.
- **`printer_compatibilities_ids` no existe** ni en `product.template` ni en
  `product.product`.

## Lo que SI hay, y sirve de cimiento

- **`spiff.brand`** — 109 marcas, incluidas las relevantes: `BROTHER`, `CANON`,
  `EPSON`, `HP`, `SAMSUNG`, `XEROX`. Enlazado desde `product.product.x_studio_marca`
- **536 templates** con "toner" en el nombre
- Categoria **[2614] CONSUMIBLES**

Hay catalogo de toner y hay marcas, pero **no hay ni una sola relacion
impresora<->toner registrada**.

## Consecuencia

Tal como advertia este issue: deja de ser configuracion y pasa a ser **un modulo
de Odoo a desarrollar**. Ver #7 para el veredicto sobre la Fase 5.
BODY

comment 5 <<'BODY'
## Resultado: el mecanismo existe, la diferenciacion no

**18 tarifas** tienen reglas cargadas (35.000 reglas en total). Las mayores:

```
  3670 reglas -> [15866] Lista de Precios (USD)       <- la que usan TODOS
  3586 reglas -> [15863] Lista de Precios O (USD)
  3388 reglas -> [15836] Supricom S.A - Lista USD
  3276 reglas -> [1]     Lista de precios VEF predeterminada (VEF)
```

Pero al leer la tarifa asignada cliente por cliente:

```
  2942 clientes -> [15866] Lista de Precios (USD)
  TOTAL leidos: 2942
```

**Los 2942 clientes apuntan a la misma tarifa.** Y el mismo producto en distintas
tarifas da el mismo precio:

```
Template 112083 · ACER NITRO LITE CI513420
   [15866] Lista de Precios (USD)     fixed  775.3
   [15863] Lista de Precios O (USD)   fixed  775.3
   -> 2 tarifas, 1 precio distinto
```

La diferenciacion de precios por nivel esta al **0%**.

## Esto es una decision de negocio, no tecnica

Alguien tiene que responder: cuanto descuento lleva Plata sobre Bronce? y Gold?
Es un porcentaje global o por familia de producto? Sin esa respuesta, el endpoint
de precios devuelve el mismo numero a todo el mundo aunque el codigo este perfecto.

## CORRECCION TECNICA: `context: {pricelist}` no funciona en Odoo 17

La arquitectura asumia leer precios con `context: { pricelist: N }`. Probado contra
la instancia, **no funciona**:

| Via | Resultado |
|---|---|
| `read(['price'], context={pricelist})` | `ValueError: Invalid field 'price'` — eliminado en Odoo 17 |
| `read(['lst_price'], context={pricelist})` | Devuelve el precio base, **ignora la tarifa** |
| `product.pricelist.price_get(...)` | `The method does not exist` |
| `product.pricelist.get_products_price(...)` | `The method does not exist` |
| `product.pricelist._get_product_price(...)` | `Private methods cannot be called remotely` |
| **`product.pricelist.item.search_read(...)`** | **Funciona** |

La via correcta es leer las reglas directamente:

```js
searchRead('product.pricelist.item',
  [['pricelist_id','=',pricelistId], ['product_tmpl_id','in',templateIds]],
  ['product_tmpl_id','compute_price','fixed_price','percent_price','base',
   'min_quantity','date_start','date_end'])
```

Viable porque **34.999 de 35.000 reglas son `compute_price = 'fixed'`** (hay
exactamente una `formula`). Ventaja inesperada: permite pedir el precio de 100 SKUs
en un solo RPC, justo lo que necesita el endpoint `/pricing` en lote (#31).

Al implementarlo hay que respetar `min_quantity`, `date_start` y `date_end`, y
resolver el caso de varias reglas para el mismo producto.

**Dato adicional:** de 3748 productos vendibles, solo 2 tienen `list_price > 1`.
El precio real vive enteramente en las reglas de tarifa, no en el producto.
BODY

comment 6 <<'BODY'
## Resultado

```
res.partner activos          9.175
clientes (customer_rank>0)   2.942
productos vendibles          3.748
facturas ultimo ano         14.879
facturas historicas         15.162
clientes con facturas        2.251
```

**Peor caso del endpoint de facturacion:** BUSINESS SUPPLIERS S A, **181 facturas**.
Caso comodo para `read_group` — la agregacion vuelve en una fila.

**Latencia de Odoo:** p50 200 ms · p95 210 ms · min 99 ms · max 210 ms.
Muy consistente, sin picos. Aceptable, pero 200 ms por RPC significa que el cache
de la Fase 4 aporta valor real desde el dia 1.

**Redis: recomendado.** Con 2942 clientes y 3748 productos, el cache de catalogo y
precios justifica la infraestructura. Insumo para #14.

## A confirmar

Casi toda la facturacion historica (14.879 de 15.162) es del ultimo ano, lo que
sugiere una migracion reciente. Conviene verificarlo: si hay historico anterior sin
migrar, el "total facturado" del panel no reflejara la relacion completa con el
cliente, y algun vendedor lo va a notar.
BODY

comment 7 <<'BODY'
## Veredicto: cobertura 0% — LA FASE 5 SE POSPONE

No por data incompleta, sino porque **el modelo de datos no existe** (ver #4).

Segun el umbral fijado en este mismo issue (`< 60% -> la Fase 5 se pospone`), el
veredicto es posponer. Pero conviene ser preciso sobre que significa aqui.

No es "hay que completar unos datos". Es **un proyecto en si mismo**, con tres
partes:

1. **Desarrollo en Odoo** (~1 semana): modulo `asta.printer.model` con `name`,
   `brand_id`, `aliases`, `active`, mas el many2many `printer_compatibilities_ids`
   en `product.template`.
2. **Carga de datos** (el trabajo real, semanas): mapear que toner sirve para que
   impresora, para cientos de modelos. Se puede acelerar partiendo de las tablas de
   compatibilidad que publican los fabricantes, pero hay que validarlas contra el
   catalogo de ASTA.
3. **Recien entonces** la Fase 5 tal como esta planeada.

## Punto de partida disponible

- `spiff.brand` ya tiene BROTHER, CANON, EPSON, HP, SAMSUNG, XEROX
- 536 templates con "toner" en el nombre
- Categoria [2614] CONSUMIBLES

## Recomendacion

Sacar la Fase 5 del camino critico y abrirla como epic aparte.

**Lo que sigue en pie sin tocar nada:**

- Fase 1 (cimientos) — no dependia de esto
- Fase 2 (identidad) — no dependia de esto
- Fase 3 (vendedores) — **completamente viable hoy**, usa solo modelos estandar
- Fase 4 (API publica) — viable, salvo que `/pricing` devolvera el mismo precio a
  todos hasta que se resuelva la politica comercial de #5

Esto se sabe en la semana 1, que es exactamente para lo que este issue estaba en
Fase 0 y no en Fase 5.
BODY

echo ""
echo "==> Etiquetando..."
for n in 3 4 5 7; do label "$n" "riesgo"; done
label 5 "tipo:decision"
echo "    · #3 #4 #5 #7 marcados como riesgo"
echo "    · #5 marcado como decision de negocio"

echo ""
echo "==> Listo. Hallazgos publicados. Ningun issue cerrado: las decisiones son humanas."
