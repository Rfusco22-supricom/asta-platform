// Solo para poner el .env en process.env. No valida nada ni lanza (issue #9).
import '../apps/middleware/src/config/dotenv.js';
import { writeFileSync } from 'node:fs';
import { searchRead, readGroup } from '../apps/middleware/src/odoo/client.js';
import { agrupar, gruposParaCubrir, resumir, type Grupo, type Registro } from './lib/duplicados.js';

/**
 * `pnpm analizar:duplicados` — la lista de fusiones que de verdad importan (#50).
 *
 * ── Por qué este informe y no el número del issue ────────────────────────────
 *
 * El issue dice "61,8% de los registros de cliente están duplicados". Es cierto y
 * no se puede hacer nada con él: suena a una migración de semanas, y por eso
 * lleva meses parado.
 *
 * La mayoría de esos duplicados son inofensivos —registros sin una sola factura,
 * o grupos donde toda la facturación está en un único sitio— y el panel muestra
 * la cifra correcta. Lo que rompe el panel es mucho más pequeño: los grupos con
 * la facturación REPARTIDA. Ahí el vendedor abre un cliente y ve una fracción de
 * la relación comercial, con un número exacto para ese registro y falso como
 * retrato del cliente.
 *
 * Esto separa lo uno de lo otro y ordena por dinero, para que la pregunta deje
 * de ser "cómo arreglamos 2591 duplicados" y pase a ser "fusiona estos veinte".
 *
 * ── Lo que NO hace ───────────────────────────────────────────────────────────
 *
 * No modifica nada en Odoo. Fusionar dos clientes no se deshace y toca
 * facturación emitida: es una decisión de negocio y una operación manual, hecha
 * por alguien que conoce a los clientes. Esto solo dice por dónde empezar.
 */

const ESCRIBIR_CSV = process.argv.includes('--csv');
const TOP = 25;

const dinero = (n: number) =>
  n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function main(): Promise<void> {
  console.log('\n  Analizando clientes duplicados en Odoo…\n');

  /*
   * Solo clientes de PRIMER NIVEL y activos.
   *
   * Las sucursales (`parent_id != false`) no son duplicados: son parte legítima
   * de la estructura de un cliente, y el panel ya las consolida bajo la matriz
   * con `child_of`. Incluirlas llenaría el informe de falsos positivos.
   */
  const partners = await searchRead<{
    id: number;
    name: string;
    vat: string | false;
    user_id: [number, string] | false;
  }>(
    'res.partner',
    [
      ['customer_rank', '>', 0],
      ['parent_id', '=', false],
      ['active', '=', true],
    ],
    ['id', 'name', 'vat', 'user_id'],
  );

  // Facturación por partner comercial, en UNA consulta agrupada y no una por
  // cliente: son casi 3000 y a un RPC cada uno esto no terminaría.
  const grupos = await readGroup<{
    commercial_partner_id: [number, string] | false;
    amount_total_signed: number;
    __count: number;
  }>(
    'account.move',
    [
      ['move_type', '=', 'out_invoice'],
      ['state', '=', 'posted'],
    ],
    ['amount_total_signed:sum'],
    ['commercial_partner_id'],
  );

  const facturacion = new Map<number, { monto: number; facturas: number }>();
  for (const g of grupos) {
    if (!g.commercial_partner_id) continue;
    facturacion.set(g.commercial_partner_id[0], {
      monto: g.amount_total_signed ?? 0,
      facturas: g.__count,
    });
  }

  const registros: Registro[] = partners.map((p) => {
    const f = facturacion.get(p.id);
    return {
      id: p.id,
      nombre: p.name,
      rif: p.vat || null,
      vendedorId: p.user_id ? p.user_id[0] : null,
      vendedor: p.user_id ? p.user_id[1] : null,
      facturas: f?.facturas ?? 0,
      monto: f?.monto ?? 0,
    };
  });

  const todos = agrupar(registros);
  const r = resumir(todos, registros);
  const partidos = todos.filter((g) => g.clase === 'partido');

  // ── Resumen ───────────────────────────────────────────────────────────────
  console.log(`  clientes activos de primer nivel : ${r.registros}`);
  console.log(`  grupos duplicados                : ${r.grupos}\n`);
  console.log(`    sin facturas en ninguno        : ${String(r.sinFacturas).padStart(4)}   (ruido)`);
  console.log(`    con facturas en UN registro    : ${String(r.inocuos).padStart(4)}   (inocuo: el panel muestra bien)`);
  console.log(`    con facturas REPARTIDAS        : ${String(r.partidos).padStart(4)}   <-- aquí se rompe el panel\n`);

  const pct = r.montoTotalFacturado > 0 ? (r.montoPartido / r.montoTotalFacturado) * 100 : 0;
  console.log(`  facturado total              : ${dinero(r.montoTotalFacturado)}`);
  console.log(`  atrapado en grupos partidos  : ${dinero(r.montoPartido)}  (${pct.toFixed(1)} %)\n`);

  if (partidos.length === 0) {
    console.log('  No hay ningún cliente con la facturación repartida. Nada que fusionar.\n');
    return;
  }

  /*
   * El número que convierte esto en algo que alguien puede hacer un martes.
   *
   * "Hay 85 grupos rotos" no mueve a nadie. "Con 20 fusiones arreglas el 90 %
   * del dinero mal atribuido" sí, porque es una tarea con final.
   */
  for (const objetivo of [50, 80, 90, 95]) {
    console.log(
      `    ${String(gruposParaCubrir(todos, objetivo)).padStart(3)} fusiones cubren el ${objetivo} % del dinero repartido`,
    );
  }

  if (r.partidosEntreVendedores > 0) {
    console.log(
      `\n  OJO: ${r.partidosEntreVendedores} de esos grupos tienen registros de VENDEDORES DISTINTOS.`,
    );
    console.log('  Fusionarlos mueve facturación —y comisión— de una cartera a otra.');
    console.log('  Es una conversación que hay que tener antes, no después.');
  }

  // ── Detalle ───────────────────────────────────────────────────────────────
  console.log(`\n  ── LOS ${Math.min(TOP, partidos.length)} PRIMEROS ────────────────────────────────────────────\n`);

  for (const [i, g] of partidos.slice(0, TOP).entries()) {
    const marca = g.motivo === 'rif' ? 'RIF' : 'nombre';
    const conflicto = g.vendedores.length > 1 ? '  ⚠ vendedores distintos' : '';

    console.log(
      `  ${String(i + 1).padStart(3)}. ${dinero(g.montoTotal).padStart(14)}   ` +
        `${g.conFacturas}/${g.registros.length} con facturas   [${marca}]${conflicto}`,
    );
    console.log(`       ${g.registros[0].nombre.slice(0, 60)}`);

    for (const reg of g.registros) {
      const destino = reg.id === g.principal ? '←  fusionar AQUÍ' : '';
      console.log(
        `         id ${String(reg.id).padEnd(8)} ${dinero(reg.monto).padStart(14)}  ` +
          `${String(reg.facturas).padStart(4)} fact.  ${(reg.vendedor ?? 'sin vendedor').padEnd(22)} ${destino}`,
      );
    }
    console.log('');
  }

  if (partidos.length > TOP) {
    console.log(`  … y ${partidos.length - TOP} grupos partidos más.\n`);
  }

  // ── CSV ───────────────────────────────────────────────────────────────────
  //
  // Para quien vaya a hacer las fusiones en Odoo, que trabajará con una hoja de
  // cálculo abierta al lado y no con la salida de una terminal.
  if (ESCRIBIR_CSV) {
    const filas = [
      'grupo,motivo,cliente,monto_total,registros,con_facturas,id_registro,monto,facturas,vendedor,es_destino',
    ];

    for (const [i, g] of partidos.entries()) {
      for (const reg of g.registros) {
        filas.push(
          [
            i + 1,
            g.motivo,
            // Las comillas dobles dentro de un campo CSV se escapan doblándolas.
            `"${g.registros[0].nombre.replace(/"/g, '""')}"`,
            g.montoTotal.toFixed(2),
            g.registros.length,
            g.conFacturas,
            reg.id,
            reg.monto.toFixed(2),
            reg.facturas,
            `"${(reg.vendedor ?? '').replace(/"/g, '""')}"`,
            reg.id === g.principal ? 'si' : 'no',
          ].join(','),
        );
      }
    }

    // Va a la carpeta de respaldos, que está fuera del repositorio: lleva
    // nombres de clientes reales y su facturación.
    const destino = process.env.ASTA_BACKUP_DIR ?? 'backups';
    const archivo = `${destino}/duplicados-${new Date().toISOString().slice(0, 10)}.csv`;
    writeFileSync(archivo, '﻿' + filas.join('\n'), 'utf8');
    console.log(`  CSV en ${archivo}  (${filas.length - 1} filas)`);
    console.log('  NO se versiona: lleva nombres de clientes y su facturación.\n');
  } else {
    console.log('  Con --csv se escribe la lista completa para trabajarla en una hoja.\n');
  }

  /*
   * Sale con 0 SIEMPRE.
   *
   * Es un informe para decidir, no una comprobación que pase o falle. Que haya
   * duplicados es el estado conocido de los datos desde hace meses; devolver
   * error haría que cualquier automatismo que lo llame fallara siempre, y en dos
   * semanas alguien lo quitaría del cron.
   */
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
