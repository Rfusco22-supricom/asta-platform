import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { oportunidadesAsta, vaciarCacheAsta } from '../services/asta.service.js';
import { searchRead } from '../odoo/client.js';

/**
 * La vista de ASTA de un vendedor no puede enseñar clientes de otro.
 *
 * ── Por qué tiene test propio ────────────────────────────────────────────────
 *
 * Es el tercer sitio del sistema donde el aislamiento depende solo del código:
 * #25 protege la cartera, #36 la API pública, y esto la lista de oportunidades.
 * Sin RLS detrás, un `where` olvidado no lo para nada.
 *
 * El caso de la cartera vacía está cubierto aquí aunque el servicio ya no dependa
 * de ello: comprobado contra la instancia, Odoo trata `partner_id in []` como
 * «ninguno» y no como «sin filtro». El test se queda porque fija el
 * COMPORTAMIENTO —un vendedor sin clientes no ve nada— y eso tiene que seguir
 * siendo cierto aunque mañana cambie la forma de recortar.
 */

/** Dos vendedores reales con cartera, descubiertos de la instancia. */
let A = 0;
let B = 0;

beforeAll(async () => {
  vaciarCacheAsta();

  const partners = await searchRead<{ user_id: [number, string] | false }>(
    'res.partner',
    [
      ['customer_rank', '>', 0],
      ['user_id', '!=', false],
      ['parent_id', '=', false],
      ['active', '=', true],
    ],
    ['user_id'],
  );

  const cuenta = new Map<number, number>();
  for (const p of partners) {
    if (!p.user_id) continue;
    cuenta.set(p.user_id[0], (cuenta.get(p.user_id[0]) ?? 0) + 1);
  }

  const conCartera = [...cuenta.entries()].sort((a, b) => b[1] - a[1]).map(([uid]) => uid);
  if (conCartera.length < 2) throw new Error('Hacen falta dos vendedores con cartera.');
  [A, B] = conCartera;
});

afterAll(() => vaciarCacheAsta());

describe('#ASTA · cada vendedor ve solo su cartera', () => {
  it('todo lo que devuelve la vista de A está asignado a A', async () => {
    const r = await oportunidadesAsta({ soloDelVendedor: A });

    // El servicio trae el comercial de cada ficha, así que se puede comprobar
    // fila a fila en vez de confiar en que el dominio estaba bien.
    const ajenos = r.oportunidades.filter(
      (o) => o.vendedorOdooUserId !== null && o.vendedorOdooUserId !== A,
    );

    expect(
      ajenos.map((o) => `${o.nombre} (de ${o.vendedorOdooUserId})`),
      'clientes de otro vendedor en la vista de A',
    ).toEqual([]);
  });

  it('la vista de A y la de B no comparten ningún cliente', async () => {
    const [ra, rb] = await Promise.all([
      oportunidadesAsta({ soloDelVendedor: A }),
      oportunidadesAsta({ soloDelVendedor: B }),
    ]);

    const deA = new Set(ra.oportunidades.map((o) => o.partnerId));
    const compartidos = rb.oportunidades.filter((o) => deA.has(o.partnerId));

    expect(compartidos.map((o) => o.nombre)).toEqual([]);
  });

  it('la vista de un vendedor es MENOR que la de toda la empresa', async () => {
    // Control: si el recorte no se aplicara, las dos darían lo mismo y los dos
    // tests de arriba seguirían pasando —porque todos los clientes tienen algún
    // vendedor asignado, solo que no el que pregunta.
    const [suya, todas] = await Promise.all([
      oportunidadesAsta({ soloDelVendedor: A }),
      oportunidadesAsta(),
    ]);

    expect(suya.oportunidades.length).toBeGreaterThan(0);
    expect(suya.oportunidades.length).toBeLessThan(todas.oportunidades.length);
  });

  /*
   * El caso que nadie prueba a mano, porque «no tiene datos».
   *
   * Un vendedor recién creado, o uno cuyo `res.users` no tiene partners
   * asignados. Hoy sale vacío por dos motivos independientes —el corte del
   * servicio y el propio Odoo— y este test vigila el resultado, no el mecanismo.
   */
  it('un vendedor SIN cartera recibe vacío, no la empresa entera', async () => {
    // Un id de usuario que no existe en Odoo: ningún partner lo tiene asignado.
    const r = await oportunidadesAsta({ soloDelVendedor: 999_999_999 });

    expect(r.oportunidades).toEqual([]);
    expect(r.totales.clientes).toBe(0);
    expect(r.totales.competencia).toBe(0);
  });
});
