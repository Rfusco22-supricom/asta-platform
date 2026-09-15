import { describe, expect, it } from 'vitest';
import {
  aprobarVendedores,
  type CandidatoVendedor,
  type MotivoDescarte,
} from '../services/vendedores.service.js';

/**
 * Issue #81 — Quién es vendedor.
 *
 * ── Qué se prueba, y por qué solo esto ───────────────────────────────────────
 *
 * `aprobarVendedores()` es la decisión: mirando los números de una persona, dice
 * si se le concede el panel de facturación de su cartera. Es pura a propósito, y
 * por eso es lo único que hace falta probar aquí — sin Odoo, sin base de datos y
 * sin que el resultado dependa de qué haya hoy en el ERP.
 *
 * Los casos NO son inventados. Son los de la instancia real: 28 candidatos, 21
 * aprobados, 7 fuera. Cada uno de los descartes de abajo tiene nombre y apellido
 * en producción, y están aquí porque cada uno describe una forma distinta de
 * equivocarse.
 */

const base: CandidatoVendedor = {
  odooUserId: 10,
  nombre: 'VENDEDOR DE PRUEBA',
  login: 'ventas99@supricom.com.ve',
  activo: true,
  clientes: 40,
  monto: 120_000,
  odooPartnerId: 500,
};

const con = (cambios: Partial<CandidatoVendedor>): CandidatoVendedor => ({ ...base, ...cambios });

/** El motivo por el que se descartó al único candidato, o null si entró. */
function motivo(c: CandidatoVendedor): MotivoDescarte | null {
  const r = aprobarVendedores([c]);
  return r.descartados[0]?.motivo ?? null;
}

describe('aprobarVendedores', () => {
  it('aprueba a quien tiene cartera activa, usuario activo y facturación', () => {
    const r = aprobarVendedores([base]);
    expect(r.aprobados).toHaveLength(1);
    expect(r.descartados).toHaveLength(0);
  });

  /*
   * AUGUSTO RUBIO, FREDDY BENITO ROBLES y Maria Auxiliadora Tovar: ya no
   * trabajan aquí, pero sus clientes siguen asignados a ellos en Odoo. La
   * cartera existe y está facturada; la persona no. Si esto pasara, se crearían
   * tres cuentas vivas para gente que se fue.
   */
  it('descarta a quien está de baja en Odoo aunque su cartera facture', () => {
    expect(motivo(con({ activo: false, clientes: 180, monto: 900_000 }))).toBe('INACTIVO_EN_ODOO');
  });

  /*
   * ANTONELLA ZAMPETTI, CHENYS FAGUNDEZ y MARIA FERNANDA MUGICA: entre 1 y 3
   * clientes pegados por arrastre de datos y CERO facturas. Igual que
   * `servtecnico@` y `contabilidad@`. Darles el panel sería dar acceso a
   * facturación a quien no vende.
   *
   * Esta es LA condición que separa a un vendedor de una asignación suelta.
   */
  it('descarta a quien tiene clientes asignados pero no ha facturado nada', () => {
    expect(motivo(con({ clientes: 3, monto: 0 }))).toBe('SIN_FACTURACION');
  });

  it('un solo bolívar facturado ya cuenta: la regla es «vende», no «vende mucho»', () => {
    // Deliberado: poner aquí un mínimo (">= 1000", ">= 5 clientes") sería
    // inventarse un umbral que nadie ha decidido, y dejaría fuera al que acaba
    // de entrar en el equipo y lleva una venta.
    expect(motivo(con({ clientes: 1, monto: 1 }))).toBeNull();
  });

  /*
   * Una nota de crédito puede dejar el total en negativo. No es lo mismo que
   * cero: significa que hubo facturación y luego se devolvió.
   *
   * Se descarta igual, y es la decisión correcta mientras #26 siga sin cerrarse:
   * conceder acceso por un saldo negativo es más difícil de explicar que
   * pedírselo a un humano.
   */
  it('descarta un total negativo, no lo trata como facturación', () => {
    expect(motivo(con({ monto: -5000 }))).toBe('SIN_FACTURACION');
  });

  it('descarta si el login de Odoo no es un correo: no habría forma de entrar', () => {
    expect(motivo(con({ login: 'admin' }))).toBe('LOGIN_NO_ES_EMAIL');
  });

  it('descarta si el usuario de Odoo no tiene partner', () => {
    expect(motivo(con({ odooPartnerId: null }))).toBe('SIN_PARTNER');
  });

  /*
   * ANDREA MARQUEZ. La razón por la que la regla NO es el patrón del login.
   *
   * Su correo es `amarquez@`, no `ventasNN@`, y con la regla del patrón se
   * quedaba fuera la cartera MÁS GRANDE de la empresa: 260 clientes, 2,5 M
   * facturados. El patrón describe cómo se crearon las cuentas hace años, no
   * quién vende hoy.
   *
   * Este test es el que se pone rojo si alguien vuelve a meter esa idea.
   */
  it('aprueba a quien vende aunque su correo no siga el patrón ventasNN@', () => {
    const andrea = con({
      nombre: 'ANDREA MARQUEZ',
      login: 'amarquez@supricom.com.ve',
      clientes: 260,
      monto: 2_549_471,
    });
    expect(aprobarVendedores([andrea]).aprobados).toHaveLength(1);
  });

  it('cada descarte dice de quién es y por qué, no solo cuántos hubo', () => {
    // El CLI imprime esta lista para que alguien la arregle EN ODOO. Un contador
    // de descartados sin nombres no sirve para eso.
    const [d] = aprobarVendedores([con({ clientes: 2, monto: 0 })]).descartados;
    expect(d.nombre).toBe(base.nombre);
    expect(d.login).toBe(base.login);
    expect(d.detalle).toContain('2 clientes');
  });

  it('reparte a todos: ninguno se pierde por el camino', () => {
    const candidatos = [
      base,
      con({ odooUserId: 11, activo: false }),
      con({ odooUserId: 12, monto: 0 }),
      con({ odooUserId: 13, login: 'sin-arroba' }),
      con({ odooUserId: 14, odooPartnerId: null }),
    ];
    const r = aprobarVendedores(candidatos);
    expect(r.aprobados.length + r.descartados.length).toBe(candidatos.length);
    expect(r.aprobados).toHaveLength(1);
  });

  it('sin candidatos no aprueba a nadie', () => {
    expect(aprobarVendedores([])).toEqual({ aprobados: [], descartados: [] });
  });

  /*
   * El orden de las comprobaciones importa para el informe.
   *
   * Alguien de baja Y sin facturar tiene que salir como INACTIVO_EN_ODOO: es el
   * motivo accionable —se le quita la cartera en Odoo o se le reactiva—, mientras
   * que "sin facturación" invitaría a buscar facturas de alguien que ya no está.
   */
  it('a quien falla por varias razones lo descarta por la primera que importa', () => {
    expect(motivo(con({ activo: false, monto: 0, login: 'x' }))).toBe('INACTIVO_EN_ODOO');
  });
});
