# Reparto del trabajo — dos tracks independientes

| | Track A — Core y Vendedores | Track B — API pública y Kiosco |
|---|---|---|
| Responsable | `Rfusco22-supricom` | `LinoGouveia` |
| Label | `track:A-core-vendedores` | `track:B-api-kiosco` |
| Issues | 30 | 24 |
| Frontend propio | Panel Next.js | App React Native |
| Superficie backend | Middleware core, identidad, `/salesperson/*` | `/api/v1/public/*`, recomendador |

---

## 1. Por qué se corta por aquí

El corte **no es por capas** (uno hace backend, otro frontend). Ese reparto suena
limpio y en la práctica genera una dependencia permanente: el del frontend vive
esperando endpoints del otro.

El corte es por **rebanada vertical**. Cada uno posee su dominio completo, del RPC
a Odoo hasta la pantalla. Nadie espera a nadie para avanzar en su track.

- **Track A** es todo lo *interno*: cómo entran los datos de Odoo al sistema, quién
  es quién, y qué ve el vendedor de ASTA.
- **Track B** es todo lo *externo*: lo que consume un cliente, sea por API o desde
  una tablet en la tienda.

---

## 2. Reparto por fase

| Fase | Track A | Track B |
|---|---|---|
| 0 — Descubrimiento | #1, #2 | #3, #4, #5, #6, #7 |
| 1 — Cimientos | #8 – #14 (7) | — |
| 2 — Identidad | #15 – #19, #51 – #54 (9) | — |
| 3 — Vendedores | #20 – #26 (7) | — |
| 4 — API pública | — | #27 – #37 (11) |
| 5 — Kiosco | — | #38 – #43 (6) |
| 6 — Endurecimiento | #44, #46, #47, #48 | #45, #49 |
| **Total** | **30** | **24** |

---

## 3. Las dependencias reales (no se pueden eliminar, sí acotar)

Prometer cero dependencias sería mentira: las Fases 0 y 1 son cimiento compartido.
Lo que sí se puede hacer es reducirlas a **tres puntos concretos**, cada uno con
fecha y con un plan B si se retrasa.

### 3.1 A → B · El usuario de servicio de Odoo (#1)

**Qué:** B no puede correr el `odoo-probe` (sus issues #3–#7) hasta que exista el
usuario de servicio y su API key.

**Cuándo:** día 1. Es una tarea de ~30 minutos que requiere acceso admin a Odoo,
que lo tiene A.

**Plan B:** si se retrasa más de un día, A le pasa a B una credencial de solo
lectura temporal contra staging. B no necesita producción para el reconocimiento.

### 3.2 A → B · Los cimientos del middleware (Fase 1)

**Qué:** B construye sus endpoints sobre el cliente XML-RPC, el `env.ts` y el
Prisma que monta A en la Fase 1.

**Cuándo:** semana 1 completa.

**Por qué no bloquea:** mientras A monta los cimientos, B tiene su propia semana
de trabajo independiente — las 5 issues de descubrimiento (#3–#7). No requieren
middleware: el `odoo-probe` ya está escrito y es autocontenido. Los tiempos
encajan sin que nadie espere.

### 3.3 A → B · Filas en `app_users` (#15)

**Qué:** las API keys de B cuelgan de `app_users`. Ese espejo lo puebla el job de
sincronización de A.

**Cuándo:** inicio de la Fase 2 de A, que coincide con el inicio de la Fase 4 de B.

**Plan B — y esto es un compromiso, no una sugerencia:** A entrega un **seed de
fixtures** (`prisma/seed.ts`) con 5 usuarios de prueba —uno por rol— como *primer*
entregable de la Fase 2, antes del job de sincronización completo. B construye
contra esas filas y no espera a que el sync funcione de punta a punta.

### 3.4 B → A · Ninguna

Track B no produce nada que Track A necesite para avanzar. La dependencia es
unidireccional por diseño: A está aguas arriba.

---

## 4. El contrato compartido — lo único que se toca entre los dos

`packages/shared-types` es la superficie común. Es donde en un reparto de dos
personas se producen los choques reales, así que tiene regla propia:

1. **Se define en la semana 1, juntos**, antes de que cada uno se vaya por su lado.
   Los tipos de request y response de cada endpoint, como schemas de zod.
2. **Cambiarlo es un PR con revisión del otro.** Siempre. Aunque sea añadir un
   campo.
3. Añadir un campo opcional no rompe a nadie. Quitar o renombrar uno sí: eso se
   avisa antes de abrir el PR.

Fuera de `packages/shared-types`, cada uno es dueño de sus carpetas y no necesita
aprobación del otro para mergear.

### Propiedad de carpetas

```
apps/middleware/src/odoo/          A
apps/middleware/src/config/        A
apps/middleware/src/services/
    invoicing, partners            A
    apiKey, catalog, recommender   B
apps/middleware/src/controllers/
    salesperson.*                  A
    public.*, recommender.*        B
apps/middleware/src/middleware/
    authJwt                        A
    apiKeyAuth                     B
apps/web/                          A
apps/mobile/                       B
prisma/schema.prisma               A (migraciones), B avisa lo que necesita
packages/shared-types/             COMPARTIDO — PR con revisión cruzada
```

`prisma/schema.prisma` lo migra A para que no haya dos personas generando
migraciones en paralelo, que es la vía más rápida a un conflicto irresoluble. B
pide lo que necesita por issue.

---

## 5. Revisión cruzada obligatoria

Independientes para trabajar, no para revisar. Dos issues **no se cierran sin la
revisión del otro**, porque son los que protegen datos de clientes:

- **#25** (A) — aislamiento entre carteras de vendedores → lo revisa B
- **#36** (B) — aislamiento entre clientes de la API → lo revisa A

Son los dos gates de seguridad del proyecto. El autor de un test de aislamiento es
la peor persona para juzgar si cubre todos los casos: ya pensó en los que se le
ocurrieron.

---

## 6. Riesgo asimétrico — se materializó

**Track B cargaba con el riesgo #1 del proyecto, y salió mal.** El issue #7
devolvió **cobertura 0%**: no es que la data esté incompleta, es que
`asta.printer.model` no existe en Odoo. **La Fase 5 está pospuesta** y B pierde
6 issues de su track.

**Qué hace B mientras tanto:** su Fase 4 (API pública, #27–#37) sigue intacta y
es donde debe concentrarse. Si le sobra capacidad, recoge:

1. El epic de captura de datos de compatibilidad (que habría que abrir),
2. y las issues de frontend de la Fase 3 de A (#23 ficha de cliente, #24 perfilado),
   que son independientes de la tabla de cartera.

Esto se sabe en la **semana 1**, no en la semana 6. Por eso #7 está en la Fase 0 y
no en la 5.

---

## 7. Cadencia mínima

- **Semana 1, al arrancar:** definir juntos `packages/shared-types`.
- **Semana 1, al cerrar:** A entrega cimientos, B entrega el informe del probe.
  Aquí se decide si la Fase 5 procede.
- **Después:** una sincronización corta a la semana. Con esta separación no hace
  falta más.

---

## 8. Re-ejecutar el reparto

`LinoGouveia` ya aceptó la invitación, así que los 54 issues están asignados y
etiquetados. Para re-aplicar el reparto tras añadir issues nuevos:

```bash
bash scripts/assign-tracks.sh Rfusco22-supricom/asta-platform
```

El script es idempotente. Si cambias el reparto, edita los arrays `ISSUES_A` e
`ISSUES_B` y actualiza este documento.
