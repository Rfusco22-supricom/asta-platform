import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { cuerpoFiltrado } from '../apps/web/lib/filtrarCuerpo';

/**
 * La segunda barrera de los puentes del cliente (`apps/web/lib/filtrar.ts`):
 * al navegador de un cliente solo llega lo que dice el contrato.
 */

const exito = z.object({ data: z.object({ id: z.string(), nombre: z.string() }) });
const datosDelError = z.object({ errores: z.array(z.string()) });

describe('Respuestas del cliente, filtradas', () => {
  it('un campo de más en la respuesta no llega al navegador', () => {
    const r = cuerpoFiltrado(200, { data: { id: 'a', nombre: 'Tablet', notaInterna: 'margen 40 %' }, debug: { costo: 1 } }, exito);
    expect(r).toEqual({ status: 200, body: { data: { id: 'a', nombre: 'Tablet' } } });
  });

  it('una respuesta que no encaja no se reenvía: 502', () => {
    const r = cuerpoFiltrado(201, { data: { otraCosa: true } }, exito);
    expect(r.status).toBe(502);
    expect(r.body).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Respuesta inesperada del servidor.' } });
    expect(r.descartado).toBeTruthy();
  });

  it('un error, solo con su código y su mensaje', () => {
    const r = cuerpoFiltrado(403, { error: { code: 'ROLE_NOT_ALLOWED', message: 'No.', rol: 'BRONCE', pila: '...' } }, exito);
    expect(r).toEqual({ status: 403, body: { error: { code: 'ROLE_NOT_ALLOWED', message: 'No.' } } });
  });

  it('un error sin forma conocida no se reenvía tal cual', () => {
    const r = cuerpoFiltrado(500, '<html>stack</html>', exito);
    expect(r.body).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Error del servidor.' } });
  });

  it('los datos de un error, solo si el puente los describe, y filtrados', () => {
    const cuerpo = { error: { code: 'VALIDATION_ERROR', message: 'Tiene errores.' }, data: { errores: ['fila 3'], interno: 1 } };
    expect(cuerpoFiltrado(422, cuerpo, exito, datosDelError).body).toEqual({
      error: { code: 'VALIDATION_ERROR', message: 'Tiene errores.' },
      data: { errores: ['fila 3'] },
    });
    expect(cuerpoFiltrado(422, cuerpo, exito).body).toEqual({ error: { code: 'VALIDATION_ERROR', message: 'Tiene errores.' } });
  });
});
