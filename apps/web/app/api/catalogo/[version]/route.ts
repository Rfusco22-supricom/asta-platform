import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NextResponse } from 'next/server';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb } from 'pdf-lib';
import { catalogoAstaSchema } from '@asta/shared-types';
import { z } from 'zod';
import { getSession } from '@/lib/session';

/**
 * El PDF del catálogo ASTA, con o sin precios, para que el vendedor se lo mande
 * a sus clientes.
 *
 * ── Los precios se ponen al descargarlo ──────────────────────────────────────
 *
 * El repositorio es público, así que el PDF guardado (`privado/catalogo/`) no
 * lleva precios: deja su hueco, y `catalogo-asta.huecos.json` dice dónde va el
 * de cada código. Aquí se piden las fichas al middleware —que decide quién
 * puede verlas (`catalogo.asta.ver`) y trae los precios de hoy de Odoo— y se
 * escriben en su sitio, con la tipografía del catálogo. Así el PDF dice lo
 * mismo que la página.
 *
 * Se pregunta al middleware también para el PDF sin precios: la cookie del
 * usuario no basta para decidir el rol, el navegador la puede cambiar.
 */

const MIDDLEWARE_URL = process.env.MIDDLEWARE_URL ?? 'http://localhost:3001';
const CARPETA = join(process.cwd(), 'privado', 'catalogo');

const huecosSchema = z.object({
  fuente: z.number(),
  color: z.string(),
  huecos: z.array(z.object({ pagina: z.number(), x: z.number(), y: z.number(), codigo: z.string() })),
});

const NOMBRES: Record<string, string> = { precios: 'Catálogo ASTA con precios.pdf', fotos: 'Catálogo ASTA.pdf' };

/** «$1.234,56», como en el resto del panel y en el catálogo. */
function formato(n: number): string {
  const [entero, dec] = n.toFixed(2).split('.');
  return `$${entero.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${dec}`;
}

function color(hex: string) {
  const n = Number.parseInt(hex.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

export async function GET(_req: Request, { params }: { params: Promise<{ version: string }> }) {
  const version = (await params).version;
  const nombre = NOMBRES[version];
  if (!nombre) return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'No existe ese catálogo.' } }, { status: 404 });
  const sesion = await getSession();
  if (!sesion) return NextResponse.json({ error: { code: 'UNAUTHENTICATED', message: 'Sin sesión.' } }, { status: 401 });

  let res: Response;
  try {
    res = await fetch(`${MIDDLEWARE_URL}/api/v1/salesperson/catalogo`, {
      headers: { Authorization: `Bearer ${sesion.accessToken}` },
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'El middleware no responde.' } }, { status: 503 });
  }
  if (!res.ok) return NextResponse.json((await res.json().catch(() => null)) ?? {}, { status: res.status });

  let pdf: Uint8Array = await readFile(join(CARPETA, 'catalogo-asta.pdf'));
  if (version === 'precios') {
    const { data } = z.object({ data: catalogoAstaSchema }).parse(await res.json());
    if (!data.preciosLeidos) {
      return NextResponse.json(
        { error: { code: 'INTERNAL_ERROR', message: 'No se pudieron leer los precios de Odoo. Prueba en un momento.' } },
        { status: 503 },
      );
    }
    const precio = new Map(data.fichas.flatMap((f) => f.variantes.map((v) => [v.codigo, v.precio] as const)));
    const posiciones = huecosSchema.parse(JSON.parse(await readFile(join(CARPETA, 'catalogo-asta.huecos.json'), 'utf8')));

    const doc = await PDFDocument.load(pdf);
    doc.registerFontkit(fontkit);
    const fuente = await doc.embedFont(await readFile(join(CARPETA, 'sora_semibold.ttf')), { subset: true });
    const paginas = doc.getPages();
    const azul = color(posiciones.color);
    for (const h of posiciones.huecos) {
      const p = precio.get(h.codigo);
      const pagina = paginas[h.pagina];
      if (p == null || !pagina) continue;
      const texto = formato(p);
      pagina.drawText(texto, {
        x: h.x - fuente.widthOfTextAtSize(texto, posiciones.fuente),
        y: h.y,
        size: posiciones.fuente,
        font: fuente,
        color: azul,
      });
    }
    pdf = await doc.save();
  }

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="catalogo-asta.pdf"; filename*=UTF-8''${encodeURIComponent(nombre)}`,
      'Cache-Control': 'private, no-store',
    },
  });
}
