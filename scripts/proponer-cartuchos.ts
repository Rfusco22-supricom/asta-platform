/**
 * Propuestas "producto → cartucho" para revisión humana (#56, Fase 3).
 *
 *   pnpm cartuchos:proponer --salida propuestas.csv
 *
 * A un archivo y no a stdout: el logger del cliente de Odoo escribe en stdout
 * (un RPC lento deja un aviso), y se colaría entre las filas del CSV.
 *
 * Una fila por candidato de cada plantilla de CONSUMIBLES, ordenada por lo que
 * vendió en los últimos 12 meses: la revisión empieza por lo que más importa, que
 * es contra lo que #56 mide la cobertura (el top 20 es el 39 % del importe).
 *
 * Los productos sin candidato salen también, con el código vacío: son la cola de
 * captura manual.
 *
 * Solo lectura. Nada entra en `product_cartridges` desde aquí: cuando existan las
 * tablas de #101, lo validado se carga con `status = VALIDADA` y lo demás queda
 * como `PROPUESTA`.
 */
import { writeFileSync } from 'node:fs';
import { executeKw, searchRead } from '../apps/middleware/src/odoo/client.js';
import { extraerCartuchos } from '../apps/middleware/src/services/recomendador/extraerCartuchos.js';

const CATEGORIA_CONSUMIBLES = 2614;

const i = process.argv.indexOf('--salida');
const salida = i >= 0 ? process.argv[i + 1] : undefined;
if (!salida) {
  console.error('Uso: pnpm cartuchos:proponer --salida propuestas.csv');
  process.exit(2);
}

const hace12Meses = new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString().slice(0, 10);

const plantillas = await searchRead<{ id: number; name: string; default_code: string | false }>(
  'product.template',
  [['sale_ok', '=', true], ['categ_id', 'child_of', CATEGORIA_CONSUMIBLES]],
  ['name', 'default_code'],
);

// Ventas por variante (read_group no agrupa por plantilla) y luego a su plantilla.
const ventas = await executeKw<Array<{ product_id: [number, string]; price_subtotal: number }>>(
  'sale.order.line',
  'read_group',
  [
    [['state', 'in', ['sale', 'done']], ['product_id.categ_id', 'child_of', CATEGORIA_CONSUMIBLES], ['order_id.date_order', '>=', hace12Meses]],
    ['price_subtotal:sum'],
    ['product_id'],
  ],
  { lazy: false },
);
const variantes = await searchRead<{ id: number; product_tmpl_id: [number, string] }>(
  'product.product',
  [['id', 'in', ventas.map((v) => v.product_id[0])]],
  ['product_tmpl_id'],
  { context: { active_test: false } },
);
const plantillaDe = new Map(variantes.map((v) => [v.id, v.product_tmpl_id[0]]));
const importe = new Map<number, number>();
for (const v of ventas) {
  const t = plantillaDe.get(v.product_id[0]);
  if (t) importe.set(t, (importe.get(t) ?? 0) + v.price_subtotal);
}

const csv = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
const lineas = ['odoo_product_tmpl_id,default_code,nombre,importe_12m,marca,codigo,evidencia'];

for (const p of plantillas.sort((a, b) => (importe.get(b.id) ?? 0) - (importe.get(a.id) ?? 0))) {
  const base = [p.id, p.default_code || '', p.name, Math.round(importe.get(p.id) ?? 0)];
  const candidatos = extraerCartuchos(p.name, p.default_code || null);
  if (candidatos.length === 0) lineas.push([...base, '', '', ''].map(csv).join(','));
  for (const c of candidatos) lineas.push([...base, c.marca, c.codigo, c.evidencia].map(csv).join(','));
}

writeFileSync(salida, `${lineas.join('\n')}\n`);
const sinCandidato = plantillas.filter((p) => extraerCartuchos(p.name, p.default_code || null).length === 0).length;
console.log(`${salida}: ${plantillas.length} plantillas · ${plantillas.length - sinCandidato} con candidato · ${sinCandidato} para captura manual`);
process.exit(0);
