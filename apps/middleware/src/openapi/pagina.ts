import { z } from 'zod';
import { GUIA, enLinea, escaparHtml, guiaEnHtml } from './guia.js';
import { curlDe, esquemaDeRespuesta, OPERACIONES, pythonDe, tablaDeErrores, type Operacion } from './especificacion.js';
import { HTTP_STATUS_BY_ERROR } from '@asta/shared-types';

/**
 * Página de documentación de la API pública (#35), generada en el servidor.
 *
 * Sin JavaScript y sin nada de un CDN, a propósito. Los visores habituales
 * (Redoc, Swagger UI) cargan un script de terceros en la misma origen que la
 * API: abrirles la CSP de `helmet` para eso es añadir una dependencia en tiempo
 * de ejecución a la página que más clientes van a abrir. Esto es HTML plano con
 * un índice, y la especificación completa está en `openapi.json` para quien
 * quiera su visor o generar un cliente.
 *
 * Todo lo que llega de fuera se escapa, y lo único que llega de fuera es el
 * `Host` de la petición, con el que se construyen los ejemplos.
 */

type Json = Record<string, unknown>;

interface Campo {
  nombre: string;
  tipo: string;
  descripcion: string;
}

function tipoDe(p: Json): string {
  if (Array.isArray(p.anyOf)) {
    const tipos = (p.anyOf as Json[]).map(tipoDe);
    return tipos.join(' | ');
  }
  if (Array.isArray(p.type)) return (p.type as string[]).join(' | ');
  if (p.enum) return (p.enum as string[]).map((v) => `"${v}"`).join(' | ');
  if (p.format) return `${p.type} (${p.format})`;
  return String(p.type ?? 'objeto');
}

/** Campos de un objeto, bajando por `data` y por los arrays. */
function camposDe(schema: Json, prefijo = ''): Campo[] {
  const props = (schema.properties ?? {}) as Record<string, Json>;
  return Object.entries(props).flatMap(([nombre, p]) => {
    const ruta = prefijo ? `${prefijo}.${nombre}` : nombre;
    if (p.type === 'object') return camposDe(p, ruta);
    if (p.type === 'array' && (p.items as Json)?.type === 'object') return camposDe(p.items as Json, `${ruta}[]`);
    const descripcion = String(p.description ?? (Array.isArray(p.anyOf) ? ((p.anyOf as Json[]).find((x) => x.description)?.description ?? '') : ''));
    return [{ nombre: ruta, tipo: tipoDe(p), descripcion }];
  });
}

function parametros(op: Operacion): Array<Campo & { donde: string }> {
  const deRuta = (op.parametrosRuta ?? []).map((p) => ({ nombre: p.nombre, tipo: String(p.esquema.type), descripcion: p.descripcion, donde: 'ruta' }));
  if (!op.query) return deRuta;
  const json = z.toJSONSchema(op.query, { io: 'input', unrepresentable: 'any' }) as { properties: Record<string, Json> };
  const deQuery = Object.entries(json.properties).map(([nombre, p]) => ({
    nombre,
    tipo: nombre === 'soloDisponibles' ? 'boolean' : tipoDe(p),
    descripcion: `${p.description ?? ''}${p.default !== undefined ? ` Por defecto: \`${String(p.default)}\`.` : ''}`,
    donde: 'query',
  }));
  return [...deRuta, ...deQuery];
}

function tabla(cabeceras: string[], filas: string[][]): string {
  return `<div class="tabla"><table><thead><tr>${cabeceras.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${filas
    .map((f) => `<tr>${f.map((c) => `<td>${c}</td>`).join('')}</tr>`)
    .join('')}</tbody></table></div>`;
}

function seccionOperacion(op: Operacion, base: string): string {
  const params = parametros(op);
  const errores = [...new Set(op.errores)].map((code) => `<code>${HTTP_STATUS_BY_ERROR[code]} ${code}</code>`).join(' ');
  const campos = op.exito.schema ? camposDe(esquemaDeRespuesta(op.exito.schema)) : [];

  return `<section id="${op.id}" class="operacion">
<h3><span class="metodo">${op.metodo.toUpperCase()}</span> <code>${escaparHtml(op.ruta)}</code></h3>
<p class="resumen">${escaparHtml(op.resumen)}</p>
<p>${enLinea(op.descripcion)}</p>
<p>${op.scope ? `Permiso: <code>${op.scope}</code>` : 'Sin API key: lo autoriza el enlace.'}</p>
${params.length ? `<h4>Parámetros</h4>${tabla(['Nombre', 'En', 'Tipo', 'Descripción'], params.map((p) => [`<code>${p.nombre}</code>`, p.donde, escaparHtml(p.tipo), enLinea(p.descripcion)]))}` : ''}
<h4>Respuesta</h4>
<p>${enLinea(op.exito.descripcion)}${op.exito.binario ? ' (<code>application/pdf</code>)' : ''}</p>
${campos.length ? tabla(['Campo', 'Tipo', 'Descripción'], campos.map((c) => [`<code>${escaparHtml(c.nombre)}</code>`, escaparHtml(c.tipo), enLinea(c.descripcion)])) : ''}
${op.exito.ejemploRespuesta ? `<pre><code>${escaparHtml(JSON.stringify(op.exito.ejemploRespuesta, null, 2))}</code></pre>` : ''}
<h4>Errores posibles</h4>
<p class="errores">${errores}</p>
<h4>Ejemplos</h4>
<p class="etiqueta">curl</p>
<pre><code>${escaparHtml(curlDe(base, op.ejemplo))}</code></pre>
<p class="etiqueta">Python (sin dependencias)</p>
<pre><code>${escaparHtml(pythonDe(base, op.ejemplo))}</code></pre>
</section>`;
}

const ESTILOS = `
:root{--fondo:#fbfaf7;--texto:#1d1d1f;--suave:#5f6368;--borde:#e3e0d8;--codigo:#f1eee6;--acento:#1a5fb4}
@media (prefers-color-scheme:dark){:root{--fondo:#16171a;--texto:#e8e6e3;--suave:#a0a4ab;--borde:#2c2e33;--codigo:#202227;--acento:#78aeed}}
*{box-sizing:border-box}
body{margin:0;background:var(--fondo);color:var(--texto);font:15px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}
.marco{display:grid;grid-template-columns:240px minmax(0,1fr);max-width:1180px;margin:0 auto}
nav{position:sticky;top:0;align-self:start;height:100vh;overflow:auto;padding:28px 20px;border-right:1px solid var(--borde);font-size:14px}
nav a{display:block;color:var(--suave);text-decoration:none;padding:3px 0}
nav a:hover{color:var(--acento)}
nav .grupo{margin:18px 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--suave)}
main{padding:28px 40px 80px;min-width:0}
h1{font-size:28px;margin:0 0 4px}
h2{font-size:21px;margin:44px 0 10px;padding-top:12px;border-top:1px solid var(--borde)}
h3{font-size:17px;margin:0 0 4px}
h4{font-size:14px;margin:20px 0 6px;color:var(--suave);text-transform:uppercase;letter-spacing:.04em}
.operacion{margin:36px 0;padding:22px 24px;border:1px solid var(--borde);border-radius:10px}
.metodo{display:inline-block;font-size:12px;font-weight:700;padding:1px 8px;border-radius:5px;background:var(--acento);color:var(--fondo);vertical-align:2px}
.resumen{margin:0 0 8px;color:var(--suave)}
code{font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:var(--codigo);padding:1px 5px;border-radius:4px}
pre{background:var(--codigo);padding:14px 16px;border-radius:8px;overflow-x:auto}
pre code{padding:0;background:none}
.tabla{overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:14px}
th,td{text-align:left;vertical-align:top;padding:7px 10px;border-bottom:1px solid var(--borde)}
th{color:var(--suave);font-weight:600}
.errores code{display:inline-block;margin:0 4px 6px 0}
.etiqueta{margin:12px 0 4px;font-size:13px;color:var(--suave)}
.sub{color:var(--suave);margin:0 0 20px}
@media (max-width:820px){.marco{grid-template-columns:1fr}nav{position:static;height:auto;border-right:0;border-bottom:1px solid var(--borde)}main{padding:20px 16px}.operacion{padding:16px 14px}table{min-width:560px}}
`;

/** @param base URL del servidor, sin barra final, tal como la ve el cliente. */
export function paginaDocumentacion(base: string): string {
  const indiceGuia = GUIA.map((s) => `<a href="#${s.id}">${escaparHtml(s.titulo)}</a>`).join('');
  const indiceOps = OPERACIONES.map((op) => `<a href="#${op.id}">${escaparHtml(op.resumen)}</a>`).join('');

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>API pública de Asta</title>
<style>${ESTILOS}</style>
</head>
<body>
<div class="marco">
<nav>
<div class="grupo">Guía</div>${indiceGuia}
<div class="grupo">Endpoints</div>${indiceOps}
<div class="grupo">Especificación</div><a href="/api/v1/docs/openapi.json">openapi.json</a>
</nav>
<main>
<h1>API pública de Asta</h1>
<p class="sub">Versión 1 · Servidor: <code>${escaparHtml(base)}</code></p>
${guiaEnHtml(GUIA, tablaDeErrores()).replaceAll('https://{servidor}', escaparHtml(base))}
<h2 id="endpoints">Endpoints</h2>
${OPERACIONES.map((op) => seccionOperacion(op, base)).join('\n')}
</main>
</div>
</body>
</html>`;
}
