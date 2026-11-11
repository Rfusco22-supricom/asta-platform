'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { DatosFlyer, ProductoFlyer } from '@asta/shared-types';

/**
 * El editor de flyers: el cliente elige plantilla y formato, revisa los datos
 * de su tienda y descarga la imagen. Todo se dibuja aquí, en un `canvas`: no
 * sale nada de su navegador, y la foto del producto llega por el panel (mismo
 * origen), así que la imagen se puede exportar.
 *
 * Nada de «distribuidor oficial» ni «autorizado» en las plantillas: eso es un
 * beneficio de un nivel concreto, no de cualquier tienda.
 */

type Plantilla = 'asta' | 'tienda' | 'producto' | 'busca';
type Formato = 'post' | 'historia';

const PLANTILLAS: { clave: Plantilla; titulo: string }[] = [
  { clave: 'asta', titulo: 'Plantilla ASTA' },
  { clave: 'tienda', titulo: 'Tu tienda' },
  { clave: 'producto', titulo: 'Un producto' },
  { clave: 'busca', titulo: 'Encuentra tu tóner' },
];

const DESCRIPCION: Record<Plantilla, string> = {
  asta: 'La de la marca: titular, producto y tu tienda',
  tienda: 'Tu tienda y que vendes ASTA',
  producto: 'Un producto con su foto y precio',
  busca: 'Invita a preguntar por su tóner',
};

const FORMATOS: { clave: Formato; titulo: string; alto: number }[] = [
  { clave: 'post', titulo: 'Publicación (cuadrada)', alto: 1080 },
  { clave: 'historia', titulo: 'Historia / estado', alto: 1920 },
];

const ANCHO = 1080;
const AZUL_NOCHE = '#0b1e3a';
const AZUL = '#1c8cdb';
const CIAN = '#5bc0eb';

interface Campos {
  /** La segunda línea del titular de la plantilla ASTA. */
  linea2: string;
  nombre: string;
  telefono: string;
  direccion: string;
  instagram: string;
  destacado: string;
  precio: string;
}

function cargarImagen(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

type Imagen = HTMLImageElement | HTMLCanvasElement;

/**
 * La foto sin el margen blanco que traen las de Odoo: se recorta al rectángulo
 * donde hay producto, con un poco de aire. Así el producto sale más grande en
 * el flyer. La foto llega por el panel (mismo origen), así que se puede leer.
 */
function sinMargen(img: HTMLImageElement): Imagen {
  try {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx || !c.width || !c.height) return img;
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
    for (let y = 0; y < c.height; y += 2) {
      for (let x = 0; x < c.width; x += 2) {
        const i = (y * c.width + x) * 4;
        const blanco = data[i]! > 238 && data[i + 1]! > 238 && data[i + 2]! > 238;
        if (data[i + 3]! > 16 && !blanco) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) return img;
    const aire = Math.round(Math.max(x1 - x0, y1 - y0) * 0.03);
    x0 = Math.max(0, x0 - aire);
    y0 = Math.max(0, y0 - aire);
    x1 = Math.min(c.width - 1, x1 + aire);
    y1 = Math.min(c.height - 1, y1 + aire);
    const r = document.createElement('canvas');
    r.width = x1 - x0 + 1;
    r.height = y1 - y0 + 1;
    r.getContext('2d')!.drawImage(c, x0, y0, r.width, r.height, 0, 0, r.width, r.height);
    return r;
  } catch {
    return img;
  }
}

/** Parte un texto en líneas que caben en `ancho`; como mucho `max`, con «…» en la última. */
function lineas(ctx: CanvasRenderingContext2D, texto: string, ancho: number, max: number): string[] {
  const palabras = texto.trim().split(/\s+/).filter(Boolean);
  const r: string[] = [];
  let actual = '';
  for (const p of palabras) {
    const prueba = actual ? `${actual} ${p}` : p;
    if (ctx.measureText(prueba).width <= ancho || !actual) actual = prueba;
    else {
      r.push(actual);
      actual = p;
    }
  }
  if (actual) r.push(actual);
  if (r.length > max) {
    const cortadas = r.slice(0, max);
    let ultima = cortadas[max - 1]!;
    while (ultima && ctx.measureText(`${ultima}…`).width > ancho) ultima = ultima.slice(0, -1);
    cortadas[max - 1] = `${ultima.trimEnd()}…`;
    return cortadas;
  }
  return r;
}

function rectRedondo(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ── La plantilla ASTA (la de Marketing, 2026-11-11) ─────────────────────────────
//
// Fondo celeste con el logo de marca de agua, el titular en dos líneas, el
// producto con su código en diagonal, el panda y «Disponible en» con la tienda. El panda es un PNG con fondo transparente (`/flyers/panda.png`): si
// no está, la plantilla sale sin él.

const AZUL_CLARO = '#5bb6f5';
const AZUL_FUERTE = '#1a5fe0';

/** Degradado horizontal de la marca, de `x` a `x + w`. */
function degradado(ctx: CanvasRenderingContext2D, x: number, w: number) {
  const g = ctx.createLinearGradient(x, 0, x + w, 0);
  g.addColorStop(0, AZUL_CLARO);
  g.addColorStop(1, AZUL_FUERTE);
  return g;
}

/** El tamaño de letra más grande (hasta `max`) con el que `texto` cabe en `ancho`. */
function ajustar(ctx: CanvasRenderingContext2D, texto: string, fuente: (px: number) => string, max: number, ancho: number): number {
  let px = max;
  ctx.font = fuente(px);
  while (px > 20 && ctx.measureText(texto).width > ancho) {
    px -= 4;
    ctx.font = fuente(px);
  }
  return px;
}

/** Una foto de Odoo (fondo blanco) sobre el fondo claro: en «multiplicar», el blanco desaparece. */
function fotoSinFondo(ctx: CanvasRenderingContext2D, foto: Imagen, x: number, y: number, w: number, h: number) {
  const escala = Math.min(w / foto.width, h / foto.height);
  const fw = foto.width * escala;
  const fh = foto.height * escala;
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.drawImage(foto, x + (w - fw) / 2, y + (h - fh) / 2, fw, fh);
  ctx.restore();
}

/** El código de un producto en diagonal, en cursiva y con el degradado de la marca. */
function codigo(ctx: CanvasRenderingContext2D, texto: string, x: number, y: number, px: number, titular: string, alinear: CanvasTextAlign) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-0.1);
  ctx.transform(1, 0, -0.18, 1, 0, 0);
  ctx.font = `${px}px ${titular}`;
  ctx.textAlign = alinear;
  const w = ctx.measureText(texto).width;
  ctx.fillStyle = degradado(ctx, alinear === 'right' ? -w : 0, w);
  ctx.fillText(texto, 0, 0);
  ctx.restore();
}

function dibujarAsta(
  ctx: CanvasRenderingContext2D,
  o: { alto: number; campos: Campos; marca: HTMLImageElement | null; panda: HTMLImageElement | null; foto: Imagen | null; producto: ProductoFlyer | null; fuente: string; titular: string },
) {
  const { alto, campos, marca, panda, fuente, titular } = o;
  const H = alto > ANCHO;
  const f = (peso: number, px: number) => `${peso} ${px}px ${fuente}`;

  // Fondo celeste, más claro hacia abajo, con una onda blanca.
  const fondo = ctx.createLinearGradient(0, 0, 0, alto);
  fondo.addColorStop(0, '#bfe0f7');
  fondo.addColorStop(0.55, '#e4f2fc');
  fondo.addColorStop(1, '#f6fbff');
  ctx.fillStyle = fondo;
  ctx.fillRect(0, 0, ANCHO, alto);
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.beginPath();
  ctx.moveTo(0, alto * (H ? 0.8 : 0.74));
  ctx.quadraticCurveTo(ANCHO * 0.45, alto * (H ? 0.72 : 0.64), ANCHO, alto * (H ? 0.77 : 0.7));
  ctx.lineTo(ANCHO, alto);
  ctx.lineTo(0, alto);
  ctx.closePath();
  ctx.fill();

  // El logo de marca de agua y el logo arriba.
  if (marca) {
    const wm = ANCHO * 1.25;
    ctx.save();
    ctx.globalAlpha = 0.06;
    ctx.drawImage(marca, (ANCHO - wm) / 2, alto * (H ? 0.08 : 0.06), wm, (wm * marca.height) / marca.width);
    ctx.restore();
    const wl = H ? 300 : 150;
    ctx.drawImage(marca, (ANCHO - wl) / 2, H ? 70 : 8, wl, (wl * marca.height) / marca.width);
  }

  // El titular, en dos líneas, centrado.
  ctx.textAlign = 'center';
  const l1 = (campos.destacado || 'TU TÓNER').toUpperCase();
  const l2 = (campos.linea2 || 'PARA USO DIARIO').toUpperCase();
  const y1 = H ? 520 : 232;
  const p1 = ajustar(ctx, l1, (px) => `${px}px ${titular}`, H ? 190 : 100, ANCHO - 120);
  let w = ctx.measureText(l1).width;
  ctx.fillStyle = degradado(ctx, (ANCHO - w) / 2, w);
  ctx.fillText(l1, ANCHO / 2, y1);
  const y2 = y1 + p1 * 0.62 + (H ? 70 : 24);
  ajustar(ctx, l2, (px) => `${px}px ${titular}`, H ? 118 : 58, ANCHO - 140);
  w = ctx.measureText(l2).width;
  ctx.fillStyle = degradado(ctx, (ANCHO - w) / 2, w);
  ctx.fillText(l2, ANCHO / 2, y2);
  ctx.textAlign = 'left';

  // El producto, grande en el centro, con su código en diagonal encima.
  const zonaY = y2 + (H ? 150 : 34);
  const zonaAlto = (H ? alto * 0.74 : alto * 0.765) - zonaY;
  const pxCodigo = H ? 120 : 64;
  const sku = (o.producto?.sku ?? '').toUpperCase();
  if (o.foto) fotoSinFondo(ctx, o.foto, ANCHO * 0.1, zonaY + pxCodigo * 0.6, ANCHO * 0.8, zonaAlto - pxCodigo * 0.6);
  if (sku) codigo(ctx, sku, 110, zonaY + pxCodigo * 0.75, pxCodigo, titular, 'left');

  // El panda, abajo a la izquierda.
  if (panda) {
    const ph = H ? alto * 0.3 : alto * 0.36;
    const pw = (ph * panda.width) / panda.height;
    ctx.drawImage(panda, H ? 10 : 0, alto - ph, pw, ph);
  }

  // «Disponible en», la tienda y el teléfono, abajo a la derecha.
  const cx = panda ? ANCHO * 0.72 : ANCHO / 2;
  const anchoBloque = panda ? ANCHO * 0.5 : ANCHO - 2 * 72;
  const pillAlto = H ? 88 : 66;
  const pillY = alto - (H ? 330 : 245);
  ctx.font = f(800, H ? 38 : 30);
  const etiqueta = 'DISPONIBLE EN';
  const pillAncho = ctx.measureText(etiqueta).width + pillAlto + 56;
  ctx.fillStyle = '#1c8cdb';
  rectRedondo(ctx, cx - pillAncho / 2, pillY, pillAncho, pillAlto, pillAlto / 2);
  ctx.fill();
  // El círculo con la flecha.
  const r = pillAlto / 2 - 10;
  const ccx = cx - pillAncho / 2 + 12 + r;
  const ccy = pillY + pillAlto / 2;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(ccx, ccy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#1c8cdb';
  ctx.lineWidth = H ? 5 : 4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(ccx - r * 0.45, ccy);
  ctx.lineTo(ccx + r * 0.4, ccy);
  ctx.moveTo(ccx + r * 0.05, ccy - r * 0.38);
  ctx.lineTo(ccx + r * 0.42, ccy);
  ctx.lineTo(ccx + r * 0.05, ccy + r * 0.38);
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  ctx.fillText(etiqueta, ccx + r + 18, ccy + (H ? 13 : 10));

  ctx.textAlign = 'center';
  const nombre = campos.nombre || 'Tu tienda';
  ajustar(ctx, nombre, (px) => f(700, px), H ? 62 : 46, anchoBloque);
  w = ctx.measureText(nombre).width;
  ctx.fillStyle = degradado(ctx, cx - w / 2, w);
  ctx.fillText(nombre, cx, pillY + pillAlto + (H ? 92 : 64));
  if (campos.telefono) {
    ajustar(ctx, campos.telefono, (px) => f(800, px), H ? 72 : 52, anchoBloque);
    w = ctx.measureText(campos.telefono).width;
    ctx.fillStyle = degradado(ctx, cx - w / 2, w);
    ctx.fillText(campos.telefono, cx, pillY + pillAlto + (H ? 182 : 128));
  }
  ctx.textAlign = 'left';
}

function dibujar(
  ctx: CanvasRenderingContext2D,
  { plantilla, alto, campos, logo, foto, producto, fuente }: { plantilla: Plantilla; alto: number; campos: Campos; logo: HTMLImageElement | null; foto: Imagen | null; producto: ProductoFlyer | null; fuente: string },
) {
  const f = (peso: number, px: number) => `${peso} ${px}px ${fuente}`;
  const historia = alto > ANCHO;
  const M = 72;

  // ── Fondo: noche con un brillo cian, como el panel ──────────────────────────
  const fondo = ctx.createLinearGradient(0, 0, ANCHO, alto);
  fondo.addColorStop(0, AZUL_NOCHE);
  fondo.addColorStop(1, '#12406f');
  ctx.fillStyle = fondo;
  ctx.fillRect(0, 0, ANCHO, alto);
  const brillo = ctx.createRadialGradient(ANCHO * 0.85, alto * 0.18, 0, ANCHO * 0.85, alto * 0.18, ANCHO * 0.7);
  brillo.addColorStop(0, 'rgba(91, 192, 235, 0.35)');
  brillo.addColorStop(1, 'rgba(91, 192, 235, 0)');
  ctx.fillStyle = brillo;
  ctx.fillRect(0, 0, ANCHO, alto);

  // ── Cabecera: el logo ───────────────────────────────────────────────────────
  const arriba = historia ? 140 : M;
  const logoAlto = logo ? (260 * logo.height) / logo.width : 100;
  if (logo) ctx.drawImage(logo, M, arriba, 260, logoAlto);

  // ── La tarjeta de la tienda, abajo ──────────────────────────────────────────
  const tarjetaAlto = historia ? 330 : 270;
  const tarjetaY = alto - tarjetaAlto - (historia ? 160 : M);
  ctx.fillStyle = '#ffffff';
  rectRedondo(ctx, M, tarjetaY, ANCHO - 2 * M, tarjetaAlto, 36);
  ctx.fill();
  ctx.fillStyle = AZUL;
  ctx.font = f(700, 26);
  ctx.fillText('DISPONIBLE EN', M + 48, tarjetaY + 66);
  ctx.fillStyle = AZUL_NOCHE;
  ctx.font = f(800, 54);
  const nombre = lineas(ctx, campos.nombre || 'Tu tienda', ANCHO - 2 * M - 96, 1)[0]!;
  ctx.fillText(nombre, M + 48, tarjetaY + 130);
  let y = tarjetaY + 186;
  ctx.font = f(700, 38);
  ctx.fillStyle = AZUL;
  const contacto = [campos.telefono, campos.instagram ? `@${campos.instagram.replace(/^@/, '')}` : ''].filter(Boolean).join('   ·   ');
  if (contacto) {
    ctx.fillText(lineas(ctx, contacto, ANCHO - 2 * M - 96, 1)[0]!, M + 48, y);
    y += 52;
  }
  if (campos.direccion) {
    ctx.font = f(500, 30);
    ctx.fillStyle = '#4a5a70';
    ctx.fillText(lineas(ctx, campos.direccion, ANCHO - 2 * M - 96, 1)[0]!, M + 48, y);
  }

  // ── El cuerpo, entre el logo y la tarjeta ───────────────────────────────────
  // El hueco entre el logo y la tarjeta.
  const top = arriba + logoAlto + (historia ? 110 : 70);
  const fondoCuerpo = tarjetaY - (historia ? 70 : 50);
  ctx.fillStyle = '#ffffff';

  if (plantilla === 'producto') {
    const destacado = campos.destacado || 'Ya disponible';
    const tam = historia ? 72 : 56;
    ctx.font = f(800, tam);
    const titulo = lineas(ctx, destacado, ANCHO - 2 * M, historia ? 2 : 1);
    titulo.forEach((l, i) => ctx.fillText(l, M, top + tam * 0.8 + i * tam * 1.1));
    const cajaY = top + titulo.length * tam * 1.1 + 24;
    const cajaAlto = fondoCuerpo - cajaY - (historia ? 220 : 70);
    // La foto, sobre blanco: las de Odoo vienen con fondo blanco.
    ctx.fillStyle = '#ffffff';
    rectRedondo(ctx, M, cajaY, ANCHO - 2 * M, cajaAlto, 36);
    ctx.fill();
    if (foto) {
      const pad = 40;
      const escala = Math.min((ANCHO - 2 * M - 2 * pad) / foto.width, (cajaAlto - 2 * pad) / foto.height);
      const w = foto.width * escala;
      const h = foto.height * escala;
      ctx.drawImage(foto, (ANCHO - w) / 2, cajaY + (cajaAlto - h) / 2, w, h);
    }
    if (campos.precio) {
      ctx.font = f(800, 52);
      const texto = campos.precio;
      const w = ctx.measureText(texto).width + 72;
      ctx.fillStyle = AZUL;
      rectRedondo(ctx, ANCHO - M - w - 24, cajaY + 24, w, 88, 44);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.fillText(texto, ANCHO - M - w + 12, cajaY + 86);
    }
    const nombreY = cajaY + cajaAlto + (historia ? 70 : 50);
    ctx.fillStyle = '#ffffff';
    ctx.font = f(700, historia ? 44 : 34);
    const nombreProducto = (producto?.nombre ?? '').replace(/^ASTA\s+/i, '');
    lineas(ctx, nombreProducto, ANCHO - 2 * M, historia ? 2 : 1).forEach((l, i) => ctx.fillText(l, M, nombreY + i * 50));
    if (producto?.sku && historia) {
      ctx.fillStyle = CIAN;
      ctx.font = f(600, 32);
      ctx.fillText(producto.sku, M, nombreY + 120);
    }
    return;
  }

  const [titulo, sub] =
    plantilla === 'busca'
      ? ['¿Qué tóner usa tu impresora?', 'Dinos el modelo y te damos el ASTA que le va. Tóner y tinta para láser y chorro de tinta.']
      : ['Tóner y tinta ASTA', 'Para tu impresora láser y de tinta. Pregúntanos por el tuyo.'];
  const tamTitulo = historia ? 124 : 96;
  const interlinea = tamTitulo * 1.08;
  ctx.font = f(800, tamTitulo);
  const lt = lineas(ctx, campos.destacado || titulo, ANCHO - 2 * M, 3);
  ctx.font = f(500, 40);
  const ls = lineas(ctx, sub, ANCHO - 2 * M, 3);
  // El bloque (titular, texto y franja), centrado en el hueco.
  const bloque = lt.length * interlinea + 40 + ls.length * 54 + 30;
  const inicio = top + Math.max(0, (fondoCuerpo - top - bloque) / 2) + tamTitulo * 0.8;
  ctx.fillStyle = '#ffffff';
  ctx.font = f(800, tamTitulo);
  lt.forEach((l, i) => ctx.fillText(l, M, inicio + i * interlinea));
  let sy = inicio + (lt.length - 1) * interlinea + 40 + 44;
  ctx.fillStyle = 'rgba(255,255,255,0.82)';
  ctx.font = f(500, 40);
  ls.forEach((l) => {
    ctx.fillText(l, M, sy);
    sy += 54;
  });
  // Una franja de color, como acento.
  ctx.fillStyle = CIAN;
  rectRedondo(ctx, M, sy + 10, 160, 12, 6);
  ctx.fill();
}

/**
 * El selector del producto del flyer: tarjetas con la foto, buscador y «Los que
 * compras». Uno solo (decidido con Supricom el 2026-11-11). Las fotos se cargan
 * al verse.
 */
function SelectorProductos({ productos, elegido, alElegir }: { productos: ProductoFlyer[]; elegido: number | null; alElegir: (id: number) => void }) {
  const [busca, setBusca] = useState('');
  const [soloSuyos, setSoloSuyos] = useState(false);
  const [cuantos, setCuantos] = useState(12);
  const haySuyos = productos.some((p) => p.loCompra);
  const visibles = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return productos.filter((p) => (!soloSuyos || p.loCompra) && (!q || `${p.nombre} ${p.sku ?? ''}`.toLowerCase().includes(q)));
  }, [productos, busca, soloSuyos]);

  return (
    <div className="fsel">
      <div className="fsel-barra">
        <label className="fsel-busca">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="6.5" />
            <path d="M20 20l-4.2-4.2" />
          </svg>
          <input
            value={busca}
            onChange={(e) => {
              setBusca(e.target.value);
              setCuantos(12);
            }}
            placeholder="Busca por nombre o código"
            aria-label="Buscar producto"
          />
        </label>
        {haySuyos && (
          <div className="segmented" role="group" aria-label="Qué productos ver">
            <button type="button" aria-pressed={!soloSuyos} onClick={() => setSoloSuyos(false)}>
              Todos
            </button>
            <button type="button" aria-pressed={soloSuyos} onClick={() => setSoloSuyos(true)}>
              Los que compras
            </button>
          </div>
        )}
      </div>
      {visibles.length === 0 ? (
        <p className="stat-sub">Ningún producto coincide.</p>
      ) : (
        <ul className="fsel-rejilla">
          {visibles.slice(0, cuantos).map((p) => {
            const es = p.templateId === elegido;
            return (
              <li key={p.templateId}>
                <button type="button" className={`fsel-tarjeta${es ? ' elegida' : ''}`} aria-pressed={es} onClick={() => alElegir(p.templateId)}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- la foto sale de Odoo por el panel */}
                  <img src={`/api/flyers/fotos/${p.templateId}`} alt="" loading="lazy" />
                  <span className="fsel-nombre">{p.nombre.replace(/^ASTA\s+/i, '')}</span>
                  {p.sku && <span className="fsel-sku">{p.sku}</span>}
                  {p.loCompra && <span className="fsel-suyo">Lo compras</span>}
                  {es && <span className="fsel-orden">✓</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {visibles.length > cuantos && (
        <button type="button" className="btn-link fsel-mas" onClick={() => setCuantos((c) => c + 12)}>
          Ver más ({visibles.length - cuantos})
        </button>
      )}
    </div>
  );
}

/** Un paso del editor: número, título y su contenido. */
function Paso({ n, titulo, nota, children }: { n: number; titulo: string; nota?: string; children: React.ReactNode }) {
  return (
    <section className="fpaso" aria-label={titulo}>
      <header className="fpaso-cabeza">
        <span className="fpaso-n" aria-hidden="true">
          {n}
        </span>
        <span className="fpaso-titulo">{titulo}</span>
        {nota && <span className="fpaso-nota">{nota}</span>}
      </header>
      {children}
    </section>
  );
}

/** `titular`: la familia de la letra condensada del titular (Anton, de `next/font`). */
export function EditorFlyer({ datos, titular }: { datos: DatosFlyer; titular: string }) {
  const lienzo = useRef<HTMLCanvasElement>(null);
  const [plantilla, setPlantilla] = useState<Plantilla>('asta');
  const [formato, setFormato] = useState<Formato>('post');
  const [productoId, setProductoId] = useState<number | null>(datos.productos[0]?.templateId ?? null);
  const [campos, setCampos] = useState<Campos>({
    linea2: '',
    nombre: datos.tienda.nombre,
    telefono: datos.tienda.telefono ?? '',
    direccion: datos.tienda.direccion ?? '',
    instagram: '',
    destacado: '',
    precio: '',
  });
  const [logo, setLogo] = useState<HTMLImageElement | null>(null);
  const [marca, setMarca] = useState<HTMLImageElement | null>(null);
  const [panda, setPanda] = useState<HTMLImageElement | null>(null);
  const [foto, setFoto] = useState<Imagen | null>(null);
  const [listoTitular, setListoTitular] = useState(false);
  const [fuente, setFuente] = useState('sans-serif');
  const [aviso, setAviso] = useState<string | null>(null);

  const alto = FORMATOS.find((x) => x.clave === formato)!.alto;
  const producto = datos.productos.find((p) => p.templateId === productoId) ?? null;

  // La fuente del panel (Inter, con el nombre que le da Next), y el logo, una vez.
  useEffect(() => {
    setFuente(getComputedStyle(document.body).fontFamily || 'sans-serif');
    void document.fonts?.ready.then(() => setFuente(getComputedStyle(document.body).fontFamily || 'sans-serif'));
    void cargarImagen('/asta-logo-blanco.png').then(setLogo);
    void cargarImagen('/asta-logo.png').then(setMarca);
    void cargarImagen('/flyers/panda.png').then(setPanda);
    // El canvas no espera a la letra: se pide y se vuelve a dibujar cuando llega.
    void document.fonts?.load(`100px ${titular}`).then(() => setListoTitular(true));
  }, [titular]);

  useEffect(() => {
    setFoto(null);
    if ((plantilla !== 'producto' && plantilla !== 'asta') || productoId === null) return;
    let vigente = true;
    void cargarImagen(`/api/flyers/fotos/${productoId}`).then((img) => vigente && setFoto(img && sinMargen(img)));
    return () => {
      vigente = false;
    };
  }, [plantilla, productoId]);

  useEffect(() => {
    const ctx = lienzo.current?.getContext('2d');
    if (!ctx) return;
    if (plantilla === 'asta') {
      dibujarAsta(ctx, { alto, campos, marca, panda, foto, producto, fuente, titular: listoTitular ? titular : fuente });
      return;
    }
    dibujar(ctx, { plantilla, alto, campos, logo, foto, producto, fuente });
  }, [plantilla, alto, campos, logo, marca, panda, foto, producto, fuente, titular, listoTitular]);

  const nombreArchivo = `flyer-asta-${plantilla}-${formato}.png`;

  function blob(): Promise<Blob | null> {
    return new Promise((resolve) => (lienzo.current ? lienzo.current.toBlob(resolve, 'image/png') : resolve(null)));
  }

  async function descargar() {
    const b = await blob();
    if (!b) return;
    const url = URL.createObjectURL(b);
    const a = document.createElement('a');
    a.href = url;
    a.download = nombreArchivo;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  /** En el teléfono, directo a WhatsApp o Instagram con el menú de compartir. */
  async function compartir() {
    const b = await blob();
    if (!b) return;
    const archivo = new File([b], nombreArchivo, { type: 'image/png' });
    try {
      if (navigator.canShare?.({ files: [archivo] })) await navigator.share({ files: [archivo] });
      else setAviso('Este navegador no comparte imágenes: descárgala y súbela tú.');
    } catch {
      // Cerrar el menú de compartir no es un error.
    }
  }

  const campo = (clave: keyof Campos, etiqueta: string, ayuda?: string, max = 80) => (
    <label className="fcampo">
      <span className="fcampo-etiqueta">
        {etiqueta}
        <small>
          {campos[clave].length}/{max}
        </small>
      </span>
      <input className="input" value={campos[clave]} maxLength={max} placeholder={ayuda} onChange={(e) => setCampos((c) => ({ ...c, [clave]: e.target.value }))} />
    </label>
  );

  return (
    <section className="panel flyer" aria-labelledby="flyer-titulo">
      <div className="flyer-controles">
        <h2 id="flyer-titulo">Tu flyer</h2>

        <Paso n={1} titulo="Plantilla">
          <div className="fopciones" role="group" aria-label="Plantilla">
            {PLANTILLAS.map((p) => (
              <button key={p.clave} type="button" className="fopcion" aria-pressed={plantilla === p.clave} onClick={() => setPlantilla(p.clave)}>
                <b>{p.titulo}</b>
                <span>{DESCRIPCION[p.clave]}</span>
              </button>
            ))}
          </div>
        </Paso>

        <Paso n={2} titulo="Formato">
          <div className="fopciones fopciones-2" role="group" aria-label="Formato">
            {FORMATOS.map((x) => (
              <button key={x.clave} type="button" className="fopcion fopcion-formato" aria-pressed={formato === x.clave} onClick={() => setFormato(x.clave)}>
                <i className={`fforma fforma-${x.clave}`} aria-hidden="true" />
                <span>
                  <b>{x.clave === 'post' ? 'Publicación' : 'Historia'}</b>
                  <span>{x.clave === 'post' ? 'Cuadrada · feed de Instagram' : 'Vertical · estados de WhatsApp'}</span>
                </span>
              </button>
            ))}
          </div>
        </Paso>

        {(plantilla === 'producto' || plantilla === 'asta') && (
          <Paso n={3} titulo="Producto">
            <SelectorProductos productos={datos.productos} elegido={productoId} alElegir={setProductoId} />
            {plantilla === 'producto' && campo('precio', 'Precio (opcional)', 'Por ejemplo: $25', 20)}
          </Paso>
        )}

        <Paso n={plantilla === 'producto' || plantilla === 'asta' ? 4 : 3} titulo="Textos">
          <div className="fcampos">
            {plantilla === 'asta' ? (
              <>
                {campo('destacado', 'Titular, primera línea', 'TU TÓNER', 24)}
                {campo('linea2', 'Titular, segunda línea', 'PARA USO DIARIO', 30)}
              </>
            ) : (
              campo('destacado', 'Texto destacado (opcional)', plantilla === 'producto' ? 'Ya disponible' : plantilla === 'busca' ? '¿Qué tóner usa tu impresora?' : 'Tóner y tinta ASTA', 60)
            )}
          </div>
        </Paso>

        <Paso n={plantilla === 'producto' || plantilla === 'asta' ? 5 : 4} titulo="Tu tienda" nota="Sale de tu ficha; puedes cambiarlo aquí">
          <div className="fcampos">
            {campo('nombre', 'Nombre de tu tienda')}
            {campo('telefono', 'Teléfono o WhatsApp')}
            {plantilla !== 'asta' && campo('instagram', 'Instagram (opcional)', 'tutienda', 40)}
            {plantilla !== 'asta' && campo('direccion', 'Dirección', undefined, 120)}
          </div>
        </Paso>

        <div className="flyer-botones">
          <button type="button" className="btn" onClick={() => void descargar()}>
            Descargar imagen
          </button>
          <button type="button" className="btn-link" onClick={() => void compartir()}>
            Compartir
          </button>
        </div>
        {aviso && <p className="stat-sub">{aviso}</p>}
        <p className="stat-sub">Los cambios no se guardan: el nombre, el teléfono y la dirección salen de tu ficha cada vez.</p>
      </div>

      <div className={`flyer-vista flyer-${formato}`}>
        <canvas ref={lienzo} width={ANCHO} height={alto} aria-label="Vista previa del flyer" />
      </div>
    </section>
  );
}
