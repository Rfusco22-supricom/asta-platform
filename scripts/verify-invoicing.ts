/**
 * Verificación del issue #20 — los servicios de facturación contra Odoo real.
 *
 *   pnpm verify:invoicing
 *
 * No basta con que el código corra sin excepciones. El criterio de aceptación
 * del issue es que **los números coincidan con Odoo al centavo**, porque si el
 * panel y el ERP dan cifras distintas el vendedor deja de confiar en el panel y
 * la herramienta muere ahí.
 *
 * Por eso cada total del servicio se contrasta contra una consulta independiente
 * a Odoo, calculada por otra vía (traer las facturas y sumarlas a mano). Si las
 * dos rutas coinciden, el `read_group` está bien armado.
 *
 * Solo lectura.
 */

import {
  getPartnerInvoicingSummary,
  getInvoicingTotalsByPartner,
} from '../apps/middleware/src/services/invoicing.service.js';
import {
  getPartnersBySalesperson,
  getPartner,
  assertSalespersonOwnsPartner,
  ForbiddenPartnerAccess,
} from '../apps/middleware/src/services/partners.service.js';
import { searchRead, readGroup, executeKw } from '../apps/middleware/src/odoo/client.js';

let fallos = 0;
let avisos = 0;

const ok = (m: string) => console.log(`   ✓ ${m}`);
const bad = (m: string) => { fallos++; console.log(`   ✗ ${m}`); };
const warn = (m: string) => { avisos++; console.log(`   ⚠ ${m}`); };
const money = (n: number) => n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Dos floats de Odoo nunca son bit-idénticos; 1 centavo es la tolerancia real. */
const igual = (a: number, b: number) => Math.abs(a - b) < 0.01;

async function main(): Promise<void> {
  console.log('\n' + '='.repeat(78));
  console.log(' Verificacion #20 — invoicing.service.ts y partners.service.ts');
  console.log('='.repeat(78));

  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n> 1. partners.service.ts ya no explota con x_client_tier\n');

  const conFacturas = await readGroup<{ commercial_partner_id: [number, string]; __count: number }>(
    'account.move',
    [['move_type', '=', 'out_invoice'], ['state', '=', 'posted']],
    [],
    ['commercial_partner_id'],
  );
  conFacturas.sort((a, b) => b.__count - a.__count);

  const muestra = conFacturas.slice(0, 5).map((g) => g.commercial_partner_id[0]);
  const partnerTop = muestra[0];

  try {
    const p = await getPartner(partnerTop);
    if (!p) { bad(`getPartner(${partnerTop}) devolvio null`); return; }
    ok(`getPartner(${partnerTop}) -> ${p.nombre}`);
    ok(`  tarifa: ${p.tier ?? '(sin tarifa)'} [id ${p.pricelistId ?? '-'}] -> tier ${p.tierDerivado}`);
    ok(`  vendedor: ${p.vendedorNombre ?? '(sin asignar)'} [uid ${p.vendedorOdooUserId ?? '-'}]`);
    if (p.tarifaSinMapear) warn(`  su tarifa ${p.pricelistId} no esta en TIER_BY_PRICELIST`);
  } catch (e) {
    bad(`getPartner lanzo: ${(e as Error).message.slice(0, 160)}`);
  }

  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n> 2. Totales del servicio vs. suma manual de facturas\n');
  console.log('   Se contrastan dos rutas independientes: read_group (servicio)');
  console.log('   contra traer las facturas y sumarlas en JS (control).\n');

  for (const partnerId of muestra) {
    const resumen = await getPartnerInvoicingSummary(partnerId);

    // Ruta de control: mismas facturas, suma a mano.
    const hijos = await executeKw<number[]>('res.partner', 'search', [[['id', 'child_of', partnerId]]]);
    const facturas = await searchRead<{ amount_total_signed: number; amount_residual_signed: number }>(
      'account.move',
      [
        ['partner_id', 'in', hijos],
        ['move_type', '=', 'out_invoice'],
        ['state', '=', 'posted'],
      ],
      ['amount_total_signed', 'amount_residual_signed'],
    );

    const totalManual = facturas.reduce((s, f) => s + (f.amount_total_signed ?? 0), 0);
    const saldoManual = facturas.reduce((s, f) => s + (f.amount_residual_signed ?? 0), 0);

    const p = await getPartner(partnerId);
    console.log(`   ${p?.nombre?.slice(0, 46) ?? partnerId}`);
    console.log(`     servicio: ${money(resumen.totalFacturado).padStart(14)} en ${resumen.numeroFacturas} facturas`);
    console.log(`     control:  ${money(totalManual).padStart(14)} en ${facturas.length} facturas`);

    if (resumen.numeroFacturas !== facturas.length) {
      bad(`     conteo distinto: ${resumen.numeroFacturas} vs ${facturas.length}`);
    } else if (!igual(resumen.totalFacturado, totalManual)) {
      bad(`     total distinto: diferencia ${money(Math.abs(resumen.totalFacturado - totalManual))}`);
    } else if (!igual(resumen.porCobrar, saldoManual)) {
      bad(`     saldo distinto: ${money(resumen.porCobrar)} vs ${money(saldoManual)}`);
    } else {
      ok(`     coincide al centavo · por cobrar ${money(resumen.porCobrar)}`);
    }

    // Invariante aritmético del propio resumen.
    if (!igual(resumen.cobrado, resumen.totalFacturado - resumen.porCobrar)) {
      bad('     cobrado != totalFacturado - porCobrar');
    }
    console.log('');
  }

  // ───────────────────────────────────────────────────────────────────────────
  console.log('> 3. child_of incluye sucursales (el bug clasico)\n');

  const conHijos = await searchRead<{ id: number; name: string; parent_id: [number, string] }>(
    'res.partner',
    [['parent_id', '!=', false], ['customer_rank', '>', 0]],
    ['id', 'name', 'parent_id'],
    { limit: 40 },
  );

  let probado = false;
  for (const hijo of conHijos) {
    const matrizId = hijo.parent_id[0];
    const facturasHijo = await executeKw<number>('account.move', 'search_count', [[
      ['partner_id', '=', hijo.id],
      ['move_type', '=', 'out_invoice'],
      ['state', '=', 'posted'],
    ]]);
    if (facturasHijo === 0) continue;

    const conChildOf = await getPartnerInvoicingSummary(matrizId);
    const soloMatriz = await searchRead<{ amount_total_signed: number }>(
      'account.move',
      [['partner_id', '=', matrizId], ['move_type', '=', 'out_invoice'], ['state', '=', 'posted']],
      ['amount_total_signed'],
    );
    const totalSoloMatriz = soloMatriz.reduce((s, f) => s + (f.amount_total_signed ?? 0), 0);

    console.log(`   matriz "${hijo.parent_id[1].slice(0, 40)}"`);
    console.log(`     con child_of: ${money(conChildOf.totalFacturado)} (${conChildOf.numeroFacturas} facturas)`);
    console.log(`     solo matriz:  ${money(totalSoloMatriz)} (${soloMatriz.length} facturas)`);

    if (conChildOf.numeroFacturas > soloMatriz.length) {
      ok(`     child_of suma ${conChildOf.numeroFacturas - soloMatriz.length} facturas de sucursales`);
    } else {
      warn('     no hubo diferencia en este caso');
    }
    probado = true;
    break;
  }
  if (!probado) warn('   No se encontro una matriz con facturas en sucursales para probarlo');

  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n> 4. Cartera de un vendedor en 2 RPC, no 2 por cliente\n');

  const vendedores = await readGroup<{ user_id: [number, string]; __count: number }>(
    'res.partner',
    [['customer_rank', '>', 0], ['user_id', '!=', false], ['parent_id', '=', false]],
    [],
    ['user_id'],
  );
  vendedores.sort((a, b) => b.__count - a.__count);

  if (vendedores.length === 0) {
    warn('   Ningun cliente tiene vendedor asignado (user_id). El modulo no tiene');
    warn('   datos sobre los que operar: hay que asignar carteras en Odoo.');
  } else {
    console.log(`   ${vendedores.length} vendedores con cartera. Mayores:`);
    for (const v of vendedores.slice(0, 5)) {
      console.log(`     ${String(v.__count).padStart(5)} clientes -> [${v.user_id[0]}] ${v.user_id[1]}`);
    }

    const uid = vendedores[0].user_id[0];
    const t0 = performance.now();
    const cartera = await getPartnersBySalesperson(uid);
    const totales = await getInvoicingTotalsByPartner(cartera.map((c) => c.id));
    const ms = Math.round(performance.now() - t0);

    const conFactura = [...totales.values()].filter((t) => t.facturas > 0).length;
    const suma = [...totales.values()].reduce((s, t) => s + t.total, 0);

    ok(`cartera de ${cartera.length} clientes resuelta en ${ms} ms`);
    ok(`  ${conFactura} con facturacion · total cartera ${money(suma)}`);

    if (cartera.length !== totales.size) {
      bad(`  totales.size=${totales.size} != cartera=${cartera.length} (faltan ceros de relleno)`);
    } else {
      ok('  todos los clientes tienen fila, incluidos los de 0 facturas');
    }

    if (ms > 4000) warn(`  ${ms} ms es lento para una pantalla. Revisar antes del panel.`);

    // El lote usa `commercial_partner_id in [...]` por rendimiento, mientras que
    // el resumen individual usa `partner_id child_of`. Son dos rutas distintas
    // calculando el mismo dinero: si divergen, la tabla de cartera y la ficha
    // del cliente mostrarian cifras que no cuadran entre si.
    console.log('\n   Lote vs. individual (la optimizacion no debe cambiar numeros):');
    const conMovimiento = cartera.filter((c) => (totales.get(c.id)?.facturas ?? 0) > 0).slice(0, 5);

    for (const cliente of conMovimiento) {
      const lote = totales.get(cliente.id)!;
      const individual = await getPartnerInvoicingSummary(cliente.id);

      if (!igual(lote.total, individual.totalFacturado) || lote.facturas !== individual.numeroFacturas) {
        bad(`     ${cliente.nombre.slice(0, 34)}: lote ${money(lote.total)}/${lote.facturas} != individual ${money(individual.totalFacturado)}/${individual.numeroFacturas}`);
      } else {
        ok(`     ${cliente.nombre.slice(0, 34).padEnd(36)} ${money(lote.total).padStart(13)} coincide`);
      }
    }

    const prospectos = cartera.filter((c) => !c.esCliente).length;
    console.log('');
    ok(`${cartera.length - prospectos} clientes con historial · ${prospectos} prospectos asignados`);
  }

  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n> 5. Autorizacion: un vendedor no puede ver cartera ajena\n');

  if (vendedores.length >= 2) {
    const vendedorA = vendedores[0].user_id[0];
    const carteraB = await getPartnersBySalesperson(vendedores[1].user_id[0]);

    if (carteraB.length === 0) {
      warn('   El segundo vendedor no tiene clientes; no se puede probar el cruce');
    } else {
      const clienteDeB = carteraB[0];
      try {
        await assertSalespersonOwnsPartner(vendedorA, clienteDeB.id);
        bad(`   FUGA: el vendedor ${vendedorA} accedio al cliente ${clienteDeB.id} de otro vendedor`);
      } catch (e) {
        if (e instanceof ForbiddenPartnerAccess) {
          ok(`vendedor ${vendedorA} -> cliente de otro -> 403 ${e.code}`);
        } else {
          bad(`   lanzo el error equivocado: ${(e as Error).name}`);
        }
      }

      const propio = await getPartnersBySalesperson(vendedorA);
      if (propio.length > 0) {
        try {
          await assertSalespersonOwnsPartner(vendedorA, propio[0].id);
          ok(`vendedor ${vendedorA} -> cliente propio -> permitido`);
        } catch {
          bad('   rechazo a un vendedor pidiendo SU PROPIO cliente');
        }
      }
    }
  } else {
    warn('   Hacen falta 2 vendedores con cartera para probar el cruce');
  }

  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n> 6. Notas de credito: el criterio del issue #26\n');

  const sinNC = await getPartnerInvoicingSummary(partnerTop, { incluirNotasDeCredito: false });
  const conNC = await getPartnerInvoicingSummary(partnerTop, { incluirNotasDeCredito: true });
  const delta = sinNC.totalFacturado - conNC.totalFacturado;

  console.log(`   sin notas de credito: ${money(sinNC.totalFacturado)} (${sinNC.numeroFacturas} docs)`);
  console.log(`   con notas de credito: ${money(conNC.totalFacturado)} (${conNC.numeroFacturas} docs)`);

  if (Math.abs(delta) < 0.01) {
    ok('este cliente no tiene devoluciones: el criterio no cambia su cifra');
  } else {
    const pct = ((Math.abs(delta) / sinNC.totalFacturado) * 100).toFixed(1);
    warn(`la diferencia es ${money(Math.abs(delta))} (${pct}%). El issue #26 no es teorico.`);
  }

  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n> 7. Serie mensual\n');

  const conSerie = await getPartnerInvoicingSummary(partnerTop, { incluirSerieMensual: true });
  if (!conSerie.serieMensual?.length) {
    bad('   serieMensual vino vacia');
  } else {
    ok(`${conSerie.serieMensual.length} periodos`);
    const sumaSerie = conSerie.serieMensual.reduce((s, p) => s + p.monto, 0);
    if (igual(sumaSerie, conSerie.totalFacturado)) {
      ok('  la serie suma exactamente el total');
    } else {
      bad(`  la serie suma ${money(sumaSerie)} pero el total es ${money(conSerie.totalFacturado)}`);
    }
    for (const p of conSerie.serieMensual.slice(-3)) {
      console.log(`     ${p.periodo.padEnd(18)} ${money(p.monto).padStart(14)}  (${p.facturas})`);
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n' + '-'.repeat(78));
  console.log(` ${fallos} fallos · ${avisos} avisos`);
  console.log('-'.repeat(78) + '\n');
  process.exit(fallos > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('\nError no controlado:', e);
  process.exit(1);
});
