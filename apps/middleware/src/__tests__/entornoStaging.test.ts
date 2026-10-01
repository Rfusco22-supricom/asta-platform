import { describe, expect, it } from 'vitest';
import { comprobarStaging } from '../odoo/entornoStaging.js';

/**
 * #13 · La barrera que impide correr la batería de staging contra producción.
 *
 * Esa batería crea pedidos de verdad en Odoo. Esto corre en la batería NORMAL,
 * sin Odoo ni base: si alguien debilita la barrera, se nota aquí aunque nadie
 * tenga staging a mano.
 */

const staging = {
  ODOO_STAGING: 'si',
  ODOO_URL: 'https://supricom-staging-1234.dev.odoo.com',
  ODOO_DB: 'supricom-staging-1234',
  DATABASE_URL: 'mysql://root@localhost:3306/asta',
};

describe('#13 · Barrera de staging', () => {
  it('una configuración de staging de verdad pasa', () => {
    expect(comprobarStaging(staging)).toEqual({ ok: true, motivos: [] });
  });

  it('sin ODOO_STAGING=si escrito a propósito, no', () => {
    expect(comprobarStaging({ ...staging, ODOO_STAGING: undefined }).ok).toBe(false);
    expect(comprobarStaging({ ...staging, ODOO_STAGING: 'true' }).ok).toBe(false);
  });

  it('la base de producción, no: aunque el host sea otro', () => {
    const r = comprobarStaging({ ...staging, ODOO_DB: 'supricom-prod1-25424683' });
    expect(r.ok).toBe(false);
    expect(r.motivos.join(' ')).toMatch(/PRODUCCIÓN/);
  });

  it('el host de producción, no: aunque la base sea otra', () => {
    expect(comprobarStaging({ ...staging, ODOO_URL: 'https://supricom2.odoo.com' }).ok).toBe(false);
    expect(comprobarStaging({ ...staging, ODOO_URL: 'https://SUPRICOM2.odoo.com/' }).ok).toBe(false);
  });

  it('se puede AMPLIAR la lista de producción, no vaciarla', () => {
    // Poner ODOO_DB_PRODUCCION vacío no quita la de por defecto.
    expect(comprobarStaging({ ...staging, ODOO_DB: 'supricom-prod1-25424683', ODOO_DB_PRODUCCION: '' }).ok).toBe(false);
    expect(comprobarStaging({ ...staging, ODOO_DB: 'otra-prod', ODOO_DB_PRODUCCION: 'otra-prod' }).ok).toBe(false);
  });

  it('un MySQL que no es local, no: la batería también escribe en MySQL', () => {
    expect(comprobarStaging({ ...staging, DATABASE_URL: 'mysql://asta_app:x@asta-mysql:3306/Asta' }).ok).toBe(false);
  });

  it('el .env de desarrollo de hoy (Odoo de producción) se rechaza', () => {
    const r = comprobarStaging({
      ODOO_URL: 'https://supricom2.odoo.com',
      ODOO_DB: 'supricom-prod1-25424683',
      DATABASE_URL: 'mysql://root@localhost:3306/asta',
    });
    expect(r.ok).toBe(false);
    expect(r.motivos).toHaveLength(3);
  });
});
