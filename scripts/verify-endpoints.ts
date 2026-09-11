/**
 * Verificación del issue #21 — los endpoints del panel de vendedores.
 *
 *   pnpm verify:endpoints
 *
 * Arranca el servidor, le pega con datos reales de Odoo y comprueba tres cosas:
 *
 *   1. Autenticación y autorización (401, 403 cruzado, 200 propio)
 *   2. Que cada respuesta VALIDE contra el schema de @asta/shared-types
 *   3. Coherencia aritmética: los totales de `meta` deben ser la suma de `data`
 *
 * El punto 2 es el que importa. Un endpoint puede devolver 200 y datos que
 * parecen bien, pero faltarle un campo que el panel espera — pasó con
 * `esCliente`, que el controlador no mapeaba y nadie detectó hasta mirar el
 * JSON a mano. Validar contra el contrato convierte eso en un fallo automático.
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { z } from 'zod';
import {
  portfolioRowSchema,
  portfolioMetaSchema,
  invoicingSummarySchema,
  apiErrorSchema,
} from '../packages/shared-types/src/index.js';

const PORT = 3999;
const BASE = `http://localhost:${PORT}`;

let fallos = 0;
const ok = (m: string) => console.log(`   ✓ ${m}`);
const bad = (m: string) => { fallos++; console.log(`   ✗ ${m}`); };

const portfolioResponseSchema = z.object({
  data: z.array(portfolioRowSchema),
  meta: portfolioMetaSchema,
});

const invoicingResponseSchema = z.object({
  data: z.object({
    cliente: z.object({
      id: z.number().int().positive(),
      nombre: z.string().optional(),
      tier: z.string().nullable().optional(),
    }),
    facturacion: invoicingSummarySchema,
  }),
  meta: z.object({}).loose(),
});

interface Res { status: number; body: unknown }

async function get(path: string, headers: Record<string, string> = {}): Promise<Res> {
  const r = await fetch(BASE + path, { headers });
  const text = await r.text();
  let body: unknown;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: r.status, body };
}

/** Valida contra el contrato y reporta exactamente qué campo falla. */
function contrato<T extends z.ZodType>(schema: T, body: unknown, etiqueta: string): boolean {
  const r = schema.safeParse(body);
  if (r.success) { ok(`${etiqueta}: cumple el contrato de shared-types`); return true; }
  bad(`${etiqueta}: NO cumple el contrato`);
  for (const issue of r.error.issues.slice(0, 5)) {
    console.log(`        ${issue.path.join('.') || '(raíz)'}: ${issue.message}`);
  }
  return false;
}

/**
 * Falla si el puerto ya está ocupado, en vez de reutilizar lo que haya.
 *
 * Reutilizar es peor que fallar: el arnés se conectaría a un servidor arrancado
 * con OTRA versión del código y la prueba pasaría o fallaría según qué proceso
 * quedó vivo. Pasó de verdad — un servidor huérfano de una corrida anterior hizo
 * que una corrección ya aplicada siguiera apareciendo como fallo.
 */
async function assertPuertoLibre(): Promise<void> {
  try {
    await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(2000) });
  } catch {
    return; // nadie escucha: es lo que queremos
  }
  throw new Error(
    `El puerto ${PORT} ya está ocupado. Hay un servidor huérfano de una corrida ` +
      `anterior.
  Mátalo antes de repetir la prueba; si no, estarías midiendo otra ` +
      `versión del código.`,
  );
}

/** En Windows, spawn con shell:true deja el node hijo vivo al matar el proceso. */
function matarArbol(proc: ChildProcess): void {
  if (process.platform === 'win32' && proc.pid) {
    try {
      spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch { /* ya estaba muerto */ }
  }
  proc.kill('SIGKILL');
}

function startServer(): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      process.platform === 'win32' ? 'npx.cmd' : 'npx',
      ['tsx', 'apps/middleware/src/server.ts'],
      {
        env: { ...process.env, PORT: String(PORT), DEV_AUTH_ENABLED: 'true', LOG_LEVEL: 'silent' },
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
      },
    );

    const timer = setTimeout(() => reject(new Error('el servidor no arrancó en 60 s')), 60_000);
    const poll = setInterval(async () => {
      try {
        const r = await fetch(`${BASE}/health`);
        if (r.ok || r.status === 503) { clearTimeout(timer); clearInterval(poll); resolve(proc); }
      } catch { /* todavía no */ }
    }, 1000);

    proc.on('error', (e) => { clearTimeout(timer); clearInterval(poll); reject(e); });
  });
}

async function main(): Promise<void> {
  console.log('\n' + '='.repeat(78));
  console.log(' Verificacion #21 — endpoints del panel de vendedores');
  console.log('='.repeat(78));

  console.log('\n> Arrancando servidor...');
  await assertPuertoLibre();
  const proc = await startServer();
  ok(`servidor en ${BASE}`);

  try {
    // ── Descubrir dos vendedores reales con cartera ─────────────────────────
    console.log('\n> 0. Vendedores de prueba (datos reales de Odoo)\n');
    const h = await get('/health');
    if (h.status !== 200) bad(`/health devolvió ${h.status}`); else ok('/health en 200');

    const { readGroup } = await import('../apps/middleware/src/odoo/client.js');
    const vendedores = await readGroup<{ user_id: [number, string]; __count: number }>(
      'res.partner',
      [['customer_rank', '>', 0], ['user_id', '!=', false], ['parent_id', '=', false]],
      [],
      ['user_id'],
    );
    vendedores.sort((a, b) => b.__count - a.__count);
    if (vendedores.length < 2) { bad('hacen falta 2 vendedores con cartera'); return; }

    const [A, B] = vendedores;
    ok(`A = [${A.user_id[0]}] ${A.user_id[1]} (${A.__count} clientes)`);
    ok(`B = [${B.user_id[0]}] ${B.user_id[1]} (${B.__count} clientes)`);
    const authA = { 'X-Dev-Odoo-User-Id': String(A.user_id[0]) };

    // ── 1. Autenticación ────────────────────────────────────────────────────
    console.log('\n> 1. Autenticación\n');

    const sinAuth = await get('/api/v1/salesperson/portfolio');
    sinAuth.status === 401 ? ok('sin cabecera -> 401') : bad(`sin cabecera -> ${sinAuth.status}, esperaba 401`);
    contrato(apiErrorSchema, sinAuth.body, 'error 401');

    const malAuth = await get('/api/v1/salesperson/portfolio', { 'X-Dev-Odoo-User-Id': 'abc' });
    malAuth.status === 401 ? ok('id no numérico -> 401') : bad(`id no numérico -> ${malAuth.status}`);

    const inexistente = await get('/api/v1/salesperson/portfolio', { 'X-Dev-Odoo-User-Id': '99999999' });
    inexistente.status === 401 ? ok('usuario inexistente -> 401') : bad(`usuario inexistente -> ${inexistente.status}`);

    // ── 2. Cartera ──────────────────────────────────────────────────────────
    console.log('\n> 2. GET /portfolio\n');

    const t0 = performance.now();
    const port = await get('/api/v1/salesperson/portfolio', authA);
    const ms = Math.round(performance.now() - t0);

    if (port.status !== 200) { bad(`devolvió ${port.status}`); console.log(JSON.stringify(port.body).slice(0, 300)); }
    else {
      ok(`200 en ${ms} ms`);
      const valido = contrato(portfolioResponseSchema, port.body, 'portfolio');

      if (valido) {
        const p = portfolioResponseSchema.parse(port.body);
        ok(`${p.data.length} filas · total ${p.meta.totalCartera.toLocaleString('es-MX')}`);

        // Coherencia: meta debe ser la suma de data, no un número aparte.
        const suma = Math.round(p.data.reduce((s, r) => s + r.totalFacturado, 0) * 100) / 100;
        Math.abs(suma - p.meta.totalCartera) < 0.01
          ? ok('meta.totalCartera coincide con la suma de las filas')
          : bad(`meta dice ${p.meta.totalCartera} pero las filas suman ${suma}`);

        p.meta.clientes === p.data.length
          ? ok('meta.clientes coincide con el número de filas')
          : bad(`meta.clientes=${p.meta.clientes} vs ${p.data.length} filas`);

        // Orden descendente por facturación.
        const ordenado = p.data.every((r, i) => i === 0 || p.data[i - 1].totalFacturado >= r.totalFacturado);
        ordenado ? ok('ordenado por facturación descendente') : bad('el orden no es descendente');

        const cli = p.data.filter((r) => r.esCliente).length;
        ok(`${cli} clientes con historial · ${p.data.length - cli} prospectos`);
        if (cli === 0) bad('ningún esCliente=true: el campo no se está mapeando');

        // Ningún cliente debe aparecer dos veces.
        const ids = new Set(p.data.map((r) => r.id));
        ids.size === p.data.length ? ok('sin clientes duplicados') : bad(`${p.data.length - ids.size} duplicados`);

        if (ms > 4000) bad(`${ms} ms es demasiado para una pantalla`);
      }
    }

    // ── 3. Ficha de cliente ─────────────────────────────────────────────────
    console.log('\n> 3. GET /clients/:id/invoicing\n');

    const p = portfolioResponseSchema.safeParse(port.body);
    const conFactura = p.success ? p.data.data.find((r) => r.numeroFacturas > 0) : undefined;

    if (!conFactura) bad('ningún cliente con facturas para probar');
    else {
      const inv = await get(`/api/v1/salesperson/clients/${conFactura.id}/invoicing`, authA);
      if (inv.status !== 200) { bad(`devolvió ${inv.status}`); console.log(JSON.stringify(inv.body).slice(0, 300)); }
      else {
        ok(`200 para ${conFactura.nombre.slice(0, 36)}`);
        const valido = contrato(invoicingResponseSchema, inv.body, 'invoicing');

        if (valido) {
          const r = invoicingResponseSchema.parse(inv.body);
          const f = r.data.facturacion;
          ok(`total ${f.totalFacturado.toLocaleString('es-MX')} en ${f.numeroFacturas} facturas`);

          // El mismo cliente debe dar lo mismo en la tabla y en su ficha.
          Math.abs(f.totalFacturado - conFactura.totalFacturado) < 0.01
            ? ok('coincide con la fila de la cartera')
            : bad(`ficha ${f.totalFacturado} vs cartera ${conFactura.totalFacturado}`);

          Math.abs(f.cobrado - (f.totalFacturado - f.porCobrar)) < 0.01
            ? ok('cobrado = totalFacturado - porCobrar')
            : bad('la aritmética del resumen no cuadra');
        }

        // Serie mensual
        const serie = await get(`/api/v1/salesperson/clients/${conFactura.id}/invoicing?incluirSerieMensual=true`, authA);
        const s = invoicingResponseSchema.safeParse(serie.body);
        if (s.success && s.data.data.facturacion.serieMensual?.length) {
          const sm = s.data.data.facturacion.serieMensual;
          const sumaSerie = Math.round(sm.reduce((a, x) => a + x.monto, 0) * 100) / 100;
          Math.abs(sumaSerie - s.data.data.facturacion.totalFacturado) < 0.01
            ? ok(`serie mensual de ${sm.length} periodos, suma exacta`)
            : bad(`la serie suma ${sumaSerie} pero el total es ${s.data.data.facturacion.totalFacturado}`);
        } else bad('serieMensual vacía con incluirSerieMensual=true');
      }
    }

    // ── 4. Aislamiento entre carteras ───────────────────────────────────────
    console.log('\n> 4. Aislamiento entre vendedores (el gate de #25)\n');

    const carteraB = await get('/api/v1/salesperson/portfolio', {
      'X-Dev-Odoo-User-Id': String(B.user_id[0]),
    });
    const pb = portfolioResponseSchema.safeParse(carteraB.body);

    if (!pb.success || pb.data.data.length === 0) bad('no se pudo leer la cartera de B');
    else {
      const clienteDeB = pb.data.data[0];
      const cruce = await get(`/api/v1/salesperson/clients/${clienteDeB.id}/invoicing`, authA);

      if (cruce.status === 403) {
        ok(`A -> cliente de B -> 403`);
        const e = apiErrorSchema.safeParse(cruce.body);
        e.success && e.data.error.code === 'PARTNER_NOT_IN_PORTFOLIO'
          ? ok(`código correcto: PARTNER_NOT_IN_PORTFOLIO`)
          : bad(`código inesperado: ${JSON.stringify(cruce.body).slice(0, 120)}`);
      } else {
        bad(`FUGA DE DATOS: A accedió al cliente ${clienteDeB.id} de B con ${cruce.status}`);
      }

      // Y no debe haber solapamiento entre las dos carteras.
      if (p.success) {
        const idsA = new Set(p.data.data.map((r) => r.id));
        const solapan = pb.data.data.filter((r) => idsA.has(r.id));
        solapan.length === 0
          ? ok('las carteras de A y B no se solapan')
          : bad(`${solapan.length} clientes aparecen en ambas carteras`);
      }
    }

    // ── 5. Entradas inválidas ───────────────────────────────────────────────
    console.log('\n> 5. Entradas inválidas\n');

    const casos: Array<[string, number]> = [
      ['/api/v1/salesperson/clients/abc/invoicing', 400],
      ['/api/v1/salesperson/clients/-5/invoicing', 400],
      ['/api/v1/salesperson/clients/999999999/invoicing', 404],
      ['/api/v1/salesperson/no-existe', 404],
    ];
    for (const [path, esperado] of casos) {
      const r = await get(path, authA);
      r.status === esperado
        ? ok(`${path.replace('/api/v1/salesperson', '')} -> ${r.status}`)
        : bad(`${path.replace('/api/v1/salesperson', '')} -> ${r.status}, esperaba ${esperado}`);
    }

    const fechaMala = await get('/api/v1/salesperson/portfolio?desde=11-09-2026', authA);
    fechaMala.status === 400 ? ok('fecha en formato inválido -> 400') : bad(`fecha inválida -> ${fechaMala.status}`);
  } finally {
    matarArbol(proc);
  }

  console.log('\n' + '-'.repeat(78));
  console.log(` ${fallos} fallo(s)`);
  console.log('-'.repeat(78) + '\n');
  process.exit(fallos > 0 ? 1 : 0);
}

main().catch((e) => { console.error('\nError:', e); process.exit(1); });
