import { writeFileSync, mkdirSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { searchRead } from '../apps/middleware/src/odoo/client.js';

/**
 * `pnpm backup:odoo` — copia de la configuración de Odoo que nos afecta (#48).
 *
 * ── Qué problema resuelve, y cuál NO ─────────────────────────────────────────
 *
 * Odoo es SaaS: los respaldos del servidor los hace Odoo, y recuperar la
 * instancia entera no es cosa nuestra. Esto no sustituye a eso.
 *
 * Lo que sí resuelve es otra cosa, más probable y peor de detectar: que alguien
 * cambie una tarifa en Odoo y nadie sepa cuál era antes. El sistema de niveles
 * de ASTA cuelga de `product.pricelist` —el nivel de un cliente se deriva de su
 * tarifa (#3)— así que una tarifa tocada cambia los precios que ve un cliente
 * por la API sin tocar una línea de código nuestro.
 *
 * Restaurar un respaldo completo de Odoo por un precio mal puesto no es
 * realista. Tener una copia fechada de cómo estaba sí permite ver qué cambió y
 * devolverlo a mano.
 *
 * ── El fichero NO se versiona ────────────────────────────────────────────────
 *
 * Lleva precios reales y nombres de tarifas de la empresa. Va a la misma carpeta
 * de respaldos que el volcado de MySQL, no al repositorio. Mismo criterio que
 * `docs/odoo-schema-snapshot.json`, que Lino sacó del repo con razón.
 */

interface Tarifa {
  id: number;
  name: string;
  currency_id: [number, string] | false;
  company_id: [number, string] | false;
  active?: boolean;
}

interface Linea {
  id: number;
  pricelist_id: [number, string] | false;
  applied_on: string;
  compute_price: string;
  fixed_price: number | false;
  percent_price: number | false;
  product_tmpl_id: [number, string] | false;
  categ_id: [number, string] | false;
  min_quantity: number | false;
  date_start: string | false;
  date_end: string | false;
}

async function main(): Promise<void> {
  const destino = process.env.ASTA_BACKUP_DIR ?? join(process.cwd(), 'backups');
  mkdirSync(destino, { recursive: true });

  // UTC en el nombre, igual que en respaldar.sh: la hora local retrocede una
  // hora en octubre y ordenar respaldos por un nombre que da marcha atrás es
  // una forma tonta de perder uno.
  const sello = new Date().toISOString().replace(/[:.]/g, '').replace(/-/g, '').slice(0, 15) + 'Z';
  const archivo = join(destino, `odoo-config-${sello}.json.gz`);

  console.log('\n  Copia de la configuración de tarifas de Odoo\n');

  /*
   * Se piden TAMBIÉN las archivadas.
   *
   * Odoo filtra por defecto las inactivas, y ese fue justo el fallo que
   * @LinoGouveia arregló en el probe (#5): la medición contaba tarifas
   * archivadas y salían números que no cuadraban. Aquí el criterio es el
   * contrario — para un respaldo interesa el estado COMPLETO, incluida una
   * tarifa recién archivada, porque archivar es precisamente uno de los cambios
   * que se querría poder deshacer.
   */
  const tarifas = await searchRead<Tarifa>(
    'product.pricelist',
    ['|', ['active', '=', true], ['active', '=', false]],
    ['id', 'name', 'currency_id', 'company_id', 'active'],
    { order: 'id asc' },
  );

  console.log(`  tarifas          ${tarifas.length}`);

  const lineas = await searchRead<Linea>(
    'product.pricelist.item',
    [['pricelist_id', 'in', tarifas.map((t) => t.id)]],
    [
      'id',
      'pricelist_id',
      'applied_on',
      'compute_price',
      'fixed_price',
      'percent_price',
      'product_tmpl_id',
      'categ_id',
      'min_quantity',
      'date_start',
      'date_end',
    ],
    { order: 'pricelist_id asc, id asc' },
  );

  console.log(`  reglas de precio ${lineas.length}`);

  /*
   * Cuántos clientes cuelgan de cada tarifa.
   *
   * No es configuración, es la consecuencia. Si mañana una tarifa aparece con
   * 0 clientes y en la copia de ayer tenía 2942, eso es el aviso — y sin este
   * recuento habría que reconstruirlo cliente a cliente.
   */
  const clientes = await searchRead<{ id: number; property_product_pricelist: [number, string] | false }>(
    'res.partner',
    [['customer_rank', '>', 0]],
    ['id', 'property_product_pricelist'],
  );

  const porTarifa = new Map<number, number>();
  for (const c of clientes) {
    if (!c.property_product_pricelist) continue;
    const id = c.property_product_pricelist[0];
    porTarifa.set(id, (porTarifa.get(id) ?? 0) + 1);
  }

  console.log(`  clientes         ${clientes.length}\n`);
  for (const t of tarifas) {
    const n = porTarifa.get(t.id) ?? 0;
    console.log(
      `    [${String(t.id).padEnd(6)}] ${t.name.padEnd(34)} ${String(n).padStart(5)} clientes` +
        (t.active === false ? '   (archivada)' : ''),
    );
  }

  const contenido = {
    generadoEn: new Date().toISOString(),
    // Sin URL ni base de datos: el fichero se traslada y se comparte, y esos dos
    // datos no aportan nada a la comparación.
    tarifas,
    reglasDePrecio: lineas,
    clientesPorTarifa: [...porTarifa.entries()].map(([tarifaId, clientes]) => ({
      tarifaId,
      clientes,
    })),
  };

  /*
   * Comprimido. No es un detalle menor: son unas 35.000 reglas de precio, ~16 MB
   * en JSON plano. Guardar eso a diario durante un año son casi 6 GB de un
   * fichero que cambia poco. En gzip baja más de un orden de magnitud, porque es
   * JSON muy repetitivo.
   */
  const plano = Buffer.from(JSON.stringify(contenido, null, 2), 'utf8');
  writeFileSync(archivo, gzipSync(plano, { level: 9 }));

  const mb = (n: number) => (n / 1024 / 1024).toFixed(1);
  console.log(`\n  Guardado en ${archivo}`);
  console.log(`  ${mb(statSync(archivo).size)} MB comprimido (${mb(plano.length)} MB en claro)`);
  console.log('  NO se versiona: lleva precios reales. Va con los respaldos de MySQL.\n');
  console.log('  Para ver qué cambió entre dos copias:');
  console.log('    diff <(gzip -dc vieja.json.gz | jq -S .) <(gzip -dc nueva.json.gz | jq -S .)\n');
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
