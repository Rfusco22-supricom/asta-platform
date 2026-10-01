import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * #50 · El aviso de la ficha busca hermanos SOLO en la compañía del cliente.
 *
 * El mismo cliente en dos compañías son dos fichas a propósito, cada una con el
 * vendedor de su compañía. La primera versión las daba por «el mismo cliente
 * partido» y le enseñaba al vendedor la cifra y el nombre del vendedor de otra
 * compañía: un aviso falso, y además una fuga de lo que #25 protege.
 */

const searchRead = vi.fn();
const readGroup = vi.fn();
vi.mock('../odoo/client.js', () => ({ searchRead, readGroup }));

const { hermanosDe } = await import('../services/hermanos.service.js');

const YO = { id: 1, name: 'GALLERY COMPUTER, C.A', vat: 'J-30470992-7', user_id: [5, 'Ana'], company_id: [10, 'SUPRICOM CCS 21, C.A. - B'] };

beforeEach(() => {
  searchRead.mockReset();
  readGroup.mockReset();
  readGroup.mockResolvedValue([]);
});

/** Las cláusulas de la segunda consulta: la de los candidatos. */
const dominioDeCandidatos = () => searchRead.mock.calls[1][1] as unknown[];

describe('#50 · Hermanos dentro de la compañía', () => {
  it('por RIF: los candidatos se piden de la misma compañía', async () => {
    searchRead.mockResolvedValueOnce([YO]).mockResolvedValueOnce([]);
    await hermanosDe(1);
    expect(dominioDeCandidatos()).toContainEqual(['company_id', '=', 10]);
  });

  it('por nombre, también', async () => {
    searchRead.mockResolvedValueOnce([{ ...YO, vat: false }]).mockResolvedValueOnce([]);
    await hermanosDe(1);
    expect(dominioDeCandidatos()).toContainEqual(['company_id', '=', 10]);
  });

  it('una ficha compartida (sin compañía) solo se compara con otras compartidas', async () => {
    searchRead.mockResolvedValueOnce([{ ...YO, company_id: false }]).mockResolvedValueOnce([]);
    await hermanosDe(1);
    expect(dominioDeCandidatos()).toContainEqual(['company_id', '=', false]);
  });
});
