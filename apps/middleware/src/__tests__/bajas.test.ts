import { describe, expect, it } from 'vitest';
import {
  decidirBajas,
  topeDeBajas,
  type CuentaViva,
  type MotivoBaja,
} from '../services/bajas.service.js';

/**
 * Issue #89 — propagar al panel las bajas hechas en Odoo.
 *
 * ── Qué se vigila ────────────────────────────────────────────────────────────
 *
 * Esta es la función que puede dejar sin acceso a la empresa entera. No se
 * prueba «que desactive»: eso es la mitad fácil. Se prueba sobre todo **cuándo
 * NO debe desactivar**, porque el fallo caro no es dejar entrar a un ex-empleado
 * un día de más — es apagar 300 cuentas un lunes por la mañana porque una
 * respuesta de Odoo vino corta.
 *
 * Es pura a propósito, así que todo esto corre sin ERP y sin base de datos.
 */

const cuenta = (over: Partial<CuentaViva> = {}): CuentaViva => ({
  id: 'u1',
  email: 'alguien@supricom.com.ve',
  fullName: 'Alguien',
  role: 'BRONCE',
  odooPartnerId: 500,
  odooUserId: null,
  ...over,
});

/** El motivo por el que se dio de baja a la única cuenta, o null. */
function motivo(
  c: CuentaViva,
  usuarios: Array<[number, boolean]> = [],
  partners: Array<[number, boolean]> = [],
): MotivoBaja | null {
  const r = decidirBajas([c], new Map(usuarios), new Map(partners));
  return r.bajas[0]?.motivo ?? null;
}

describe('#89 · cuándo SÍ se desactiva', () => {
  it('el usuario de Odoo está inactivo: es el acto humano que hay que propagar', () => {
    const v = cuenta({ role: 'VENDEDOR', odooUserId: 383 });
    expect(motivo(v, [[383, false]], [[500, true]])).toBe('USUARIO_INACTIVO_EN_ODOO');
  });

  it('el partner está archivado', () => {
    expect(motivo(cuenta(), [], [[500, false]])).toBe('PARTNER_ARCHIVADO_EN_ODOO');
  });

  it('con el usuario inactivo, el motivo es ese y no el del partner', () => {
    // Para el personal la baja se hace desactivando SU USUARIO. Decir "partner
    // archivado" mandaría a mirar la ficha equivocada en Odoo.
    const v = cuenta({ role: 'VENDEDOR', odooUserId: 383 });
    expect(motivo(v, [[383, false]], [[500, false]])).toBe('USUARIO_INACTIVO_EN_ODOO');
  });
});

describe('#89 · cuándo NO se desactiva', () => {
  it('todo activo: no toca a nadie', () => {
    const v = cuenta({ role: 'VENDEDOR', odooUserId: 383 });
    expect(motivo(v, [[383, true]], [[500, true]])).toBeNull();
  });

  /*
   * LA REGLA. Ausencia no es baja.
   *
   * Si un lote de Odoo viene corto, cambia un dominio o la llamada falla a
   * medias, «no vino en la respuesta» se parece muchísimo a «está de baja». Esa
   * confusión es la que apaga a todo el mundo a la vez.
   */
  it('Odoo no devolvió el partner: NO se desactiva, se anota', () => {
    const r = decidirBajas([cuenta()], new Map(), new Map());
    expect(r.bajas).toHaveLength(0);
    expect(r.sinRespuesta).toHaveLength(1);
    expect(r.sinRespuesta[0].detalle).toContain('res.partner 500');
  });

  it('Odoo no devolvió el usuario de un vendedor: NO se desactiva', () => {
    const v = cuenta({ role: 'VENDEDOR', odooUserId: 383 });
    // El partner sí vino y está activo; lo que falta es el usuario.
    const r = decidirBajas([v], new Map(), new Map([[500, true]]));
    expect(r.bajas).toHaveLength(0);
    expect(r.sinRespuesta[0].detalle).toContain('res.users 383');
  });

  it('una respuesta VACÍA de Odoo no desactiva a nadie', () => {
    // El caso extremo del anterior, y el que de verdad da miedo: si la llamada
    // devuelve cero filas, la lectura ingenua concluiría que TODOS están de baja.
    const cuentas = Array.from({ length: 50 }, (_, i) =>
      cuenta({ id: `u${i}`, odooPartnerId: 1000 + i }),
    );
    const r = decidirBajas(cuentas, new Map(), new Map());
    expect(r.bajas).toHaveLength(0);
    expect(r.sinRespuesta).toHaveLength(50);
    expect(r.abortado).toBeNull();
  });

  it('un SUPERADMIN no se desactiva solo: se informa', () => {
    // Es la cuenta con la que se arregla todo lo demás, incluido deshacer esta
    // misma pasada. Si la apaga un cambio en Odoo, no queda por dónde entrar.
    const admin = cuenta({ role: 'SUPERADMIN', odooUserId: 388 });
    const r = decidirBajas([admin], new Map([[388, false]]), new Map([[500, true]]));
    expect(r.bajas).toHaveLength(0);
    expect(r.protegidos).toHaveLength(1);
    expect(r.protegidos[0].motivo).toBe('USUARIO_INACTIVO_EN_ODOO');
  });
});

describe('#89 · el tope', () => {
  it('2 % con suelo de 10', () => {
    expect(topeDeBajas(0)).toBe(10);
    expect(topeDeBajas(100)).toBe(10);
    expect(topeDeBajas(2300)).toBe(46);
  });

  it('pasarse del tope aborta la pasada ENTERA, no recorta la lista', () => {
    /*
     * Recortar sería lo intuitivo y es peor: si la señal está mal, desactivar
     * «solo los primeros 46» hace el mismo daño y encima deja el trabajo a
     * medias, con la mitad de la empresa fuera y la otra mitad dentro.
     */
    const cuentas = Array.from({ length: 100 }, (_, i) =>
      cuenta({ id: `u${i}`, odooPartnerId: 1000 + i }),
    );
    const partners = new Map(cuentas.map((c) => [c.odooPartnerId, false] as [number, boolean]));

    const r = decidirBajas(cuentas, new Map(), partners);
    expect(r.bajas).toHaveLength(100);
    expect(r.abortado).toContain('no se aplica nada');
  });

  it('una baja normal no aborta nada', () => {
    const cuentas = Array.from({ length: 100 }, (_, i) =>
      cuenta({ id: `u${i}`, odooPartnerId: 1000 + i }),
    );
    const partners = new Map(cuentas.map((c) => [c.odooPartnerId, true] as [number, boolean]));
    partners.set(1000, false);
    partners.set(1001, false);

    const r = decidirBajas(cuentas, new Map(), partners);
    expect(r.bajas).toHaveLength(2);
    expect(r.abortado).toBeNull();
  });
});

describe('#89 · el informe sirve para actuar', () => {
  it('cada baja dice quién es y qué registro de Odoo lo provocó', () => {
    // Quien lea esto tiene que poder ir a Odoo a comprobarlo, o deshacerlo.
    const v = cuenta({ role: 'VENDEDOR', odooUserId: 383, email: 'x@supricom.com.ve' });
    const [b] = decidirBajas([v], new Map([[383, false]]), new Map([[500, true]])).bajas;

    expect(b.email).toBe('x@supricom.com.ve');
    expect(b.role).toBe('VENDEDOR');
    expect(b.detalle).toContain('383');
  });

  it('ninguna cuenta se pierde por el camino', () => {
    const cuentas = [
      cuenta({ id: 'a', odooPartnerId: 1 }),
      cuenta({ id: 'b', odooPartnerId: 2 }),
      cuenta({ id: 'c', odooPartnerId: 3 }),
      cuenta({ id: 'd', role: 'SUPERADMIN', odooPartnerId: 4, odooUserId: 388 }),
    ];
    const r = decidirBajas(
      cuentas,
      new Map([[388, false]]),
      new Map([
        [1, true],
        [2, false],
        // el 3 no vino
        [4, true],
      ]),
    );

    // activa(1) + baja(2) + sinRespuesta(3) + protegido(4)
    expect(r.bajas).toHaveLength(1);
    expect(r.sinRespuesta).toHaveLength(1);
    expect(r.protegidos).toHaveLength(1);
  });
});
