/**
 * ¿El usuario de Odoo del middleware tiene lo que necesita, y nada más? (#1)
 *
 *   node dist/cli/comprobar-usuario-odoo.js        con las ODOO_* del entorno
 *   pnpm --filter middleware exec tsx src/cli/comprobar-usuario-odoo.ts
 *
 * Es de SOLO LECTURA: `check_access_rights` con `raise_exception=False` y
 * lecturas de `res.users` y `res.company`. No escribe nada en Odoo.
 *
 * Comprueba tres cosas, y sale con código 1 si alguna falla:
 *
 *   1. Puede LEER todos los modelos que usa el middleware.
 *   2. NO puede escribir, crear ni borrar en ninguno de ellos ni en los
 *      sensibles (usuarios, permisos, ajustes, nóminas). La única excepción
 *      prevista es crear `sale.order` cuando se encienda #33: se informa, no
 *      se exige ni se prohíbe.
 *   3. Tiene las compañías con clientes (`COMPANIAS_NECESARIAS`). El
 *      middleware lee la tarifa de cada cliente con `allowed_company_ids` de su
 *      compañía (#132): si le falta una, los clientes de esa compañía se quedan
 *      sin precio y Odoo devuelve un error.
 *
 * Para el usuario de servicio nuevo: ponerlo en un `.env` aparte (o en la
 * consola de EasyPanel), correr esto, y solo con todo en verde cambiar
 * `ODOO_USERNAME` / `ODOO_PASSWORD` del middleware.
 */
import '../config/dotenv.js';
import { odooEnv as env } from '../config/odooEnv.js';
import { executeKw, getUid, searchRead } from '../odoo/client.js';

/** Lo que lee el middleware (grep de `src/`, 2026-10-15). */
const LECTURA = [
  'res.partner',
  'res.users',
  'res.company',
  'res.country',
  'account.move',
  'account.move.line',
  'product.product',
  'product.template',
  'product.pricelist',
  'product.pricelist.item',
  'sale.order',
  'sale.order.line',
  'stock.quant',
  'stock.warehouse',
  'ir.attachment',
];

/** Además de los anteriores: donde una key filtrada haría más daño. */
const SENSIBLES = ['res.groups', 'ir.model.access', 'ir.rule', 'ir.config_parameter', 'hr.employee', 'hr.payslip', 'account.payment', 'crm.lead'];

/**
 * Las compañías del usuario con el que funciona hoy el middleware (#1, #132):
 * las que tienen clientes y tarifas. Sin una de ellas, sus clientes se quedan
 * sin precio. Si se crea una compañía con clientes, hay que añadirla aquí.
 */
const COMPANIAS_NECESARIAS = [1, 2, 7, 9, 10, 11];

const ESCRITURA = ['write', 'create', 'unlink'] as const;
/** #33: el POST /orders crea pedidos en borrador. Hoy está apagado. */
const PREVISTO = new Set(['sale.order:create', 'sale.order.line:create']);

const VERDE = '\x1b[32m';
const ROJO = '\x1b[31m';
const AMARILLO = '\x1b[33m';
const GRIS = '\x1b[90m';
const FIN = '\x1b[0m';

async function puede(modelo: string, operacion: string): Promise<boolean | 'no existe'> {
  try {
    return await executeKw<boolean>(modelo, 'check_access_rights', [operacion], { raise_exception: false });
  } catch (e) {
    // Un modelo de un módulo no instalado (nóminas, CRM) no es un permiso de más.
    if (e instanceof Error && /doesn't exist|does not exist|KeyError/i.test(e.message)) return 'no existe';
    throw e;
  }
}

async function main(): Promise<void> {
  const uid = await getUid();
  const [yo] = await searchRead<{ name: string; login: string; share: boolean; company_ids: number[] }>(
    'res.users',
    [['id', '=', uid]],
    ['name', 'login', 'share', 'company_ids'],
  );
  console.log(`\n  Odoo ${env.ODOO_URL} · base ${env.ODOO_DB}`);
  console.log(`  Usuario: ${yo?.login ?? '?'} (uid ${uid})${uid === 1 ? `  ${ROJO}← es el administrador${FIN}` : ''}\n`);

  const fallos: string[] = [];

  console.log('  1. Lectura de lo que usa el middleware');
  for (const m of LECTURA) {
    const ok = await puede(m, 'read');
    if (ok !== true) fallos.push(`no puede leer ${m}`);
    console.log(`     ${ok === true ? `${VERDE}✓${FIN}` : `${ROJO}✗${FIN}`} ${m}`);
  }

  console.log('\n  2. Sin escritura (write / create / unlink)');
  for (const m of [...LECTURA, ...SENSIBLES]) {
    const de: string[] = [];
    let existe = true;
    for (const op of ESCRITURA) {
      const r = await puede(m, op);
      if (r === 'no existe') existe = false;
      else if (r) de.push(op);
    }
    if (!existe) {
      console.log(`     ${GRIS}· ${m}: módulo no instalado${FIN}`);
      continue;
    }
    const indebidos = de.filter((op) => !PREVISTO.has(`${m}:${op}`));
    const previstos = de.filter((op) => PREVISTO.has(`${m}:${op}`));
    if (indebidos.length) fallos.push(`${m}: ${indebidos.join(', ')}`);
    const marca = indebidos.length ? `${ROJO}✗${FIN}` : `${VERDE}✓${FIN}`;
    const nota = [
      indebidos.length ? `${ROJO}puede ${indebidos.join(', ')}${FIN}` : '',
      previstos.length ? `${AMARILLO}${previstos.join(', ')} (previsto para #33)${FIN}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
    console.log(`     ${marca} ${m}${nota ? ` — ${nota}` : ''}`);
  }

  console.log('\n  3. Compañías');
  const todas = await searchRead<{ id: number; name: string }>('res.company', [], ['name'], { context: { active_test: false } });
  const tiene = new Set(yo?.company_ids ?? []);
  for (const c of todas) {
    const ok = tiene.has(c.id);
    const hace = COMPANIAS_NECESARIAS.includes(c.id);
    if (!ok && hace) fallos.push(`le falta la compañía ${c.id} (${c.name})`);
    const marca = ok ? `${VERDE}✓${FIN}` : hace ? `${ROJO}✗${FIN}` : `${GRIS}·${FIN}`;
    console.log(`     ${marca} ${c.id} · ${c.name}${hace ? '' : ` ${GRIS}(no hace falta)${FIN}`}`);
  }
  if (yo?.share) fallos.push('es un usuario del portal (share): no puede leer como interno');

  console.log('');
  if (fallos.length === 0) {
    console.log(`  ${VERDE}Todo en orden: lee lo que necesita y no puede escribir nada.${FIN}\n`);
    return;
  }
  console.log(`  ${ROJO}${fallos.length} problema(s):${FIN}`);
  for (const f of fallos) console.log(`    · ${f}`);
  console.log('');
  process.exitCode = 1;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
