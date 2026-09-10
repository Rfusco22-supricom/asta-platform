/**
 * odoo-probe — reconocimiento de la instancia de Odoo.
 *
 *   pnpm probe            informe en consola + snapshot JSON
 *   pnpm probe --json     solo el JSON, para diffear entre corridas
 *
 * Responde con datos reales las preguntas que hoy son supuestos en la
 * arquitectura. Cierra los issues #3, #4, #5 y #6.
 *
 * Es deliberadamente autocontenido: solo necesita `xmlrpc` y las 4 variables
 * ODOO_*. No importa nada de apps/middleware, porque `config/env.ts` exige
 * DATABASE_URL y las claves de Supabase, que en Fase 0 todavía no existen.
 * Un script de diagnóstico que no arranca sin la mitad del sistema montado no
 * sirve para diagnosticar.
 *
 * Es de SOLO LECTURA. No escribe nada en Odoo.
 */

import xmlrpc from 'xmlrpc';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { URL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const JSON_ONLY = process.argv.includes('--json');

// ─────────────────────────────────────────────────────────────────────────────
// Entorno (dotenv mínimo, sin dependencias)
// ─────────────────────────────────────────────────────────────────────────────

function loadEnv(): void {
  try {
    const raw = readFileSync(resolve(ROOT, '.env'), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (!match) continue;
      const [, key, value] = match;
      if (process.env[key] === undefined) {
        process.env[key] = value.trim().replace(/^["']|["']$/g, '');
      }
    }
  } catch {
    /* sin .env: se usan las variables del entorno */
  }
}

loadEnv();

const ODOO_URL = process.env.ODOO_URL;
const ODOO_DB = process.env.ODOO_DB;
const ODOO_USERNAME = process.env.ODOO_USERNAME;
const ODOO_PASSWORD = process.env.ODOO_PASSWORD;

if (!ODOO_URL || !ODOO_DB || !ODOO_USERNAME || !ODOO_PASSWORD) {
  console.error(`
  Faltan credenciales de Odoo.

  Copia .env.example a .env y rellena:

    ODOO_URL=https://tu-instancia.odoo.com
    ODOO_DB=nombre-de-la-base
    ODOO_USERNAME=api-middleware@asta.mx
    ODOO_PASSWORD=<API key de Odoo>

  La API key se genera en Odoo: Preferencias > Seguridad de la cuenta >
  Claves de API. Es revocable sin cambiar la contraseña del usuario.

  Si el usuario de servicio todavía no existe, ese es el issue #1 y va antes
  que este script.
`);
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// Cliente XML-RPC
// ─────────────────────────────────────────────────────────────────────────────

const TIMEOUT_MS = Number(process.env.ODOO_TIMEOUT_MS ?? 30_000);

function buildClient(path: string) {
  const url = new URL(path, ODOO_URL);
  const options = { url: url.toString(), headers: { 'User-Agent': 'asta-odoo-probe/1.0' } };
  return url.protocol === 'https:'
    ? xmlrpc.createSecureClient(options)
    : xmlrpc.createClient(options);
}

const commonClient = buildClient('/xmlrpc/2/common');
const objectClient = buildClient('/xmlrpc/2/object');

function rpc<T>(client: ReturnType<typeof buildClient>, method: string, params: unknown[]): Promise<T> {
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout tras ${TIMEOUT_MS} ms`)), TIMEOUT_MS);
    client.methodCall(method, params, (error: unknown, value: T) => {
      clearTimeout(timer);
      if (error) reject(error);
      else resolvePromise(value);
    });
  });
}

let UID = 0;

function execute<T>(model: string, method: string, args: unknown[] = [], kwargs: Record<string, unknown> = {}): Promise<T> {
  return rpc<T>(objectClient, 'execute_kw', [ODOO_DB, UID, ODOO_PASSWORD, model, method, args, kwargs]);
}

const searchRead = <T = Record<string, unknown>>(
  model: string,
  domain: unknown[],
  fields: string[],
  extra: Record<string, unknown> = {},
) => execute<T[]>(model, 'search_read', [domain], { fields, ...extra });

const searchCount = (model: string, domain: unknown[]) =>
  execute<number>(model, 'search_count', [domain]);

const readGroup = <T = Record<string, unknown>>(
  model: string,
  domain: unknown[],
  fields: string[],
  groupby: string[],
  extra: Record<string, unknown> = {},
) => execute<T[]>(model, 'read_group', [domain, fields, groupby], { lazy: false, ...extra });

// ─────────────────────────────────────────────────────────────────────────────
// Informe
// ─────────────────────────────────────────────────────────────────────────────

type Status = 'ok' | 'warn' | 'fail' | 'info';

interface Finding {
  issue: string;
  pregunta: string;
  respuesta: string;
  status: Status;
  detalle?: unknown;
}

interface OdooField {
  type: string;
  string: string;
  required?: boolean;
  relation?: string;
  selection?: Array<[string, string]>;
  store?: boolean;
  help?: string;
}

const findings: Finding[] = [];
const report: Record<string, unknown> = {};

function add(finding: Finding): void {
  findings.push(finding);
}

/** Ejecuta una sonda sin que su fallo tumbe el resto del reconocimiento. */
async function probe<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!JSON_ONLY) console.error(`   ✗ ${label}: ${message}`);
    add({ issue: '-', pregunta: label, respuesta: `Error: ${message}`, status: 'fail' });
    return null;
  }
}

const log = (msg: string) => { if (!JSON_ONLY) console.log(msg); };

const MODELS_OF_INTEREST = [
  'res.partner',
  'res.users',
  'product.template',
  'product.product',
  'product.pricelist',
  'account.move',
  'account.move.line',
  'sale.order',
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Sondas
// ─────────────────────────────────────────────────────────────────────────────

async function probeConnection(): Promise<boolean> {
  log('\n▸ Conexión\n');

  const version = await probe('version()', () =>
    rpc<Record<string, unknown>>(commonClient, 'version', []),
  );
  if (!version) return false;

  const uid = await probe('authenticate()', () =>
    rpc<number | false>(commonClient, 'authenticate', [ODOO_DB, ODOO_USERNAME, ODOO_PASSWORD, {}]),
  );

  if (!uid) {
    log('   ✗ Odoo rechazó las credenciales. Revisa ODOO_DB, ODOO_USERNAME y la API key.');
    return false;
  }

  UID = uid;
  report.meta = {
    generadoEn: new Date().toISOString(),
    odooUrl: ODOO_URL,
    odooDb: ODOO_DB,
    odooUsuario: ODOO_USERNAME,
    uid,
    version,
  };

  log(`   ✓ Conectado a ${ODOO_URL} (db: ${ODOO_DB})`);
  log(`   ✓ Odoo ${String(version.server_version ?? '?')} · uid ${uid}`);

  if (uid === 1) {
    add({
      issue: '#1',
      pregunta: '¿El middleware usa un usuario de servicio dedicado?',
      respuesta: 'NO — está usando uid 1 (admin). Crear api-middleware@asta con permisos acotados.',
      status: 'warn',
    });
    log('   ⚠ uid 1 = admin. El issue #1 pide un usuario de servicio dedicado.');
  }

  return true;
}

async function probeSchemas(): Promise<Record<string, Record<string, OdooField>>> {
  log('\n▸ Esquema de modelos\n');
  const schemas: Record<string, Record<string, OdooField>> = {};

  for (const model of MODELS_OF_INTEREST) {
    const fields = await probe(`fields_get(${model})`, () =>
      execute<Record<string, OdooField>>(model, 'fields_get', [], {
        attributes: ['type', 'string', 'required', 'relation', 'selection', 'store', 'help'],
      }),
    );
    if (fields) {
      schemas[model] = fields;
      const custom = Object.keys(fields).filter((f) => f.startsWith('x_'));
      log(`   ✓ ${model.padEnd(20)} ${String(Object.keys(fields).length).padStart(4)} campos` +
          (custom.length ? `  (${custom.length} personalizados)` : ''));
    }
  }

  report.esquemas = schemas;
  return schemas;
}

async function probeClientTier(schemas: Record<string, Record<string, OdooField>>): Promise<void> {
  log('\n▸ Issue #3 — x_client_tier\n');

  const partnerFields = schemas['res.partner'];
  if (!partnerFields) return;

  const field = partnerFields['x_client_tier'];

  if (!field) {
    const candidatos = Object.entries(partnerFields)
      .filter(([name, f]) =>
        name.startsWith('x_') || /tier|nivel|categor|rango/i.test(`${name} ${f.string}`))
      .map(([name, f]) => ({ campo: name, tipo: f.type, etiqueta: f.string }));

    log('   ✗ x_client_tier NO existe en res.partner.');
    if (candidatos.length) {
      log('     Campos que podrían cumplir esa función:');
      for (const c of candidatos.slice(0, 15)) {
        log(`       · ${c.campo.padEnd(30)} ${c.tipo.padEnd(12)} "${c.etiqueta}"`);
      }
    }

    add({
      issue: '#3',
      pregunta: '¿Existe x_client_tier en res.partner?',
      respuesta: 'NO existe. Hay que crearlo, o identificar cuál de los campos candidatos cumple esa función.',
      status: 'fail',
      detalle: candidatos,
    });
    return;
  }

  log(`   ✓ x_client_tier existe · tipo: ${field.type} · etiqueta: "${field.string}"`);

  const detalle: Record<string, unknown> = { tipo: field.type, etiqueta: field.string };

  if (field.type === 'selection' && field.selection) {
    detalle.valores = field.selection;
    log('     Valores técnicos (los que hay que usar en el código, tal cual):');
    for (const [value, label] of field.selection) log(`       · "${value}"  ->  ${label}`);
  }

  if (field.type === 'many2one') {
    detalle.relation = field.relation;
    log(`     Relación: ${field.relation}`);
    const registros = await probe(`${field.relation} records`, () =>
      searchRead(field.relation!, [], ['id', 'name'], { limit: 20 }),
    );
    if (registros) {
      detalle.registros = registros;
      for (const r of registros) log(`       · id ${r.id}  ${String(r.name)}`);
    }
  }

  // Cobertura: los huecos definen el default.
  const totalClientes = await probe('conteo de clientes', () =>
    searchCount('res.partner', [['customer_rank', '>', 0]]),
  );
  const sinTier = await probe('clientes sin tier', () =>
    searchCount('res.partner', [['customer_rank', '>', 0], ['x_client_tier', '=', false]]),
  );

  if (totalClientes !== null && sinTier !== null) {
    const pct = totalClientes > 0 ? ((sinTier / totalClientes) * 100).toFixed(1) : '0';
    detalle.cobertura = { totalClientes, sinTier, porcentajeSinTier: Number(pct) };
    log(`     Cobertura: ${totalClientes - sinTier}/${totalClientes} clientes con tier · ${pct}% sin asignar`);

    if (sinTier > 0) {
      log(`   ⚠ ${sinTier} clientes sin tier. Hay que decidir el default para ellos.`);
    }

    // Distribución por tier: dice si el modelo de negocio se usa de verdad.
    const dist = await probe('distribución por tier', () =>
      readGroup('res.partner', [['customer_rank', '>', 0]], [], ['x_client_tier']),
    );
    if (dist) {
      detalle.distribucion = dist;
      log('     Distribución:');
      for (const g of dist) {
        const valor = g['x_client_tier'];
        const nombre = Array.isArray(valor) ? valor[1] : (valor || '(sin asignar)');
        log(`       · ${String(nombre).padEnd(20)} ${String(g.__count).padStart(6)} clientes`);
      }
    }
  }

  add({
    issue: '#3',
    pregunta: '¿De qué tipo es x_client_tier y cuál es su cobertura?',
    respuesta:
      field.type === 'many2one'
        ? `many2one -> ${field.relation}. Ya es la forma recomendada.`
        : `${field.type}. Recomendación: migrar a many2one hacia asta.client.tier con su pricelist asociada, para que tier -> tarifa sea un dato y no un if en el código.`,
    status: field.type === 'many2one' ? 'ok' : 'warn',
    detalle,
  });
}

async function probePrinterModel(schemas: Record<string, Record<string, OdooField>>): Promise<void> {
  log('\n▸ Issue #4 — asta.printer.model y compatibilidades\n');

  const detalle: Record<string, unknown> = {};

  // ¿Existe el modelo?
  const printerFields = await execute<Record<string, OdooField>>('asta.printer.model', 'fields_get', [], {
    attributes: ['type', 'string', 'relation'],
  }).catch(() => null);

  if (printerFields) {
    detalle.existe = true;
    detalle.campos = Object.keys(printerFields);
    const total = await probe('conteo de impresoras', () => searchCount('asta.printer.model', []));
    detalle.registros = total;
    log(`   ✓ asta.printer.model existe · ${Object.keys(printerFields).length} campos · ${total ?? '?'} registros`);
    log(`     Campos: ${Object.keys(printerFields).filter((f) => !f.startsWith('__')).slice(0, 20).join(', ')}`);

    const tieneAliases = 'aliases' in printerFields || 'alias' in printerFields;
    if (!tieneAliases) {
      log('   ⚠ Sin campo `aliases`. La búsqueda difusa (issue #38) lo necesita:');
      log('     la gente escribe "hl2350", no "HL-L2350DW".');
    }
    detalle.tieneAliases = tieneAliases;
  } else {
    detalle.existe = false;
    log('   ✗ asta.printer.model NO existe.');

    // ¿Habrá otro modelo cumpliendo esa función con otro nombre?
    const similares = await probe('modelos similares', () =>
      searchRead('ir.model', [['model', 'like', 'printer']], ['model', 'name']),
    );
    if (similares?.length) {
      detalle.modelosSimilares = similares;
      log('     Modelos con "printer" en el nombre:');
      for (const m of similares) log(`       · ${String(m.model)}  "${String(m.name)}"`);
    } else {
      log('     Tampoco hay ningún modelo con "printer" en el nombre.');
    }
  }

  // ¿Dónde vive la compatibilidad: template o product?
  const enTemplate = schemas['product.template']?.['printer_compatibilities_ids'];
  const enProduct = schemas['product.product']?.['printer_compatibilities_ids'];

  detalle.compatibilidadEnTemplate = Boolean(enTemplate);
  detalle.compatibilidadEnProduct = Boolean(enProduct);

  if (enTemplate) {
    log(`   ✓ printer_compatibilities_ids en product.template -> ${enTemplate.relation} (${enTemplate.type})`);
  } else if (enProduct) {
    log(`   ⚠ printer_compatibilities_ids está en product.product, NO en product.template -> ${enProduct.relation}`);
    log('     Si hay variantes de tóner (XL vs estándar), la compatibilidad suele');
    log('     corresponder al template. Revisar con negocio.');
  } else {
    log('   ✗ printer_compatibilities_ids no existe ni en product.template ni en product.product.');
    const m2m = Object.entries(schemas['product.template'] ?? {})
      .filter(([n, f]) => f.type === 'many2many' && /print|impres|compat/i.test(`${n} ${f.string}`))
      .map(([n, f]) => ({ campo: n, relation: f.relation, etiqueta: f.string }));
    if (m2m.length) {
      detalle.camposM2mCandidatos = m2m;
      log('     Candidatos en product.template:');
      for (const c of m2m) log(`       · ${c.campo} -> ${c.relation}  "${c.etiqueta}"`);
    }
  }

  const existeTodo = Boolean(printerFields) && (Boolean(enTemplate) || Boolean(enProduct));

  add({
    issue: '#4',
    pregunta: '¿Existen asta.printer.model y printer_compatibilities_ids?',
    respuesta: existeTodo
      ? 'Sí, ambos existen. La Fase 5 puede proceder como está planeada.'
      : 'NO están completos. Deja de ser configuración y pasa a ser un módulo de Odoo a desarrollar: hay que abrir un epic aparte y reestimar la Fase 5.',
    status: existeTodo ? 'ok' : 'fail',
    detalle,
  });

  report.impresoras = detalle;
}

async function probePricelists(): Promise<void> {
  log('\n▸ Issue #5 — Tarifas y precios por tier\n');

  const pricelists = await probe('product.pricelist', () =>
    searchRead('product.pricelist', [], ['id', 'name', 'currency_id', 'company_id'], { order: 'id asc' }),
  );
  if (!pricelists) return;

  log(`   ✓ ${pricelists.length} tarifas encontradas:`);
  for (const p of pricelists) {
    const moneda = Array.isArray(p.currency_id) ? p.currency_id[1] : '?';
    log(`       · id ${String(p.id).padStart(3)}  ${String(p.name).padEnd(30)} ${moneda}`);
  }

  const detalle: Record<string, unknown> = { tarifas: pricelists };

  // Prueba de fuego: un mismo SKU debe dar precios distintos por tarifa.
  const muestra = await probe('producto de muestra', () =>
    searchRead('product.product', [['sale_ok', '=', true], ['type', '!=', 'service']],
      ['id', 'name', 'default_code', 'list_price'], { limit: 1 }),
  );

  if (muestra?.length) {
    const producto = muestra[0];
    log(`\n     Producto de prueba: ${String(producto.default_code ?? '')} ${String(producto.name)}`);
    log(`     list_price (precio base): ${String(producto.list_price)}`);

    const precios: Array<{ pricelistId: number; nombre: string; precio: unknown }> = [];

    for (const pl of pricelists) {
      const leido = await execute<Array<Record<string, unknown>>>(
        'product.product', 'read', [[producto.id], ['price']],
        { context: { pricelist: pl.id, quantity: 1 } },
      ).catch(() => null);

      const precio = leido?.[0]?.price ?? null;
      precios.push({ pricelistId: Number(pl.id), nombre: String(pl.name), precio });
      log(`       · ${String(pl.name).padEnd(30)} ${precio ?? '(no se pudo leer)'}`);
    }

    detalle.pruebaDePrecios = { producto, precios };

    const distintos = new Set(precios.map((p) => String(p.precio))).size;
    if (distintos <= 1) {
      log('\n   ⚠ Todas las tarifas devuelven el MISMO precio.');
      log('     O las reglas de tarifa no están cargadas, o este producto no tiene');
      log('     regla en ninguna. Probar con un producto que sí esté en las tarifas');
      log('     antes de dar por rota la configuración.');
      add({
        issue: '#5',
        pregunta: '¿Un mismo SKU devuelve precios distintos por tarifa?',
        respuesta: `NO — las ${pricelists.length} tarifas devuelven el mismo precio para el producto de prueba. Verificar las reglas de tarifa.`,
        status: 'warn',
        detalle,
      });
    } else {
      log(`\n   ✓ ${distintos} precios distintos entre ${pricelists.length} tarifas. El mecanismo funciona.`);
      add({
        issue: '#5',
        pregunta: '¿Un mismo SKU devuelve precios distintos por tarifa?',
        respuesta: `Sí — ${distintos} precios distintos. El context { pricelist: N } es la vía correcta.`,
        status: 'ok',
        detalle,
      });
    }
  }

  report.tarifas = detalle;
}

async function probeVolume(): Promise<void> {
  log('\n▸ Issue #6 — Volumen de datos\n');

  const haceUnAno = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);

  const [partners, clientes, productos, facturasAno, facturasTotal, impresoras] = await Promise.all([
    searchCount('res.partner', [['active', '=', true]]).catch(() => null),
    searchCount('res.partner', [['customer_rank', '>', 0]]).catch(() => null),
    searchCount('product.template', [['sale_ok', '=', true]]).catch(() => null),
    searchCount('account.move', [
      ['move_type', '=', 'out_invoice'], ['state', '=', 'posted'], ['invoice_date', '>=', haceUnAno],
    ]).catch(() => null),
    searchCount('account.move', [['move_type', '=', 'out_invoice'], ['state', '=', 'posted']]).catch(() => null),
    searchCount('asta.printer.model', []).catch(() => null),
  ]);

  log(`   · res.partner activos          ${String(partners ?? '?').padStart(8)}`);
  log(`   · clientes (customer_rank > 0) ${String(clientes ?? '?').padStart(8)}`);
  log(`   · productos vendibles          ${String(productos ?? '?').padStart(8)}`);
  log(`   · facturas último año          ${String(facturasAno ?? '?').padStart(8)}`);
  log(`   · facturas históricas          ${String(facturasTotal ?? '?').padStart(8)}`);
  log(`   · modelos de impresora         ${String(impresoras ?? 'n/a').padStart(8)}`);

  // Peor caso del endpoint de facturación: el cliente con más facturas.
  const porCliente = await probe('facturas por cliente', () =>
    readGroup('account.move',
      [['move_type', '=', 'out_invoice'], ['state', '=', 'posted']],
      ['amount_total_signed:sum'], ['commercial_partner_id']),
  );

  let peorCaso: Record<string, unknown> | null = null;
  if (porCliente?.length) {
    const ordenado = [...porCliente].sort((a, b) => Number(b.__count) - Number(a.__count));
    const top = ordenado[0];
    const nombre = Array.isArray(top.commercial_partner_id) ? top.commercial_partner_id[1] : '?';
    peorCaso = { cliente: nombre, facturas: top.__count, total: top['amount_total_signed'] };
    log(`\n   · Cliente con más facturas: ${String(nombre)} (${String(top.__count)} facturas)`);
    log('     Es el peor caso del endpoint de facturación. read_group lo resuelve');
    log('     en una fila, pero conviene cronometrarlo contra él.');
    log(`   · Clientes con al menos una factura: ${porCliente.length}`);
  }

  const volumen = { partners, clientes, productos, facturasAno, facturasTotal, impresoras, peorCaso,
    clientesConFacturas: porCliente?.length ?? null };
  report.volumen = volumen;

  const necesitaRedis = (facturasAno ?? 0) > 20_000 || (clientes ?? 0) > 2_000;
  add({
    issue: '#6',
    pregunta: '¿Hace falta Redis desde el día 1?',
    respuesta: necesitaRedis
      ? 'Probablemente sí: el volumen es alto. Ver el issue de decisión de Fase 1.'
      : 'Con este volumen, cache en Postgres (odoo_entity_cache) alcanza. Redis se puede diferir.',
    status: 'info',
    detalle: volumen,
  });
}

async function probeCoverage(): Promise<void> {
  log('\n▸ Issue #7 — RIESGO #1: cobertura impresora <-> tóner\n');

  const campo = report.impresoras as Record<string, unknown> | undefined;
  const enTemplate = campo?.compatibilidadEnTemplate === true;
  const enProduct = campo?.compatibilidadEnProduct === true;

  if (!enTemplate && !enProduct) {
    log('   ✗ No se puede medir: el campo de compatibilidad no existe.');
    log('     Sin este número no se puede decidir si la Fase 5 procede.');
    add({
      issue: '#7',
      pregunta: '¿Cuál es la cobertura de la data de compatibilidad?',
      respuesta: 'No medible: el campo printer_compatibilities_ids no existe todavía. Bloquea la decisión sobre la Fase 5.',
      status: 'fail',
    });
    return;
  }

  const modelo = enTemplate ? 'product.template' : 'product.product';

  const [vendibles, conCompat] = await Promise.all([
    searchCount(modelo, [['sale_ok', '=', true]]).catch(() => null),
    searchCount(modelo, [['sale_ok', '=', true], ['printer_compatibilities_ids', '!=', false]]).catch(() => null),
  ]);

  if (vendibles === null || conCompat === null) return;

  const pct = vendibles > 0 ? (conCompat / vendibles) * 100 : 0;

  log(`   · Productos vendibles              ${String(vendibles).padStart(8)}`);
  log(`   · Con compatibilidad declarada     ${String(conCompat).padStart(8)}`);
  log(`   · Cobertura                        ${pct.toFixed(1).padStart(7)}%`);

  let status: Status;
  let veredicto: string;

  if (pct > 85) {
    status = 'ok';
    veredicto = 'La Fase 5 procede como está planeada.';
    log('\n   ✓ > 85% — la Fase 5 procede como está planeada.');
  } else if (pct >= 60) {
    status = 'warn';
    veredicto = 'La Fase 5 procede, pero con flujo de respaldo ("no encontramos tu modelo, déjanos tus datos") y un plan de captura de datos en paralelo.';
    log('\n   ⚠ 60-85% — la Fase 5 procede CON flujo de respaldo obligatorio.');
    log('     Hace falta un plan de captura de datos en paralelo.');
  } else {
    status = 'fail';
    veredicto = 'La Fase 5 se pospone hasta completar la data. Construir la UI primero sería construir sobre arena.';
    log('\n   ✗ < 60% — LA FASE 5 SE POSPONE.');
    log('     Un recomendador con esta cobertura le dice "no tenemos" al cliente');
    log('     cuando sí hay producto en almacén, y lo dice en piso de venta.');
    log('     Completar la data primero.');
  }

  // La cola larga importa menos que el top de ventas: se mide aparte.
  log('\n     Nota: esto es cobertura global. El issue #7 pide cruzarlo además con');
  log('     el top 20 de marcas/modelos más vendidos — ahí la cobertura importa más.');

  const cobertura = { modelo, vendibles, conCompat, porcentaje: Number(pct.toFixed(1)), veredicto };
  report.cobertura = cobertura;

  add({
    issue: '#7',
    pregunta: '¿Cuál es la cobertura real de la data impresora <-> tóner?',
    respuesta: `${pct.toFixed(1)}% (${conCompat}/${vendibles}). ${veredicto}`,
    status,
    detalle: cobertura,
  });
}

async function probeLatency(): Promise<void> {
  log('\n▸ Latencia de Odoo\n');

  const muestras: number[] = [];
  for (let i = 0; i < 12; i++) {
    const t0 = performance.now();
    const ok = await searchRead('res.partner', [['customer_rank', '>', 0]],
      ['id', 'name', 'email'], { limit: 50 }).catch(() => null);
    if (ok) muestras.push(performance.now() - t0);
  }

  if (muestras.length < 3) {
    log('   ✗ No se pudieron tomar suficientes muestras.');
    return;
  }

  muestras.sort((a, b) => a - b);
  const pct = (p: number) => muestras[Math.min(muestras.length - 1, Math.floor((p / 100) * muestras.length))];

  const latencia = {
    muestras: muestras.length,
    p50: Math.round(pct(50)),
    p95: Math.round(pct(95)),
    min: Math.round(muestras[0]),
    max: Math.round(muestras[muestras.length - 1]),
  };
  report.latencia = latencia;

  log(`   · search_read de 50 partners (${latencia.muestras} muestras)`);
  log(`     p50 ${latencia.p50} ms · p95 ${latencia.p95} ms · min ${latencia.min} ms · max ${latencia.max} ms`);

  if (latencia.p95 > 1000) {
    log('\n   ⚠ p95 por encima de 1 s. El cache de la Fase 4 deja de ser una');
    log('     optimización y pasa a ser un requisito.');
  }

  add({
    issue: '#6',
    pregunta: '¿Cuál es la latencia típica de Odoo?',
    respuesta: `p50 ${latencia.p50} ms, p95 ${latencia.p95} ms.` +
      (latencia.p95 > 1000 ? ' Alta: el cache es requisito, no optimización.' : ' Aceptable.'),
    status: latencia.p95 > 1000 ? 'warn' : 'ok',
    detalle: latencia,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Resumen
// ─────────────────────────────────────────────────────────────────────────────

const ICON: Record<Status, string> = { ok: '✓', warn: '⚠', fail: '✗', info: 'ℹ' };

function printSummary(): void {
  if (JSON_ONLY) return;

  console.log('\n' + '═'.repeat(78));
  console.log(' RESUMEN — respuestas para los issues de Fase 0');
  console.log('═'.repeat(78) + '\n');

  for (const f of findings) {
    if (f.issue === '-') continue;
    console.log(` ${ICON[f.status]}  ${f.issue}  ${f.pregunta}`);
    console.log(`     ${f.respuesta}\n`);
  }

  const fallos = findings.filter((f) => f.status === 'fail').length;
  const avisos = findings.filter((f) => f.status === 'warn').length;

  console.log('─'.repeat(78));
  console.log(` ${fallos} bloqueos · ${avisos} avisos · ${findings.length} comprobaciones`);
  if (fallos > 0) {
    console.log('\n Hay bloqueos. Resuélvelos antes de arrancar la Fase 1: son supuestos');
    console.log(' de la arquitectura que no se cumplen en la instancia real.');
  }
  console.log('─'.repeat(78));
}

async function main(): Promise<void> {
  if (!JSON_ONLY) {
    console.log('\n' + '═'.repeat(78));
    console.log(' ASTA · odoo-probe — reconocimiento de la instancia (solo lectura)');
    console.log('═'.repeat(78));
  }

  if (!(await probeConnection())) process.exit(1);

  const schemas = await probeSchemas();
  await probeClientTier(schemas);
  await probePrinterModel(schemas);
  await probePricelists();
  await probeVolume();
  await probeCoverage();
  await probeLatency();

  report.hallazgos = findings;

  const outPath = resolve(ROOT, 'docs/odoo-schema-snapshot.json');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');

  printSummary();

  if (JSON_ONLY) console.log(JSON.stringify(report, null, 2));
  else console.log(`\n Snapshot guardado en docs/odoo-schema-snapshot.json\n`);

  process.exit(findings.some((f) => f.status === 'fail') ? 2 : 0);
}

main().catch((error) => {
  console.error('\nError no controlado:', error);
  process.exit(1);
});
