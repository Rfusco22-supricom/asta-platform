# ASTA — Arquitectura del Sistema

## 1. Principio rector

**Odoo es el sistema de registro (source of truth). El Middleware es el único que habla con Odoo.**

Ni Next.js ni React Native tocan Odoo directamente. Esto da:

- Un solo lugar donde vive la credencial maestra de Odoo.
- Un solo lugar donde se aplica el *scoping* por cliente (el filtro que impide que el cliente A vea datos del cliente B).
- Capacidad de cachear y agregar sin castigar al ERP (Odoo se degrada rápido con tráfico de API pública).
- Libertad de versionar la API pública sin depender del ciclo de releases de Odoo.

---

## 2. Diagrama de flujo

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CONSUMIDORES                                   │
├──────────────────┬──────────────────┬───────────────────────────────────────┤
│  Panel Web       │  App Móvil       │  Cliente Externo (API pública)        │
│  Next.js 15      │  React Native    │  curl / Python / n8n / ERP del cliente│
│  SuperAdmin,     │  Modo Kiosco     │                                       │
│  Vendedor,       │  en tienda       │                                       │
│  Cliente         │                  │                                       │
└────────┬─────────┴────────┬─────────┴──────────────┬────────────────────────┘
         │                  │                        │
    JWT Supabase       JWT + Device Token      X-API-Key: asta_live_xxx
    cookie httpOnly    rotación diaria         header, nunca query param
         │                  │                        │
         └──────────────────┴────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    MIDDLEWARE — Node.js 20 + Express + TS                   │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ 1. AUTENTICACIÓN (dual)                                               │  │
│  │    · authJwt()     -> valida JWT Supabase -> carga AppUser            │  │
│  │    · authApiKey()  -> prefix lookup + HMAC compare -> carga AppUser   │  │
│  │    Ambos producen el MISMO objeto: req.identity                       │  │
│  │    { appUserId, role, odooPartnerId, odooUserId, pricelistId, scopes }│  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                            │                                                │
│  ┌─────────────────────────▼─────────────────────────────────────────────┐  │
│  │ 2. AUTORIZACIÓN + SCOPING   <-- EL PUNTO CRÍTICO DE SEGURIDAD         │  │
│  │    El partner_id NUNCA viene del body/query del cliente.              │  │
│  │    Se deriva SIEMPRE de req.identity.odooPartnerId.                   │  │
│  │    · Cliente    -> domain forzado: [partner_id child_of SU_ID]        │  │
│  │    · Vendedor   -> valida que res.partner.user_id == su odooUserId    │  │
│  │    · SuperAdmin -> sin filtro                                         │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                            │                                                │
│  ┌─────────────────────────▼─────────────────────────────────────────────┐  │
│  │ 3. RATE LIMIT + CACHE                                                 │  │
│  │    Rate limit por api_key_id (no por IP). Cache Redis/Postgres:       │  │
│  │    catálogo 15 min · precios 5 min · facturación 60 s · stock 60 s    │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                            │                                                │
│  ┌─────────────────────────▼─────────────────────────────────────────────┐  │
│  │ 4. CAPA DE SERVICIO ODOO (XML-RPC, uid maestro cacheado)              │  │
│  │    catalog · pricing · invoicing · partners · recommender             │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└──────────┬──────────────────────────────────────────┬──────────────────────-┘
           │                                          │
   XML-RPC /xmlrpc/2/object                    SQL (Prisma)
   execute_kw(db, MASTER_UID, pwd, ...)               │
           │                                          ▼
           ▼                          ┌───────────────────────────────────┐
┌────────────────────────────┐        │  PostgreSQL / Supabase            │
│  ODOO 17 ERP               │        │  · app_users (espejo de partner)  │
│  · res.partner             │        │  · api_keys (hash, scopes, TTL)   │
│  · product.template        │        │  · api_request_logs (auditoría)   │
│  · product.pricelist       │        │  · kiosk_devices / kiosk_sessions │
│  · account.move            │        │  · recommendation_events          │
│  · asta.printer.model      │        │  · odoo_entity_cache              │
│  · x_client_tier           │        │                                   │
└────────────────────────────┘        └───────────────────────────────────┘
             ▲
             │  Webhook (base.automation en Odoo -> Middleware)
             └──── invalida cache al cambiar precio / stock / tier
```

---

## 3. Los tres flujos, paso a paso

### 3.1 Cliente externo con su API Key

```
1. Cliente:     GET /api/v1/inventory?sku=TN-2370
                X-API-Key: asta_live_a1b2c3d4_9f8e7d6c5b4a...

2. Middleware:  parsea prefix "a1b2c3d4" -> SELECT * FROM api_keys WHERE prefix = $1
                -> 1 índice, 1 fila. Compara HMAC-SHA256(pepper, key) en tiempo constante.
                -> verifica revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())
                -> verifica que el scope 'INVENTORY_READ' esté en key.scopes

3. Middleware:  identity = { odooPartnerId: 4512, role: GOLD, pricelistId: 7 }

4. Middleware:  execute_kw('product.product', 'search_read',
                  [[['default_code','=','TN-2370'], ['sale_ok','=',true]]],
                  { fields: [...] })
                <- usa el UID MAESTRO, no un usuario del cliente

5. Middleware:  resuelve el precio de la tarifa 7 (nivel GOLD) leyendo las
                reglas: product.pricelist.item filtrado por pricelist_id y
                product_tmpl_id -> fixed_price
                -> NUNCA devuelve list_price crudo ni standard_price (costo)

   OJO: `context: { pricelist: N }` NO funciona en Odoo 17 — el campo `price`
   de product.product fue eliminado y `lst_price` ignora la tarifa. Ver
   docs/04-HALLAZGOS-FASE-0.md para la tabla de vías probadas y descartadas.

6. Middleware:  INSERT api_request_logs (key_id, endpoint, status, ms)
                -> devuelve JSON normalizado y versionado
```

**Regla de oro:** Odoo no conoce ni almacena los tokens de clientes externos. Emitir API keys dentro de Odoo obligaría a crear un `res.users` por cliente (coste de licencia, carga de sesiones y superficie de ataque sobre el ERP). El Middleware emite, guarda y revoca; Odoo solo ve una conexión de servicio confiable.

### 3.2 Vendedor en el panel web

```
Login Supabase -> JWT -> GET /api/v1/salesperson/clients/:partnerId/invoicing

  -> authJwt() carga AppUser { role: VENDEDOR, odooUserId: 23 }
  -> assertSalespersonOwnsPartner(23, partnerId)   <- lee res.partner.user_id
       · si no coincide -> 403 (y se registra en audit_logs)
  -> read_group sobre account.move
       domain:  [partner_id child_of X, move_type = out_invoice, state = posted]
       groupby: payment_state
       fields:  amount_total_signed:sum, amount_residual_signed:sum
  -> { totalFacturado, porCobrar, cobrado, numeroFacturas, ultimaFactura }
```

### 3.3 Modo Kiosco — recomendador de tóner

```
Tablet arranca -> device_token (rotado a diario) -> sesión de kiosco

Cliente teclea su modelo: "Brother HL-L2350DW"
  -> GET /api/v1/recommender/printers?q=HL-L2350
       search_read en asta.printer.model (fuzzy: ilike sobre name + aliases)
  -> el usuario elige el modelo -> id 88
  -> GET /api/v1/recommender/compatible?printerId=88
       search_read product.template
         domain: [['printer_compatibilities_ids','in',[88]], ['sale_ok','=',true]]
         fields: rendimiento, color, tipo (original/compatible), qty_available
  -> precios según el tier de la sesión (o precio público si es anónimo)
  -> INSERT recommendation_events
       (para saber qué impresoras busca la gente y qué tóner deberíamos tener en stock)

Sesión de kiosco: TTL de 4 min de inactividad -> logout automático + limpieza de estado.
Una tablet en piso de venta es un dispositivo compartido: nunca debe quedar la sesión
de un cliente abierta para el siguiente.
```

---

## 4. Decisiones de diseño (y por qué)

| Decisión | Alternativa descartada | Motivo |
|---|---|---|
| El Middleware emite los tokens | API keys dentro de Odoo | No pagar licencia por cliente externo; no exponer el ERP; poder revocar sin tocar Odoo |
| HMAC-SHA256 + pepper para hashear la key | bcrypt / argon2 | bcrypt tarda ~100 ms: inaceptable en cada request. La key tiene 256 bits de entropía aleatoria; no necesita un KDF lento como sí lo necesita una contraseña humana |
| Prefijo público indexado dentro de la key | comparar contra todas las filas | Lookup O(1) por índice, en vez de escanear la tabla hasheando fila por fila |
| `read_group` para totales | `search_read` + sumar en Node | La agregación ocurre en Postgres: vuelve 1 fila en vez de 10.000 facturas |
| `amount_total_signed` | `amount_total` | Está en moneda de la compañía y viene firmado (las notas de crédito restan) |
| `child_of` en el domain | `=` sobre partner_id | Incluye sucursales y contactos hijos del cliente. Sin esto los totales salen por debajo del real |
| Espejo de `res.partner` en Postgres | consultar Odoo en cada login | El login no puede depender de la latencia ni del uptime del ERP |
| XML-RPC | JSON-RPC (`/web/dataset/call_kw`) | XML-RPC es la vía estable y documentada de Odoo. JSON-RPC va atado a la sesión web y cambia entre versiones |

---

## 5. Lo que había que confirmar en Odoo — RESUELTO

> Reconocimiento ejecutado el **2026-09-11** contra `supricom-prod1-25424683`
> (Odoo 17.0+e) con `pnpm probe`. **Informe completo en
> [`04-HALLAZGOS-FASE-0.md`](./04-HALLAZGOS-FASE-0.md).**

| Supuesto | Realidad |
|---|---|
| `x_client_tier` clasifica al cliente | ✗ **No existe.** `res.partner` no tiene ni un campo `x_*`. Recomendación: derivar el tier de `property_product_pricelist`, que es el mecanismo nativo, en vez de crear un campo paralelo |
| Tres tarifas, una por nivel | ⚠ 18 tarifas con reglas, pero **los 2942 clientes usan la misma**. La diferenciación por nivel está al 0% y es una decisión comercial pendiente |
| Precio vía `context: {pricelist}` | ✗ **Odoo 17 eliminó esa vía.** Hay que leer `product.pricelist.item` (34.999 de 35.000 reglas son `fixed`) |
| `asta.printer.model` | ✗ **No existe.** Solo `pos.printer` (hardware de punto de venta) |
| `printer_compatibilities_ids` | ✗ **No existe** en ningún modelo. Cero relaciones impresora↔tóner registradas |
| Usuario de servicio | ✓ `webmaster02@supricom.com.ve` → uid 388, **no es admin** |

**Consecuencia para el plan:** las Fases 1, 2, 3 y 4 siguen en pie tal como están
diseñadas. La **Fase 5 (recomendador) sale del camino crítico** y pasa a ser un
epic aparte, porque antes hay que construir el modelo en Odoo y cargar la data de
compatibilidad.

### Sigue pendiente

1. **Multi-compañía** — si existe más de una `res.company`, todo domain necesita el `company_id` correcto en el contexto.
2. **Permisos del uid 388** — confirmar que están acotados a lectura sobre los modelos necesarios.
3. **Campos de precio personalizados** — la instancia tiene una docena (`list_price_usd`, `company_sale_price_usd`, `min_price`, `costo_reposicion_usd`...). Hay que saber cuáles están vivos antes de tocar nada relacionado con precios.
