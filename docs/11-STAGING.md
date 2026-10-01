# 11 · Batería de staging (#13)

`pnpm test:staging` corre contra una **copia** de Odoo lo que la batería normal no
puede probar contra producción: sobre todo `POST /orders` (#33) con el escritor
de verdad, que **crea pedidos**.

La batería normal (`pnpm test`) sigue como estaba: lee del Odoo de producción y
nunca escribe en él.

---

## 1. Conseguir el staging (lo hace quien administra Odoo.sh)

La instancia es **Odoo 17.0 Enterprise**, y la base se llama
`supricom-prod1-25424683`, que es el patrón de Odoo.sh (`proyecto-rama-build`).
En Odoo.sh:

1. En el proyecto, **Branches** → crear una rama (o usar una que exista) y
   arrastrarla a **Staging**.
2. Odoo.sh la construye con una **copia de la base de producción**,
   neutralizada: los correos salientes y los crons quedan desactivados, así que
   no se escribe a clientes desde staging.
3. Anotar la **URL** (del estilo `https://supricom-staging-1234567.dev.odoo.com`)
   y el **nombre de la base**, que aparece en la pestaña de la build.
4. Entrar en el staging con el usuario de servicio del middleware y generar una
   **API key nueva** (Preferencias → Seguridad de la cuenta). No reutilizar la de
   producción: si un `.env.staging` se filtra, que no abra producción.

> Cada vez que se reconstruye el staging se vuelve a copiar producción. La API
> key del paso 4 hay que regenerarla entonces.

## 2. Configurar

```bash
cp .env.staging.example .env.staging     # git lo ignora
```

Rellenar `ODOO_URL`, `ODOO_DB`, `ODOO_USERNAME` y `ODOO_PASSWORD` con los del
**staging**. `DATABASE_URL` tiene que ser el MySQL **local**.

## 3. Correr

```bash
pnpm test:staging
```

### La barrera

Antes de ejecutar un solo test, `src/__tests__/staging/preparar.ts` carga
`.env.staging` y pasa `src/odoo/entornoStaging.ts`. **No arranca** si:

| Comprobación | Por qué |
|---|---|
| falta `ODOO_STAGING=si` | un `.env` copiado de otro sitio no lo trae |
| `ODOO_DB` es la de producción | `supricom-prod1-25424683` viene por defecto en la lista |
| el host de `ODOO_URL` es el de producción | `supricom2.odoo.com`, por defecto |
| `DATABASE_URL` no es localhost | la batería también escribe en MySQL |

Se miran la base **y** el host porque basta con que uno coincida para que algo
esté mal copiado. La lista de producción se puede ampliar
(`ODOO_DB_PRODUCCION`, `ODOO_HOST_PRODUCCION`), nunca vaciar.

Comprobado el 2026-10-01: sin `.env.staging` no corre nada; con un
`.env.staging` que apunta a producción, sale

```
La batería de staging NO arranca: esto no parece staging.
  · ODOO_DB=supricom-prod1-25424683 es la base de PRODUCCIÓN.
  · ODOO_URL apunta a supricom2.odoo.com, el Odoo de PRODUCCIÓN.
```

`entornoStaging.test.ts` vigila la barrera en la batería **normal**, sin Odoo:
si alguien la debilita, se nota aunque nadie tenga staging a mano.

## 4. Qué comprueba

**`pedidos.staging.ts`**, con el escritor real de `POST /orders`:

- que Odoo acepta el `create` y el pedido nace en **borrador**, a nombre del
  cliente, con su compañía, su tarifa y su almacén;
- que **el precio que pone Odoo en la línea es el de la tarifa** del cliente,
  sin habérselo mandado (#33 decidió que el cliente no manda precio);
- que repetir con la misma `Idempotency-Key` devuelve el mismo pedido y en Odoo
  hay **uno solo**;
- que la conciliación (`buscar` por cliente y `origin`) encuentra el pedido.
  Es lo que evita duplicados tras un tiempo agotado (#154).

Al terminar **cancela** lo que creó. Si eso falla, los pedidos quedan en el
staging con `origin = "API Asta (staging-13-…)"`.

**`clienteOdoo.staging.ts`**, solo lectura: las costumbres de Odoo que el código
da por hechas. Un campo vacío llega como `false`, un many2one como
`[id, nombre]`, un `read_group` sin coincidencias como `[]`, cada grupo trae
`__count` y `search_count` devuelve un número. Verificado el 2026-10-01 contra
la instancia real.

Si no encuentra datos con los que probar (un cliente con tarifa, almacén y una
referencia con precio y existencia), **lanza**: un gate que no encuentra datos
no ha comprobado nada.

## 5. Después: encender los pedidos

Con `pnpm test:staging` en verde:

1. Dar al usuario de servicio de **producción** permiso de `create` en
   `sale.order` y `sale.order.line`, en las compañías de los clientes (#1).
2. `API_PEDIDOS_ESCRITURA=true` en las variables del middleware en EasyPanel.

Y volver a pasar `pnpm test:staging` cada vez que se toque
`pedidosEscritura.service.ts`.
