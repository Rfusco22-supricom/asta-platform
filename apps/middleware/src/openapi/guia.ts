/**
 * La guía de integración de la API pública (#35).
 *
 * Estructurada y no en Markdown suelto: el mismo contenido sale como HTML en la
 * página de documentación y como Markdown en `info.description` de la
 * especificación OpenAPI, sin depender de un conversor de Markdown.
 *
 * Marcado en línea admitido en los textos: `código` y **negrita**.
 *
 * Cada cifra de aquí (límites, duraciones) está atada a una constante del
 * código por `guia.test.ts`: si cambia el límite y no la guía, falla.
 */

export type Bloque =
  | { tipo: 'p'; texto: string }
  | { tipo: 'lista'; items: string[] }
  | { tipo: 'codigo'; texto: string }
  | { tipo: 'tablaErrores' };

export interface Seccion {
  id: string;
  titulo: string;
  bloques: Bloque[];
}

export const LIMITES_DOCUMENTADOS = {
  porKeyPorDefecto: 60,
  fallosDeAutenticacionPorIp: 50,
  ventanaFallosMinutos: 15,
  descargasPorMinutoPorIp: 30,
  enlacePdfMinutos: 5,
  cacheInventarioSegundos: 60,
  maxPorPagina: 100,
  porPaginaPorDefecto: 50,
  convivenciaVersionesMeses: 6,
  avisoEnumeracionesDias: 30,
};

const L = LIMITES_DOCUMENTADOS;

export const GUIA: Seccion[] = [
  {
    id: 'primeros-pasos',
    titulo: 'Primeros pasos',
    bloques: [
      { tipo: 'p', texto: 'La API da acceso a los datos de **tu empresa**: tus facturas y sus PDF, y las existencias del catálogo. Todo lo que devuelve es tuyo; no hay forma de pedir datos de otra empresa.' },
      {
        tipo: 'lista',
        items: [
          'Entra al panel y abre **Mis API keys**.',
          'Crea una key con los permisos que necesite tu integración: `INVOICES_READ` para facturas, `INVENTORY_READ` para existencias.',
          'Copia la key en ese momento. **Solo se muestra una vez**; si la pierdes, crea otra y revoca la anterior.',
          'Haz tu primera petición:',
        ],
      },
      { tipo: 'codigo', texto: 'curl "https://{servidor}/api/v1/public/invoices?porPagina=5" \\\n  -H "X-API-Key: $ASTA_API_KEY"' },
    ],
  },
  {
    id: 'autenticacion',
    titulo: 'Autenticación',
    bloques: [
      { tipo: 'p', texto: 'Envía la key en la cabecera `X-API-Key` en cada petición. También se acepta `Authorization: Bearer <key>`.' },
      {
        tipo: 'lista',
        items: [
          '**Nunca** la pongas en la URL: las URLs quedan en logs, historiales y proxies.',
          'Guárdala como un secreto del servidor, no en código que llegue a un navegador o a una app.',
          'Una key por integración. Si una se filtra, revócala en el panel: deja de funcionar en el acto, y con ella los enlaces de PDF que haya emitido.',
          'Si quieres que una key solo funcione desde ciertas IPs, pídelo a soporte. Desde cualquier otra IP responderá `401 INVALID_API_KEY`.',
        ],
      },
    ],
  },
  {
    id: 'limites',
    titulo: 'Límites de peticiones',
    bloques: [
      {
        tipo: 'lista',
        items: [
          `**Por key:** ${L.porKeyPorDefecto} peticiones por minuto, salvo que se haya acordado otro límite para tu key.`,
          `**Autenticación fallida:** tras ${L.fallosDeAutenticacionPorIp} peticiones con una key inválida desde la misma IP en ${L.ventanaFallosMinutos} minutos, esa IP queda bloqueada hasta que termine la ventana, **también para las peticiones con una key válida**. Si tu integración reintenta en bucle con una key revocada, se bloquea a sí misma.`,
          `**Descargas de PDF:** ${L.descargasPorMinutoPorIp} por minuto por IP.`,
        ],
      },
      { tipo: 'p', texto: 'Cada respuesta lleva `RateLimit-Limit`, `RateLimit-Remaining` y `RateLimit-Reset`. Al superar un límite la respuesta es `429 RATE_LIMITED` con `Retry-After` en segundos: espera ese tiempo antes de reintentar.' },
    ],
  },
  {
    id: 'paginacion',
    titulo: 'Paginación',
    bloques: [
      { tipo: 'p', texto: `Los listados se paginan con \`pagina\` (desde 1) y \`porPagina\` (por defecto ${L.porPaginaPorDefecto}, máximo ${L.maxPorPagina}). \`meta.total\` es el total de resultados con esos filtros: sigue pidiendo páginas mientras \`pagina × porPagina < total\`.` },
      { tipo: 'p', texto: `Las existencias pueden venir de una cache de hasta ${L.cacheInventarioSegundos} segundos; \`meta.desdeCache\` lo indica.` },
    ],
  },
  {
    id: 'errores',
    titulo: 'Errores',
    bloques: [
      { tipo: 'p', texto: 'Todo error responde con la misma forma:' },
      { tipo: 'codigo', texto: '{\n  "error": {\n    "code": "INVOICE_NOT_FOUND",\n    "message": "Factura no encontrada."\n  }\n}' },
      { tipo: 'p', texto: 'Programa contra `code`, nunca contra `message`, que es texto para personas y puede cambiar.' },
      { tipo: 'tablaErrores' },
      { tipo: 'p', texto: 'Ante `503` o `500`, reintenta con espera creciente: 1 s, 2 s, 4 s… Ante `4xx`, no reintentes sin cambiar la petición.' },
    ],
  },
  {
    id: 'versiones',
    titulo: 'Versiones y cambios',
    bloques: [
      { tipo: 'p', texto: 'La versión va en la ruta: `/api/v1`. Dentro de una versión **no** hacemos cambios que rompan tu integración: no quitamos ni renombramos campos, no cambiamos su tipo ni su significado, y no hacemos obligatorio lo que era opcional.' },
      { tipo: 'p', texto: 'Sí podemos, dentro de la misma versión:' },
      {
        tipo: 'lista',
        items: [
          'Añadir campos a las respuestas. **Tu código debe ignorar los campos que no conoce.**',
          `Añadir valores a \`estadoPago\`, \`stock\` y \`error.code\`, avisando con ${L.avisoEnumeracionesDias} días. **Ten siempre un caso por defecto**: un \`stock\` desconocido, trátalo como \`agotado\`; un \`code\` desconocido, por su status HTTP.`,
          'Añadir endpoints y parámetros opcionales.',
        ],
      },
      { tipo: 'p', texto: `Cuando haga falta un cambio incompatible saldrá \`/api/v2\`, y \`v1\` seguirá funcionando al menos ${L.convivenciaVersionesMeses} meses. Lo avisaremos por correo a los dueños de keys activas y con las cabeceras \`Deprecation\` y \`Sunset\` en cada respuesta de la versión que se retira.` },
      { tipo: 'p', texto: 'La única excepción son los fallos de seguridad, que se corrigen de inmediato.' },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Salidas
// ─────────────────────────────────────────────────────────────────────────────

export interface FilaError {
  code: string;
  status: number;
  significado: string;
}

export function guiaEnMarkdown(secciones: Seccion[], errores: FilaError[]): string {
  const partes: string[] = [];
  for (const s of secciones) {
    partes.push(`## ${s.titulo}`);
    for (const b of s.bloques) {
      if (b.tipo === 'p') partes.push(b.texto);
      else if (b.tipo === 'lista') partes.push(b.items.map((i) => `- ${i}`).join('\n'));
      else if (b.tipo === 'codigo') partes.push('```\n' + b.texto + '\n```');
      else {
        partes.push(
          ['| Status | `code` | Qué significa |', '|---|---|---|', ...errores.map((e) => `| ${e.status} | \`${e.code}\` | ${e.significado} |`)].join('\n'),
        );
      }
    }
  }
  return partes.join('\n\n');
}

export function escaparHtml(texto: string): string {
  return texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** `código` y **negrita**, sobre texto YA escapado. */
export function enLinea(texto: string): string {
  return escaparHtml(texto)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

export function guiaEnHtml(secciones: Seccion[], errores: FilaError[]): string {
  return secciones
    .map((s) => {
      const cuerpo = s.bloques
        .map((b) => {
          if (b.tipo === 'p') return `<p>${enLinea(b.texto)}</p>`;
          if (b.tipo === 'lista') return `<ul>${b.items.map((i) => `<li>${enLinea(i)}</li>`).join('')}</ul>`;
          if (b.tipo === 'codigo') return `<pre><code>${escaparHtml(b.texto)}</code></pre>`;
          return `<div class="tabla"><table><thead><tr><th>Status</th><th><code>code</code></th><th>Qué significa</th></tr></thead><tbody>${errores
            .map((e) => `<tr><td>${e.status}</td><td><code>${escaparHtml(e.code)}</code></td><td>${enLinea(e.significado)}</td></tr>`)
            .join('')}</tbody></table></div>`;
        })
        .join('\n');
      return `<section id="${s.id}"><h2>${escaparHtml(s.titulo)}</h2>\n${cuerpo}</section>`;
    })
    .join('\n');
}
