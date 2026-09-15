/**
 * Keys que aún no han pasado al pepper nuevo durante una rotación (#45).
 *
 *   pnpm keys:pendientes --desde 2026-09-15T14:00:00Z
 *
 * `--desde` es el momento en que se desplegó la rotación, en UTC; el runbook
 * pide anotarlo. Lista, por dueño, las keys activas creadas antes de esa fecha
 * que no se han usado desde entonces: las que dejarán de funcionar al quitar
 * `API_KEY_PEPPER_ANTERIOR`. Son los destinatarios del aviso.
 *
 * Solo lectura.
 */
import '../apps/middleware/src/config/dotenv.js';
import { prisma } from '../apps/middleware/src/config/prisma.js';
import { keysPendientesDeRotacion } from '../apps/middleware/src/services/apiKey.service.js';

function argumentoDesde(): Date {
  const i = process.argv.indexOf('--desde');
  const valor = i >= 0 ? process.argv[i + 1] : undefined;
  const fecha = valor ? new Date(valor) : new Date(NaN);
  if (!valor || Number.isNaN(fecha.getTime())) {
    console.error('Uso: pnpm keys:pendientes --desde <fecha ISO de la rotación, en UTC>');
    process.exit(2);
  }
  if (fecha > new Date()) {
    console.error(`--desde ${fecha.toISOString()} está en el futuro: ¿la hora es UTC?`);
    process.exit(2);
  }
  return fecha;
}

const desde = argumentoDesde();
const pendientes = await keysPendientesDeRotacion(desde);

if (pendientes.length === 0) {
  console.log(`Ninguna key pendiente desde ${desde.toISOString()}. Se puede quitar API_KEY_PEPPER_ANTERIOR.`);
} else {
  const porDueno = new Map<string, typeof pendientes>();
  for (const k of pendientes) porDueno.set(k.email, [...(porDueno.get(k.email) ?? []), k]);

  console.log(`${pendientes.length} keys pendientes de ${porDueno.size} clientes desde ${desde.toISOString()}:\n`);
  for (const [email, keys] of porDueno) {
    console.log(`${email} (${keys[0].nombre})`);
    for (const k of keys) {
      const uso = k.ultimoUso ? `último uso ${k.ultimoUso.toISOString().slice(0, 10)}` : 'nunca usada';
      console.log(`  · ${k.name}  ${k.identificador}  ${uso}`);
    }
  }
}

await prisma.$disconnect();
