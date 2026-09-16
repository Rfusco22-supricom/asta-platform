import { z } from 'zod';
import {
  apiErrorSchema,
  compatibleQuerySchema,
  HTTP_STATUS_BY_ERROR,
  inventoryQuerySchema,
  publicInventoryListResponseSchema,
  publicInvoiceDetailResponseSchema,
  publicInvoiceListQuerySchema,
  publicInvoiceListResponseSchema,
  publicInvoicePdfLinkResponseSchema,
  printerSearchQuerySchema,
  publicCompatibleResponseSchema,
  publicPrinterSearchResponseSchema,
  type ErrorCode,
} from '@asta/shared-types';
import { GUIA, guiaEnMarkdown } from './guia.js';

/**
 * Especificación OpenAPI 3.1 de la API pública (#35).
 *
 * Se GENERA desde los mismos schemas de zod que validan las peticiones y que
 * usan los tests de contrato. Un documento escrito a mano diverge del código al
 * segundo cambio, y una documentación que miente es peor que ninguna: el cliente
 * integra contra lo que lee.
 *
 * ── Lo que se corrige al convertir ───────────────────────────────────────────
 *
 * `z.toJSONSchema` es fiel a zod, y en tres cosas zod no dice lo que la API
 * promete (docs/07-VERSIONADO-API.md):
 *
 *   · `additionalProperties: false` en cada objeto de respuesta. Un cliente
 *     generado desde la especificación rechazaría cualquier campo nuevo, y la
 *     política de versiones dice que añadir campos NO rompe. Se quita en las
 *     respuestas.
 *   · `error.code` como enumeración cerrada, y con los códigos del panel. Al
 *     cliente se le pide lo contrario: caso por defecto. Pasa a `string` con la
 *     tabla de códigos en la guía.
 *   · Ruido: `maximum: 9007199254740991` en cada entero y la expresión regular
 *     de 300 caracteres que zod pone junto a `format: date` y `date-time`.
 */

export const ESTADO_OPENAPI = '3.1.0';

type Json = Record<string, unknown>;

// ─────────────────────────────────────────────────────────────────────────────
// Conversión
// ─────────────────────────────────────────────────────────────────────────────

function limpiar(nodo: unknown, esRespuesta: boolean): unknown {
  if (Array.isArray(nodo)) return nodo.map((n) => limpiar(n, esRespuesta));
  if (!nodo || typeof nodo !== 'object') return nodo;

  const salida: Json = {};
  for (const [clave, valor] of Object.entries(nodo as Json)) {
    if (clave === '$schema') continue;
    if (clave === 'maximum' && valor === Number.MAX_SAFE_INTEGER) continue;
    if (clave === 'pattern' && ['date', 'date-time'].includes(String((nodo as Json).format))) continue;
    if (clave === 'additionalProperties' && valor === false && esRespuesta) continue;
    salida[clave] = limpiar(valor, esRespuesta);
  }
  return salida;
}

export function esquemaDeRespuesta(schema: z.ZodType): Json {
  return limpiar(z.toJSONSchema(schema, { io: 'output', target: 'draft-2020-12' }), true) as Json;
}

function esquemaDeEntrada(schema: z.ZodType): Json {
  return limpiar(z.toJSONSchema(schema, { io: 'input', target: 'draft-2020-12', unrepresentable: 'any' }), false) as Json;
}

/** Los campos de un schema de query, como `parameters` de OpenAPI. */
function parametrosDeQuery(schema: z.ZodObject): Json[] {
  const json = esquemaDeEntrada(schema) as { properties: Record<string, Json>; required?: string[] };
  return Object.entries(json.properties).map(([nombre, propiedad]) => {
    const { description, ...tipo } = propiedad;
    // `z.stringbool()` sale como string: en la query es texto, pero lo que
    // significa es un booleano, y así lo entienden los generadores de clientes.
    const esquema = nombre === 'soloDisponibles' ? { type: 'boolean', default: false } : tipo;
    return {
      name: nombre,
      in: 'query',
      required: json.required?.includes(nombre) ?? false,
      description,
      schema: esquema,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Errores
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Los códigos que puede recibir un cliente de la API pública, con lo que tiene
 * que hacer ante cada uno. El status sale de `HTTP_STATUS_BY_ERROR`: si un día
 * cambia allí, cambia aquí.
 *
 * `codigosPublicos.test.ts` comprueba que todo código que emiten las rutas
 * públicas está en esta tabla.
 */
export const CODIGOS_PUBLICOS: Partial<Record<ErrorCode, string>> = {
  MISSING_API_KEY: 'Falta la cabecera `X-API-Key`.',
  INVALID_API_KEY: 'La key no existe, está revocada o caducada, su usuario está desactivado, o se usa desde una IP no permitida. Por seguridad no se distingue cuál.',
  INSUFFICIENT_SCOPE: 'La key no tiene el permiso que exige este endpoint. `required` indica cuál. Crea una key con ese permiso.',
  PARTNER_ID_NOT_ALLOWED: 'La petición lleva un `partner_id` que no es el tuyo. No hace falta enviarlo: el cliente sale siempre de la API key.',
  INVALID_QUERY: 'Un parámetro no es válido. `message` explica cuál.',
  INVALID_INVOICE_ID: 'El identificador de factura no es un número entero positivo.',
  INVOICE_NOT_FOUND: 'La factura no existe o no es tuya. Es la misma respuesta en los dos casos, a propósito.',
  INVOICE_PDF_NOT_AVAILABLE: 'La factura es tuya, pero no tiene un PDF disponible. Solicítalo a tu vendedor.',
  LINK_NOT_VALID: 'El enlace de descarga no es válido, o la key que lo emitió ya no tiene acceso. Pide un enlace nuevo.',
  LINK_EXPIRED: 'El enlace de descarga caducó. Pide uno nuevo.',
  PRINTER_NOT_FOUND: 'La impresora no existe o se retiró del catálogo. Vuelve a buscarla con `/recommender/printers`.',
  INVENTORY_UNAVAILABLE: 'Tu cuenta no tiene un almacén de venta asignado. Contacta con tu vendedor.',
  RATE_LIMITED: 'Superaste el límite de peticiones. Espera los segundos que indica `Retry-After`.',
  VALIDATION_ERROR: 'Los datos enviados no son válidos. `message` explica cuáles.',
  ODOO_UNAVAILABLE: 'El sistema de gestión no responde. Reintenta en unos minutos, con espera creciente.',
  INTERNAL_ERROR: 'Error inesperado de nuestro lado. Si se repite, contacta con soporte indicando la hora.',
};

export function tablaDeErrores(): Array<{ code: ErrorCode; status: number; significado: string }> {
  return (Object.entries(CODIGOS_PUBLICOS) as Array<[ErrorCode, string]>).map(([code, significado]) => ({
    code,
    status: HTTP_STATUS_BY_ERROR[code],
    significado,
  }));
}

function esquemaDeError(): Json {
  const json = esquemaDeRespuesta(apiErrorSchema) as { properties: { error: { properties: Record<string, Json> } } };
  json.properties.error.properties.code = {
    type: 'string',
    description: 'Código del error. Programa contra él, no contra `message`. Pueden aparecer códigos nuevos: trátalos por su status HTTP.',
    examples: Object.keys(CODIGOS_PUBLICOS),
  };
  return json;
}

// ─────────────────────────────────────────────────────────────────────────────
// Ejemplos
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Una petición de ejemplo. Es DATO, no texto: de aquí salen el `curl` y el
 * Python de la documentación, y `ejemplosDocs.test.ts` ejecuta esta misma
 * petición contra el servidor y valida la respuesta. Así un ejemplo no puede
 * mentir sin que falle un test.
 */
export interface EjemploPeticion {
  /** Con `{id}` o `{token}`: se sustituyen con `valores` al mostrarla. */
  ruta: string;
  /** Lo que se muestra en la documentación en lugar de cada `{marcador}`. */
  valores?: Record<string, string>;
  query?: Record<string, string>;
  /** false en la descarga, que no lleva key. */
  conKey: boolean;
  /** La respuesta es un archivo, no JSON. */
  binario?: boolean;
}

/**
 * La URL de un ejemplo. `valores` sustituye los `{marcadores}` de la ruta; si no
 * se pasa, se usan los del propio ejemplo. El test pasa los de sus fixtures.
 */
export function urlDeEjemplo(base: string, e: EjemploPeticion, valores = e.valores ?? {}): string {
  const ruta = e.ruta.replace(/\{(\w+)\}/g, (_, k: string) => encodeURIComponent(valores[k] ?? `{${k}}`));
  const qs = e.query ? `?${new URLSearchParams(e.query).toString()}` : '';
  return `${base}${ruta}${qs}`;
}

export function curlDe(base: string, e: EjemploPeticion): string {
  // La descarga usa la `url` que devolvió la API, tal cual: no se construye.
  const url = e.binario ? '$URL_DEL_ENLACE' : urlDeEjemplo(base, e);
  const lineas = [`curl "${url}"`];
  if (e.conKey) lineas.push('  -H "X-API-Key: $ASTA_API_KEY"');
  if (e.binario) lineas.push('  -o factura.pdf');
  return lineas.join(' \\\n');
}

/** Python con la biblioteca estándar: se ejecuta sin instalar nada. */
export function pythonDe(base: string, e: EjemploPeticion): string {
  const cabeceras = e.conKey ? '{"X-API-Key": os.environ["ASTA_API_KEY"]}' : '{}';
  const url = e.binario ? 'os.environ["URL_DEL_ENLACE"]' : `"${urlDeEjemplo(base, e)}"`;
  const lineas = [
    'import json, os, urllib.request',
    '',
    'peticion = urllib.request.Request(',
    `    ${url},`,
    `    headers=${cabeceras},`,
    ')',
    'with urllib.request.urlopen(peticion) as respuesta:',
  ];
  if (e.binario) {
    lineas.push('    with open("factura.pdf", "wb") as f:', '        f.write(respuesta.read())');
  } else {
    lineas.push('    datos = json.load(respuesta)', 'print(datos)');
  }
  return lineas.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Operaciones
// ─────────────────────────────────────────────────────────────────────────────

export interface Operacion {
  metodo: 'get';
  ruta: string;
  id: string;
  resumen: string;
  descripcion: string;
  scope: string | null;
  parametrosRuta?: Array<{ nombre: string; descripcion: string; esquema: Json }>;
  query?: z.ZodObject;
  exito: { schema?: z.ZodType; binario?: boolean; descripcion: string; ejemploRespuesta?: unknown };
  errores: ErrorCode[];
  ejemplo: EjemploPeticion;
}

/** Errores que puede dar cualquier ruta con API key. */
const ERRORES_CON_KEY: ErrorCode[] = ['MISSING_API_KEY', 'INVALID_API_KEY', 'INSUFFICIENT_SCOPE', 'PARTNER_ID_NOT_ALLOWED', 'RATE_LIMITED', 'ODOO_UNAVAILABLE', 'INTERNAL_ERROR'];

/**
 * Las operaciones publicadas. Los endpoints que responden 501 NO están: según
 * la política de versiones no son contrato hasta que se implementen.
 *
 * `rutasDocumentadas.test.ts` compara esta lista con las rutas montadas en
 * Express, en los dos sentidos.
 */
export const OPERACIONES: Operacion[] = [
  {
    metodo: 'get',
    ruta: '/api/v1/public/invoices',
    id: 'listarFacturas',
    resumen: 'Listar tus facturas',
    descripcion: 'Facturas contabilizadas de tu empresa, de la más reciente a la más antigua. Solo facturas: las notas de crédito no aparecen.',
    scope: 'INVOICES_READ',
    query: publicInvoiceListQuerySchema,
    exito: {
      schema: publicInvoiceListResponseSchema,
      descripcion: 'Una página de facturas.',
      ejemploRespuesta: {
        data: [{ id: 1001, folio: 'F-0001', fecha: '2026-09-14', vencimiento: '2026-10-14', estadoPago: 'not_paid', total: 1250.4, saldo: 1250.4 }],
        meta: { pagina: 1, porPagina: 50, total: 1 },
      },
    },
    errores: ['INVALID_QUERY', ...ERRORES_CON_KEY],
    ejemplo: { ruta: '/api/v1/public/invoices', query: { estadoPago: 'not_paid', porPagina: '20' }, conKey: true },
  },
  {
    metodo: 'get',
    ruta: '/api/v1/public/invoices/{id}',
    id: 'verFactura',
    resumen: 'Ver una factura',
    descripcion: 'Una factura de tu empresa. Una factura que no existe y una de otra empresa dan la misma respuesta 404.',
    scope: 'INVOICES_READ',
    parametrosRuta: [{ nombre: 'id', descripcion: 'Identificador de la factura, el `id` del listado.', esquema: { type: 'integer', minimum: 1 } }],
    exito: {
      schema: publicInvoiceDetailResponseSchema,
      descripcion: 'La factura.',
      ejemploRespuesta: { data: { id: 1001, folio: 'F-0001', fecha: '2026-09-14', vencimiento: '2026-10-14', estadoPago: 'paid', total: 1250.4, saldo: 0 } },
    },
    errores: ['INVALID_INVOICE_ID', 'INVOICE_NOT_FOUND', ...ERRORES_CON_KEY],
    ejemplo: { ruta: '/api/v1/public/invoices/{id}', valores: { id: '1001' }, conKey: true },
  },
  {
    metodo: 'get',
    ruta: '/api/v1/public/invoices/{id}/pdf',
    id: 'enlacePdfFactura',
    resumen: 'Obtener el enlace al PDF de una factura',
    descripcion:
      'Devuelve un enlace de descarga que caduca a los 5 minutos. El enlace NO necesita API key, así que se puede abrir en un navegador o reenviar: trátalo como una credencial mientras dure. Deja de funcionar si la key se revoca o pierde el permiso `INVOICES_READ`.',
    scope: 'INVOICES_READ',
    parametrosRuta: [{ nombre: 'id', descripcion: 'Identificador de la factura.', esquema: { type: 'integer', minimum: 1 } }],
    exito: {
      schema: publicInvoicePdfLinkResponseSchema,
      descripcion: 'El enlace y su caducidad.',
      ejemploRespuesta: { data: { url: 'https://api.ejemplo.com/api/v1/descargas/facturas/eyJmIjoxMDAxfQ.ZmlybWE', expiraEn: '2026-09-15T18:05:00.000Z' } },
    },
    errores: ['INVALID_INVOICE_ID', 'INVOICE_NOT_FOUND', 'INVOICE_PDF_NOT_AVAILABLE', ...ERRORES_CON_KEY],
    ejemplo: { ruta: '/api/v1/public/invoices/{id}/pdf', valores: { id: '1001' }, conKey: true },
  },
  {
    metodo: 'get',
    ruta: '/api/v1/descargas/facturas/{token}',
    id: 'descargarPdfFactura',
    resumen: 'Descargar el PDF de una factura',
    descripcion: 'La URL que devuelve `/invoices/{id}/pdf`. No lleva API key: la autoriza el propio enlace. Límite de 30 descargas por minuto por IP.',
    scope: null,
    parametrosRuta: [{ nombre: 'token', descripcion: 'Parte final del enlace. No lo construyas: usa la `url` tal cual.', esquema: { type: 'string' } }],
    exito: { binario: true, descripcion: 'El PDF de la factura.' },
    errores: ['LINK_NOT_VALID', 'LINK_EXPIRED', 'RATE_LIMITED', 'ODOO_UNAVAILABLE', 'INTERNAL_ERROR'],
    ejemplo: { ruta: '/api/v1/descargas/facturas/{token}', conKey: false, binario: true },
  },
  {
    metodo: 'get',
    ruta: '/api/v1/public/inventory',
    id: 'listarInventario',
    resumen: 'Consultar existencias',
    descripcion:
      'Productos a la venta con su existencia en el almacén que te vende, descontando lo ya reservado. Se publica como estado, no como cantidad. Sin precios: llegarán con el endpoint de precios. Las respuestas pueden venir de una cache de hasta 60 segundos (`meta.desdeCache`).',
    scope: 'INVENTORY_READ',
    query: inventoryQuerySchema,
    exito: {
      schema: publicInventoryListResponseSchema,
      descripcion: 'Una página de productos.',
      ejemploRespuesta: {
        data: [{ id: 2001, templateId: 3001, sku: 'TON-0001', nombre: 'TÓNER NEGRO DE EJEMPLO', categoria: 'CONSUMIBLES', stock: 'disponible' }],
        meta: { pagina: 1, porPagina: 50, total: 1, desdeCache: false },
      },
    },
    errores: ['INVALID_QUERY', 'INVENTORY_UNAVAILABLE', ...ERRORES_CON_KEY],
    ejemplo: { ruta: '/api/v1/public/inventory', query: { q: 'toner', soloDisponibles: 'true' }, conKey: true },
  },
  {
    metodo: 'get',
    ruta: '/api/v1/public/recommender/printers',
    id: 'buscarImpresoras',
    resumen: 'Buscar una impresora',
    descripcion:
      'Encuentra el modelo de impresora a partir de lo que teclea una persona, con o sin marca, guiones ni espacios: `hl2350` encuentra la HL-L2350DW. Si no hay coincidencias, `sugerencias` trae modelos parecidos para preguntar «¿quisiste decir…?». El catálogo puede tardar hasta 5 minutos en reflejar un modelo nuevo.',
    scope: 'RECOMMENDER_READ',
    query: printerSearchQuerySchema,
    exito: {
      schema: publicPrinterSearchResponseSchema,
      descripcion: 'Las impresoras que coinciden, o sugerencias si no coincide ninguna.',
      ejemploRespuesta: { data: [{ id: 42, marca: 'HP', nombre: 'LaserJet Pro M404dn' }], sugerencias: [] },
    },
    errores: ['INVALID_QUERY', ...ERRORES_CON_KEY],
    ejemplo: { ruta: '/api/v1/public/recommender/printers', query: { q: 'm404dn' }, conKey: true },
  },
  {
    metodo: 'get',
    ruta: '/api/v1/public/recommender/printers/{printerId}/compatible',
    id: 'productosCompatibles',
    resumen: 'Productos compatibles con una impresora',
    descripcion:
      'Los productos que sirven para esa impresora, originales y compatibles, con su existencia en el almacén que te vende; primero los que hay. Solo compatibilidades verificadas: si todavía no hay ninguna, `data` viene vacío y `meta.sinCompatibilidadesCargadas` es `true`. Sin precios: llegarán con el endpoint de precios. Las respuestas pueden venir de una cache de hasta 60 segundos (`meta.desdeCache`).',
    scope: 'RECOMMENDER_READ',
    parametrosRuta: [{ nombre: 'printerId', descripcion: 'El `id` de la impresora, de `/recommender/printers`.', esquema: { type: 'integer', minimum: 1 } }],
    query: compatibleQuerySchema,
    exito: {
      schema: publicCompatibleResponseSchema,
      descripcion: 'Los productos compatibles.',
      ejemploRespuesta: {
        data: [
          {
            id: 2001,
            templateId: 3001,
            sku: 'TON-0001',
            nombre: 'TÓNER NEGRO DE EJEMPLO',
            stock: 'disponible',
            tipo: 'original',
            cartuchos: [{ marca: 'HP', codigo: 'CF258A', tipo: 'toner', color: 'negro', rendimientoPaginas: 3000 }],
          },
        ],
        meta: { impresora: { id: 42, marca: 'HP', nombre: 'LaserJet Pro M404dn' }, sinCompatibilidadesCargadas: false, desdeCache: false },
      },
    },
    errores: ['INVALID_QUERY', 'PRINTER_NOT_FOUND', 'INVENTORY_UNAVAILABLE', ...ERRORES_CON_KEY],
    ejemplo: { ruta: '/api/v1/public/recommender/printers/{printerId}/compatible', valores: { printerId: '42' }, conKey: true },
  },
];

function etiquetaDe(ruta: string): string {
  if (ruta.includes('/recommender/')) return 'Recomendador';
  return ruta.includes('inventory') ? 'Inventario' : 'Facturas';
}

// ─────────────────────────────────────────────────────────────────────────────
// Documento
// ─────────────────────────────────────────────────────────────────────────────

const CABECERAS_RATE_LIMIT: Json = {
  'RateLimit-Limit': { description: 'Peticiones permitidas en la ventana.', schema: { type: 'integer' } },
  'RateLimit-Remaining': { description: 'Peticiones que quedan en la ventana.', schema: { type: 'integer' } },
  'RateLimit-Reset': { description: 'Segundos hasta que se reinicia la ventana.', schema: { type: 'integer' } },
};

function respuestaDeError(codes: ErrorCode[]): Json {
  const tabla = codes.map((c) => `\`${c}\``).join(', ');
  return {
    description: `Códigos posibles: ${tabla}.`,
    content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
  };
}

/**
 * @param base URL del servidor, sin barra final. En el archivo versionado del
 *   repositorio va un marcador; al servirla, la del propio servidor.
 */
export function construirOpenApi(base = 'https://{servidor}'): Json {
  const paths: Record<string, Json> = {};

  for (const op of OPERACIONES) {
    const parametros: Json[] = [
      ...(op.parametrosRuta ?? []).map((p) => ({ name: p.nombre, in: 'path', required: true, description: p.descripcion, schema: p.esquema })),
      ...(op.query ? parametrosDeQuery(op.query) : []),
    ];

    const respuestas: Record<string, Json> = {
      200: op.exito.binario
        ? {
            description: op.exito.descripcion,
            content: { 'application/pdf': { schema: { type: 'string', contentMediaType: 'application/pdf' } } },
          }
        : {
            description: op.exito.descripcion,
            headers: op.scope ? CABECERAS_RATE_LIMIT : undefined,
            content: {
              'application/json': {
                schema: esquemaDeRespuesta(op.exito.schema as z.ZodType),
                example: op.exito.ejemploRespuesta,
              },
            },
          },
    };

    const porStatus = new Map<number, ErrorCode[]>();
    for (const code of op.errores) {
      const status = HTTP_STATUS_BY_ERROR[code];
      porStatus.set(status, [...(porStatus.get(status) ?? []), code]);
    }
    for (const [status, codes] of [...porStatus].sort((a, b) => a[0] - b[0])) {
      const r = respuestaDeError(codes);
      if (status === 429) r.headers = { 'Retry-After': { description: 'Segundos que hay que esperar.', schema: { type: 'integer' } } };
      respuestas[status] = r;
    }

    paths[op.ruta] = {
      [op.metodo]: {
        operationId: op.id,
        summary: op.resumen,
        description: op.scope ? `${op.descripcion}\n\nPermiso necesario: \`${op.scope}\`.` : op.descripcion,
        tags: [etiquetaDe(op.ruta)],
        security: op.scope ? [{ ApiKey: [] }] : [],
        parameters: parametros,
        responses: respuestas,
        'x-codeSamples': [
          { lang: 'curl', label: 'curl', source: curlDe(base, op.ejemplo) },
          { lang: 'Python', label: 'Python', source: pythonDe(base, op.ejemplo) },
        ],
      },
    };
  }

  return {
    openapi: ESTADO_OPENAPI,
    info: {
      title: 'API pública de Asta',
      version: '1.0.0',
      description: guiaEnMarkdown(GUIA, tablaDeErrores()),
    },
    servers: [{ url: base }],
    tags: [
      { name: 'Facturas', description: 'Tus facturas y sus PDF.' },
      { name: 'Inventario', description: 'Existencias del catálogo.' },
      { name: 'Recomendador', description: 'Qué producto le sirve a una impresora.' },
    ],
    security: [{ ApiKey: [] }],
    paths,
    components: {
      securitySchemes: {
        ApiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key', description: 'Tu API key. Se crea en el panel, en «Mis API keys».' },
      },
      schemas: { Error: esquemaDeError() },
    },
  };
}
