import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { catalogoAstaSchema } from '@asta/shared-types';
import datos from '../services/catalogo/catalogoAsta.json';

/**
 * El catálogo ASTA del personal. El repositorio es público: ni el JSON ni el
 * PDF base pueden llevar precios, que se leen de Odoo al pedirlos.
 */

const WEB = join(import.meta.dirname, '../../../web');

describe('Catálogo ASTA', () => {
  const catalogo = catalogoAstaSchema.parse(datos);

  it('las fichas del repositorio no llevan precios', () => {
    expect(JSON.stringify(datos)).not.toMatch(/"precio"/);
    const huecos = readFileSync(join(WEB, 'privado/catalogo/catalogo-asta.huecos.json'), 'utf8');
    expect(huecos).not.toMatch(/precio|\$\d/);
  });

  it('no trae los productos marcados ASTA en Odoo que no lo son', () => {
    const codigos = catalogo.fichas.flatMap((f) => f.variantes.map((v) => v.codigo));
    for (const c of ['A-006R04387', 'A-006R04388', 'A-006R04389', 'A-006R04390', 'A-006R04403', 'A-TN-920UXXL']) {
      expect(codigos).not.toContain(c);
    }
  });

  it('cada foto existe en el panel y los ids no se repiten', () => {
    for (const f of catalogo.fichas) if (f.foto) expect(existsSync(join(WEB, 'public/catalogo', f.foto)), f.foto).toBe(true);
    const ids = catalogo.fichas.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('cada hueco de precio del PDF es de un código del catálogo', () => {
    const { huecos } = JSON.parse(readFileSync(join(WEB, 'privado/catalogo/catalogo-asta.huecos.json'), 'utf8')) as { huecos: Array<{ codigo: string }> };
    const codigos = new Set(catalogo.fichas.flatMap((f) => f.variantes.map((v) => v.codigo)));
    expect(huecos.length).toBeGreaterThan(0);
    for (const h of huecos) expect(codigos.has(h.codigo), h.codigo).toBe(true);
  });
});
