/**
 * Alta de las cuentas de VENDEDOR desde Odoo (#81).
 *
 * En desarrollo:
 *
 *   pnpm sync:vendedores             SIMULACRO: dice qué haría y no toca nada
 *   pnpm sync:vendedores --aplicar   crea y actualiza de verdad
 *
 * Dentro del contenedor:
 *
 *   node dist/cli/sync-vendedores.js [--aplicar]
 *
 * ── Por qué el simulacro es lo predeterminado ────────────────────────────────
 *
 * Los otros CLI actúan al invocarse. Este no: cada alta da acceso a la
 * facturación de una cartera entera, y el fallo no se ve —la cuenta funciona,
 * simplemente la tiene quien no debía—. Que el modo por defecto no escriba
 * obliga a leer la lista antes de concederla.
 *
 * No es un cron. Se ejecuta cuando entra o sale alguien del equipo comercial,
 * que es cuando hay un humano dispuesto a mirar quién aparece.
 */
import { sincronizarVendedores } from '../services/vendedores.service.js';
import { prisma } from '../config/prisma.js';

const n = (x: number) => String(x).padStart(5);
const bs = (x: number) => x.toLocaleString('es-VE', { maximumFractionDigits: 0 }).padStart(12);

async function main(): Promise<void> {
  const aplicar = process.argv.includes('--aplicar');

  console.log(
    `\n  Vendedores desde Odoo${aplicar ? ' — APLICANDO' : ' — SIMULACRO (nada se escribe)'}\n`,
  );

  const r = await sincronizarVendedores({ aplicar });

  console.log(`  duración   : ${(r.duracionMs / 1000).toFixed(1)} s\n`);
  console.log(`  ${n(r.candidatos)}  candidatos (usuarios con cartera asignada)`);
  console.log(`  ${n(r.aprobados)}  cumplen la regla`);
  console.log(`  ${n(r.creados)}  ${aplicar ? 'creados' : 'se crearían'}`);
  console.log(
    `  ${n(r.promovidos)}  ${aplicar ? 'promovidos' : 'se promoverían'} de cliente a vendedor`,
  );
  console.log(`  ${n(r.actualizados)}  ${aplicar ? 'actualizados' : 'se actualizarían'}`);
  console.log(`  ${n(r.sinCambios)}  sin cambios`);

  if (r.lista.length > 0) {
    console.log(`\n  ${aplicar ? 'CON ACCESO' : 'TENDRÍAN ACCESO'} (${r.lista.length}):\n`);
    console.log(`      ${'nombre'.padEnd(32)} ${'correo'.padEnd(30)} clientes     facturado`);
    for (const v of r.lista) {
      console.log(
        `      ${v.nombre.slice(0, 32).padEnd(32)} ${v.login.slice(0, 30).padEnd(30)} ${String(v.clientes).padStart(8)} ${bs(v.monto)}`,
      );
    }
  }

  // ── Avisos ────────────────────────────────────────────────────────────────
  // No impiden el alta, pero se conceden accesos que luego no funcionan si nadie
  // los lee: un correo que no es el que la persona espera, una cuenta apagada.
  if (r.avisos.length > 0) {
    console.log(`\n  AVISOS (${r.avisos.length}):\n`);
    for (const a of r.avisos) {
      console.log(`      ${a.nombre.trim()}`);
      console.log(`        ${a.texto}`);
    }
  }

  // ── Los descartes NO son ruido ────────────────────────────────────────────
  // Cada uno es una persona que no va a poder entrar al panel. Si el descarte
  // está mal, el sitio donde se arregla es Odoo, y para eso hay que verlo.
  if (r.descartados.length > 0) {
    const porMotivo = new Map<string, typeof r.descartados>();
    for (const d of r.descartados) {
      const g = porMotivo.get(d.motivo) ?? [];
      g.push(d);
      porMotivo.set(d.motivo, g);
    }

    console.log(`\n  DESCARTADOS (${r.descartados.length}):`);
    for (const [motivo, lista] of porMotivo) {
      console.log(`\n    ${motivo}  (${lista.length})`);
      for (const d of lista) {
        console.log(
          `      ${d.nombre.slice(0, 32).padEnd(32)} ${d.login.slice(0, 30).padEnd(30)} ${d.detalle ?? ''}`,
        );
      }
    }
  }

  /*
   * Quién tiene VENDEDOR hoy y ya no cumpliría.
   *
   * Se informa y no se toca: ver la nota del servicio. Retirar accesos por una
   * condición de datos dejaría al equipo comercial fuera del panel el día que
   * Odoo devuelva una cartera vacía por cualquier motivo.
   */
  if (r.yaNoCumplen.length > 0) {
    console.log(`\n  YA NO CUMPLEN la regla (${r.yaNoCumplen.length}) — NO se les ha tocado:`);
    for (const v of r.yaNoCumplen) {
      console.log(`      ${v.nombre.slice(0, 32).padEnd(32)} ${v.email}`);
    }
    console.log('\n    Si alguno ya no debe entrar, se desactiva a mano. Quitar un acceso');
    console.log('    es una decisión de una persona, no de una pasada de sincronización.');
  }

  if (!aplicar) {
    console.log('\n  ─────────────────────────────────────────────────────────────');
    console.log('  Esto fue un SIMULACRO. Para aplicarlo:');
    console.log('');
    console.log('      pnpm sync:vendedores --aplicar');
    console.log('  ─────────────────────────────────────────────────────────────');
  } else {
    /*
     * Tener el rol no es poder entrar.
     *
     * Una cuenta sin contraseña existe, sale en el panel de usuarios y falla el
     * login con un mensaje que no explica por qué — igual que el SuperAdmin de
     * `002_seed.sql`, que nace así a propósito. Y no son solo las nuevas: los
     * promocionados venían del sync de clientes, que tampoco crea credenciales.
     *
     * Sin este renglón, la pasada termina en verde y al día siguiente no entra
     * nadie.
     */
    // Las recién creadas ya están contadas: `sinContrasena` se calcula DESPUÉS
    // de escribir, así que aquí la lista está completa.
    const pendientes = r.sinContrasena.length;
    if (pendientes > 0) {
      console.log('\n  ─────────────────────────────────────────────────────────────');
      console.log(
        `  ${pendientes} de estas cuentas NO TIENEN CONTRASEÑA y todavía no pueden entrar.`,
      );
      console.log('');
      console.log('  Para cada una, una de las dos:');
      console.log('');
      console.log('      node dist/cli/set-password.js <correo>      (la pones tú)');
      console.log('      Panel → Usuarios → Invitar                  (la pone quien entra)');
      console.log('');
      for (const email of r.sinContrasena) console.log(`      · ${email}`);
      console.log('  ─────────────────────────────────────────────────────────────');
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
