import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Router } from 'express';
import { errorCodeSchema, HTTP_STATUS_BY_ERROR, inventoryQuerySchema, publicInvoiceListQuerySchema } from '@asta/shared-types';
import { CODIGOS_PUBLICOS, construirOpenApi, OPERACIONES } from '../openapi/especificacion.js';
import { LIMITES_DOCUMENTADOS } from '../openapi/guia.js';
import { paginaDocumentacion } from '../openapi/pagina.js';
import { crearPublicRouter } from '../routes/public.js';
import { crearDescargasRouter, DESCARGAS_POR_MINUTO_POR_IP } from '../routes/descargas.js';
import { noImplementadoHandler } from '../controllers/public.controller.js';
import {
  FALLOS_DE_AUTENTICACION_POR_IP,
  LIMITE_POR_KEY_POR_DEFECTO,
  VENTANA_POR_KEY_MS,
  VENTANA_PRE_AUTH_MS,
} from '../middleware/rateLimitPublico.js';
import { TTL_ENLACE_SEGUNDOS } from '../services/enlacesFirmados.js';
import { TTL_CACHE_INVENTARIO_MS } from '../services/inventory.service.js';
import { openApiVersionada, RUTA_OPENAPI } from '../../../../scripts/generar-openapi.js';

/**
 * #35 · La documentación dice la verdad.
 *
 * Una documentación que miente es peor que ninguna: el cliente integra contra lo
 * que lee y se entera en producción. Cada test de aquí ata una afirmación de la
 * documentación al código que la hace cierta. Sin Odoo ni base de datos; lo que
 * necesita el ERP está en `ejemplosDocs.test.ts`.
 */

type Json = Record<string, unknown>;

/**
 * Rutas montadas en un router de Express 4, sin las que responden 501, como
 * `MÉTODO ruta`. Con el método: antes solo se miraban los GET, y un POST sin
 * documentar no lo notaba nadie (#43).
 */
function rutasMontadas(router: Router, prefijo: string): string[] {
  const capas = (router as unknown as { stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: unknown }> } }> }).stack;
  return capas
    .filter((c) => c.route)
    .filter((c) => !c.route!.stack.some((s) => s.handle === noImplementadoHandler))
    .flatMap((c) => Object.keys(c.route!.methods).map((m) => `${m.toUpperCase()} ${prefijo}${c.route!.path.replace(/:(\w+)/g, '{$1}')}`));
}

describe('#35 · Qué se documenta', () => {
  it('las rutas documentadas son exactamente las montadas (sin los 501)', () => {
    // En los dos sentidos: un endpoint nuevo sin documentar, y uno documentado
    // que ya no existe, fallan igual.
    const montadas = [
      ...rutasMontadas(crearPublicRouter(), '/api/v1/public'),
      ...rutasMontadas(crearDescargasRouter(), '/api/v1/descargas'),
    ].sort();
    expect(OPERACIONES.map((o) => `${o.metodo.toUpperCase()} ${o.ruta}`).sort()).toEqual(montadas);
    const enOpenApi = Object.entries(construirOpenApi().paths as Record<string, Json>).flatMap(([ruta, metodos]) =>
      Object.keys(metodos).map((m) => `${m.toUpperCase()} ${ruta}`),
    );
    expect(enOpenApi.sort()).toEqual(montadas);
  });

  it('los endpoints que responden 501 NO están documentados', () => {
    // La política de versiones: no son contrato hasta que se implementen.
    const spec = JSON.stringify(construirOpenApi());
    expect(spec).not.toContain('/api/v1/public/pricing');
  });

  it('cada operación tiene id único, parámetros de ruta declarados y ejemplos de curl y Python', () => {
    const spec = construirOpenApi() as { paths: Record<string, Record<string, Json>> };
    const ids = new Set<string>();
    // Todas las operaciones de cada ruta, no solo el GET: desde #43 hay un POST.
    const operaciones = Object.entries(spec.paths).flatMap(([ruta, metodos]) => Object.values(metodos).map((get) => [ruta, get] as const));
    for (const [ruta, get] of operaciones) {
      expect(ids.has(get.operationId as string)).toBe(false);
      ids.add(get.operationId as string);

      const enRuta = [...ruta.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      const declarados = (get.parameters as Array<{ name: string; in: string }>).filter((p) => p.in === 'path').map((p) => p.name);
      expect(declarados.sort()).toEqual(enRuta.sort());

      expect((get['x-codeSamples'] as Array<{ lang: string }>).map((s) => s.lang)).toEqual(['curl', 'Python']);
    }
  });
});

describe('#35 · Lo que la especificación promete', () => {
  const texto = JSON.stringify(construirOpenApi());

  it('las respuestas NO prohíben campos adicionales (docs/07-VERSIONADO-API.md §4.1)', () => {
    // Con `additionalProperties: false`, un cliente generado desde la
    // especificación se rompería al añadir un campo, que la política permite.
    expect(texto).not.toContain('"additionalProperties":false');
  });

  it('error.code es un string abierto, no una enumeración', () => {
    const error = (construirOpenApi() as { components: { schemas: { Error: { properties: { error: { properties: { code: Json } } } } } } })
      .components.schemas.Error.properties.error.properties.code;
    expect(error.type).toBe('string');
    expect(error.enum).toBeUndefined();
  });

  it('todas las $ref resuelven', () => {
    const spec = construirOpenApi() as { components: { schemas: Json } };
    for (const [, nombre] of texto.matchAll(/"\$ref":"#\/components\/schemas\/(\w+)"/g)) {
      expect(spec.components.schemas[nombre], nombre).toBeDefined();
    }
  });

  it('sin el ruido de la conversión', () => {
    expect(texto).not.toContain(String(Number.MAX_SAFE_INTEGER));
    // El ruido era el `pattern` que zod añade a cada fecha. Un `pattern` que
    // explica un formato de verdad —el de `busquedaId`, #43— sí se documenta.
    const conFechaYPatron: string[] = [];
    const recorrer = (n: unknown, ruta: string): void => {
      if (Array.isArray(n)) return n.forEach((x, i) => recorrer(x, `${ruta}[${i}]`));
      if (!n || typeof n !== 'object') return;
      const o = n as Json;
      if ('pattern' in o && ['date', 'date-time'].includes(String(o.format))) conFechaYPatron.push(ruta);
      for (const [k, v] of Object.entries(o)) recorrer(v, `${ruta}.${k}`);
    };
    recorrer(JSON.parse(texto), '$');
    expect(conFechaYPatron).toEqual([]);
  });
});

describe('#35 · Errores', () => {
  it('cada código documentado existe en el contrato, con el status que dice la tabla', () => {
    for (const code of Object.keys(CODIGOS_PUBLICOS)) {
      expect(errorCodeSchema.safeParse(code).success, code).toBe(true);
    }
    const spec = construirOpenApi() as { paths: Record<string, Record<string, { responses: Record<string, { description: string }> }>> };
    for (const op of OPERACIONES) {
      const respuestas = spec.paths[op.ruta][op.metodo].responses;
      for (const code of op.errores) {
        expect(CODIGOS_PUBLICOS[code], `${code} en ${op.ruta} sin explicación en la tabla`).toBeDefined();
        expect(respuestas[HTTP_STATUS_BY_ERROR[code]]?.description, `${code} en ${op.ruta}`).toContain(code);
      }
    }
  });

  it('todo código que emiten las rutas públicas está explicado en la tabla', () => {
    // Sobre el fuente, como `codigosEmitidos.test.ts`: cubre también los que se
    // escriban mañana en estos ficheros.
    const ficheros = [
      'controllers/public.controller.ts',
      'controllers/descargas.controller.ts',
      'middleware/apiKeyAuth.ts',
      'middleware/rateLimitPublico.ts',
      'routes/descargas.ts',
      'services/enlacesFirmados.ts',
      'services/invoicePdf.service.ts',
      'services/inventory.service.ts',
      'services/recomendador/recomendador.service.ts',
    ];
    const emitidos = new Set<string>();
    for (const f of ficheros) {
      const fuente = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
      for (const m of fuente.matchAll(/\bcode(?::\s*ErrorCode)?\s*[:=]\s*'([A-Z][A-Z0-9_]+)'/g)) emitidos.add(m[1]);
    }
    expect(emitidos.size).toBeGreaterThan(8);
    // NOT_IMPLEMENTED es de los endpoints sin publicar.
    const sinExplicar = [...emitidos].filter((c) => c !== 'NOT_IMPLEMENTED' && !(c in CODIGOS_PUBLICOS));
    expect(sinExplicar).toEqual([]);
  });
});

describe('#35 · Ejemplos y cifras', () => {
  it('cada ejemplo de respuesta valida contra su schema', () => {
    for (const op of OPERACIONES) {
      if (!op.exito.schema) continue;
      const r = op.exito.schema.safeParse(op.exito.ejemploRespuesta);
      expect(r.success, `${op.id}: ${JSON.stringify(r.error?.issues)}`).toBe(true);
    }
  });

  it('cada query de ejemplo valida contra el schema de su endpoint', () => {
    for (const op of OPERACIONES) {
      if (!op.query) continue;
      expect(op.query.safeParse(op.ejemplo.query ?? {}).success, op.id).toBe(true);
    }
  });

  it('las cifras de la guía son las del código', () => {
    const L = LIMITES_DOCUMENTADOS;
    expect(L.porKeyPorDefecto).toBe(LIMITE_POR_KEY_POR_DEFECTO);
    expect(VENTANA_POR_KEY_MS).toBe(60_000); // la guía dice "por minuto"
    expect(L.fallosDeAutenticacionPorIp).toBe(FALLOS_DE_AUTENTICACION_POR_IP);
    expect(L.ventanaFallosMinutos * 60_000).toBe(VENTANA_PRE_AUTH_MS);
    expect(L.descargasPorMinutoPorIp).toBe(DESCARGAS_POR_MINUTO_POR_IP);
    expect(L.enlacePdfMinutos * 60).toBe(TTL_ENLACE_SEGUNDOS);
    expect(L.cacheInventarioSegundos * 1000).toBe(TTL_CACHE_INVENTARIO_MS);

    for (const schema of [publicInvoiceListQuerySchema, inventoryQuerySchema]) {
      expect(schema.parse({}).porPagina).toBe(L.porPaginaPorDefecto);
      expect(schema.safeParse({ porPagina: String(L.maxPorPagina) }).success).toBe(true);
      expect(schema.safeParse({ porPagina: String(L.maxPorPagina + 1) }).success).toBe(false);
    }
  });
});

describe('#35 · Página', () => {
  it('escapa el Host: una cabecera maliciosa no inyecta HTML', () => {
    const html = paginaDocumentacion('https://evil"><script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('no carga nada de fuera', () => {
    const html = paginaDocumentacion('https://api.ejemplo.com');
    expect(html).not.toMatch(/<script|<link[^>]+href="http|@import|src="http/);
  });

  it('enlaza cada sección del índice a un ancla que existe', () => {
    const html = paginaDocumentacion('https://api.ejemplo.com');
    const anclas = [...html.matchAll(/href="#([\w-]+)"/g)].map((m) => m[1]);
    expect(anclas.length).toBeGreaterThan(8);
    for (const a of anclas) expect(html, a).toContain(`id="${a}"`);
  });
});

describe('#35 · docs/api/openapi.json', () => {
  it('está al día con el código (si falla: pnpm openapi)', () => {
    // El diff de este archivo es lo que deja ver en un PR que el contrato cambió.
    expect(readFileSync(RUTA_OPENAPI, 'utf8')).toBe(openApiVersionada());
  });
});
