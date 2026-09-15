import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { errorCodeSchema } from '@asta/shared-types';

/**
 * Todo `code: '...'` que el middleware escribe está en el contrato.
 *
 * `erroresContrato.test.ts` cubre los errores TIPADOS, que ya no compilan con un
 * código inventado. Pero los cuerpos escritos a mano con `res.json({ error: {
 * code: '...' } })` no pasan por el tipo, y así se colaron seis códigos de la API
 * pública: INVOICE_NOT_FOUND, INVALID_INVOICE_ID y PARTNER_ID_NOT_ALLOWED desde
 * #36, y los tres primeros de #32. Un cliente que valide con `apiErrorSchema`
 * recibía esas respuestas como basura.
 *
 * Es un test sobre el código fuente, no sobre el comportamiento, y lo sé. Es la
 * forma barata de cubrir TODOS los sitios, incluidos los que se escriban
 * mañana, sin tener que provocar cada error por HTTP.
 */

const SRC = fileURLToPath(new URL('..', import.meta.url));

function ficheros(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) return nombre === '__tests__' ? [] : ficheros(ruta);
    return ruta.endsWith('.ts') ? [ruta] : [];
  });
}

describe('códigos de error emitidos', () => {
  it('cada literal `code:` del middleware está en errorCodeSchema', () => {
    const fuera: string[] = [];
    let vistos = 0;
    for (const ruta of ficheros(SRC)) {
      for (const m of readFileSync(ruta, 'utf8').matchAll(/\bcode(?::\s*ErrorCode)?\s*[:=]\s*'([A-Z][A-Z0-9_]+)'/g)) {
        vistos++;
        if (!errorCodeSchema.safeParse(m[1]).success) fuera.push(`${m[1]} en ${ruta.slice(SRC.length)}`);
      }
    }
    // Si la expresión dejara de encontrar nada, el test pasaría sin mirar.
    expect(vistos).toBeGreaterThan(20);
    expect(fuera).toEqual([]);
  });
});

describe('#32 · errores tipados de las descargas, por el manejador', () => {
  // Sin Odoo: el caso de extremo a extremo necesita el ERP y no corre en una
  // máquina recién clonada. Mismo criterio que `erroresContrato.test.ts`.
  it('cada uno sale con su status y valida contra apiErrorSchema', async () => {
    const { apiErrorSchema, HTTP_STATUS_BY_ERROR } = await import('@asta/shared-types');
    const { errorHandler } = await import('../middleware/errorHandler.js');
    const { EnlaceCaducado, EnlaceNoValido } = await import('../services/enlacesFirmados.js');
    const { PdfNoDisponible } = await import('../services/invoicePdf.service.js');

    for (const [error, status] of [
      [new EnlaceNoValido(), 404],
      [new EnlaceCaducado(), 410],
      [new PdfNoDisponible(5), 404],
    ] as const) {
      let codigo = 0;
      let cuerpo: unknown;
      const res = {
        headersSent: false,
        status(c: number) {
          codigo = c;
          return this;
        },
        json(b: unknown) {
          cuerpo = b;
          return this;
        },
      };
      errorHandler(error, { params: {}, path: '/x' } as never, res as never, (() => {}) as never);
      expect(codigo).toBe(status);
      expect(codigo).toBe(HTTP_STATUS_BY_ERROR[error.code]);
      expect(apiErrorSchema.safeParse(cuerpo).success, JSON.stringify(cuerpo)).toBe(true);
    }
  });
});
