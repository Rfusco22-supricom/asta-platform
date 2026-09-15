/**
 * Sincroniza res.partner -> app_users.
 *
 * En desarrollo:
 *
 *   pnpm sync:partners             incremental (solo lo que cambió)
 *   pnpm sync:partners --completo  relee TODO, ignorando la marca de agua
 *   pnpm sync:partners --huerfanos revisa qué usuarios perdieron su partner
 *
 * Dentro del contenedor:
 *
 *   node dist/cli/sync-partners.js [--completo|--huerfanos]
 *
 * Pensado para un cron cada 15 minutos. También hay un endpoint para el
 * SuperAdmin, pero para una tarea programada un proceso suelto es más simple
 * que mantener viva una llamada HTTP.
 *
 * ── Por qué vive AQUÍ y no en `scripts/` ─────────────────────────────────────
 *
 * Estaba en `scripts/`, fuera de `apps/middleware/src`, así que no entraba en el
 * bundle y no había forma de ejecutarlo desde el contenedor. En un despliegue
 * recién hecho eso importa más de lo que parece: sin sincronizar, la base solo
 * tiene el SuperAdmin del seed y el panel de vendedores no tiene a quién
 * enseñárselo.
 *
 * El mismo tropiezo que el CLI de contraseñas (#74), que también se descubrió
 * con el contenedor ya construido.
 */
import { marcarHuerfanos, sincronizarPartners } from '../services/sync.service.js';
import { prisma } from '../config/prisma.js';

const n = (x: number) => String(x).padStart(5);

async function main(): Promise<void> {
  const completo = process.argv.includes('--completo');
  const soloHuerfanos = process.argv.includes('--huerfanos');

  if (soloHuerfanos) {
    const r = await marcarHuerfanos();
    console.log(`\n  ${r.revisados} usuarios revisados · ${r.huerfanos} huérfanos marcados\n`);
    await prisma.$disconnect();
    return;
  }

  console.log(`\n  Sincronizando res.partner${completo ? ' (COMPLETO)' : ' (incremental)'}...\n`);

  const r = await sincronizarPartners({ completo });

  console.log(`  desde write_date : ${r.desde ?? '(primera vez)'}`);
  console.log(`  hasta write_date : ${r.hasta ?? '-'}`);
  console.log(`  duración         : ${(r.duracionMs / 1000).toFixed(1)} s\n`);
  console.log(`  ${n(r.leidos)}  leídos de Odoo`);
  console.log(`  ${n(r.creados)}  creados`);
  console.log(`  ${n(r.actualizados)}  actualizados`);
  console.log(`  ${n(r.sinCambios)}  sin cambios`);
  console.log(`  ${n(r.omitidosSinEmail)}  omitidos: sin email`);
  console.log(`  ${n(r.omitidosEmailInvalido)}  omitidos: email con formato inválido`);
  console.log(`  ${n(r.omitidosEmailEnUso)}  omitidos: el email ya lo usa otro partner`);
  console.log(`  ${n(r.fallidos)}  fallidos`);

  // Las incidencias NO son ruido: cada una es un cliente que no podrá entrar al
  // panel. Se muestran para que alguien pueda actuar sobre ellas en Odoo.
  const porMotivo = new Map<string, typeof r.incidencias>();
  for (const i of r.incidencias) {
    const g = porMotivo.get(i.motivo) ?? [];
    g.push(i);
    porMotivo.set(i.motivo, g);
  }

  if (r.fallidos > 0) {
    console.log('\n  FALLIDOS (revisar):');
    for (const i of porMotivo.get('FALLIDO') ?? []) {
      console.log(`    ${i.odooPartnerId}  ${i.nombre.slice(0, 40)}  ${i.detalle ?? ''}`);
    }
  }

  const enUso = porMotivo.get('OMITIDO_EMAIL_EN_USO') ?? [];
  if (enUso.length > 0) {
    console.log(`\n  Correos compartidos (${enUso.length}). Muestra:`);
    for (const i of enUso.slice(0, 5)) {
      console.log(`    ${i.odooPartnerId}  ${i.nombre.slice(0, 34)}  ${i.detalle ?? ''}`);
    }
    console.log('\n    Son sobre todo grupos de empresas con un correo de facturación');
    console.log('    común, no duplicados sucios. Hoy solo uno puede tener cuenta:');
    console.log('    romper el 1:1 usuario-partner es una decisión de producto.');
  }

  const invalidos = porMotivo.get('OMITIDO_EMAIL_INVALIDO') ?? [];
  if (invalidos.length > 0) {
    console.log(`\n  Correos mal escritos en Odoo (${invalidos.length}). Se arreglan allí:`);
    for (const i of invalidos.slice(0, 8)) {
      console.log(`    ${i.odooPartnerId}  ${JSON.stringify(i.detalle)}  ${i.nombre.slice(0, 30)}`);
    }
  }

  console.log('');
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('\n ', e instanceof Error ? e.message : e, '\n');
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
