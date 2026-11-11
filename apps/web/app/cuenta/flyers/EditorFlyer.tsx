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
  producto: 'Un producto con su precio',
  busca: 'Invita a preguntar por su tóner',
};

/** El titular por defecto de cada plantilla, en dos líneas: el cliente lo puede cambiar. */
const TITULARES: Record<Plantilla, [string, string]> = {
  asta: ['TU TÓNER', 'PARA USO DIARIO'],
  tienda: ['TÓNER Y TINTA', 'PARA TU IMPRESORA'],
  producto: ['YA DISPONIBLE', 'EN TU TIENDA'],
  busca: ['¿QUÉ TÓNER USA', 'TU IMPRESORA?'],
};

const FORMATOS: { clave: Formato; titulo: string; alto: number }[] = [
  { clave: 'post', titulo: 'Publicación (cuadrada)', alto: 1080 },
  { clave: 'historia', titulo: 'Historia / estado', alto: 1920 },
];

const ANCHO = 1080;

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

// ── El diseño de Marketing (2026-11-11), para las cuatro plantillas ─────────────
//
// Fondo celeste con el logo de marca de agua, el titular en dos líneas, el
// panda y «Disponible en» con la tienda. Lo del centro cambia con la plantilla:
// el producto con su código (ASTA y «Un producto», que añade el precio), tres
// productos y una frase («Tu tienda») o un buscador dibujado («Encuentra tu
// tóner»). El panda es un PNG con fondo transparente (`/flyers/panda.png`): si
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

/** La imagen llenando el rectángulo, recortada por el centro (como `object-fit: cover`). */
function cubrir(ctx: CanvasRenderingContext2D, img: Imagen, x: number, y: number, w: number, h: number) {
  const escala = Math.max(w / img.width, h / img.height);
  const sw = w / escala;
  const sh = h / escala;
  ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h);
}

/** La imagen entera dentro del rectángulo, centrada en alto y pegada a la izquierda (un logo). */
function encajar(ctx: CanvasRenderingContext2D, img: Imagen, x: number, y: number, w: number, h: number) {
  const escala = Math.min(w / img.width, h / img.height);
  ctx.drawImage(img, x, y + (h - img.height * escala) / 2, img.width * escala, img.height * escala);
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
  o: {
    variante: Plantilla;
    alto: number;
    campos: Campos;
    marca: HTMLImageElement | null;
    panda: HTMLImageElement | null;
    foto: Imagen | null;
    producto: ProductoFlyer | null;
    /** «Tu tienda»: hasta tres productos ASTA que compra. */
    fotos: Imagen[];
    /** El logo de su tienda y una foto de su local: los sube él y no salen de su navegador. */
    logoTienda: Imagen | null;
    fotoLocal: Imagen | null;
    fuente: string;
    titular: string;
  },
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
  // La foto de su local, de fondo y suavizada con el celeste: cada flyer, el suyo.
  if (o.fotoLocal) {
    // Desenfocada (donde el navegador lo sabe hacer) y muy tapada: es ambiente, no protagonista.
    ctx.save();
    ctx.filter = 'blur(10px)';
    cubrir(ctx, o.fotoLocal, -30, -30, ANCHO + 60, alto + 60);
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = fondo;
    ctx.fillRect(0, 0, ANCHO, alto);
    ctx.restore();
  }
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
    const yl = H ? 70 : 8;
    const hl = (wl * marca.height) / marca.width;
    if (o.logoTienda) {
      // «asta | su logo»: el de ASTA a la izquierda y el suyo a la derecha.
      ctx.drawImage(marca, ANCHO * 0.3 - wl / 2, yl, wl, hl);
      ctx.fillStyle = 'rgba(26, 95, 224, 0.35)';
      ctx.fillRect(ANCHO / 2 - 2, yl + hl * 0.28, 4, hl * 0.44);
      encajar(ctx, o.logoTienda, ANCHO * 0.54, yl + hl * 0.22, ANCHO * 0.34, hl * 0.56);
    } else {
      ctx.drawImage(marca, (ANCHO - wl) / 2, yl, wl, hl);
    }
  }

  // El titular, en dos líneas, centrado.
  ctx.textAlign = 'center';
  const l1 = (campos.destacado || TITULARES[o.variante][0]).toUpperCase();
  const l2 = (campos.linea2 || TITULARES[o.variante][1]).toUpperCase();
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

  const zonaY = y2 + (H ? 150 : 34);
  const zonaAlto = (H ? alto * (o.variante === 'tienda' ? 0.7 : 0.74) : alto * (o.variante === 'tienda' ? 0.72 : 0.765)) - zonaY;
  const pxCodigo = H ? 120 : 64;

  if (o.variante === 'asta' || o.variante === 'producto') {
    // El producto, grande en el centro, con su código en diagonal encima.
    const sku = (o.producto?.sku ?? '').toUpperCase();
    if (o.foto) fotoSinFondo(ctx, o.foto, ANCHO * 0.1, zonaY + pxCodigo * 0.6, ANCHO * 0.8, zonaAlto - pxCodigo * 0.6);
    if (sku) codigo(ctx, sku, 110, zonaY + pxCodigo * 0.75, pxCodigo, titular, 'left');
    // «Un producto»: el precio, en una pastilla azul a la derecha.
    if (o.variante === 'producto' && campos.precio) {
      ctx.font = `${H ? 92 : 64}px ${titular}`;
      const pw = ctx.measureText(campos.precio).width + (H ? 80 : 56);
      const ph = H ? 130 : 92;
      const px = ANCHO - pw - 50;
      const py = zonaY + zonaAlto * 0.42;
      ctx.save();
      ctx.translate(px + pw / 2, py + ph / 2);
      ctx.rotate(-0.08);
      ctx.fillStyle = degradado(ctx, -pw / 2, pw);
      rectRedondo(ctx, -pw / 2, -ph / 2, pw, ph, ph / 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.fillText(campos.precio, 0, ph * 0.3);
      ctx.restore();
    }
  } else if (o.variante === 'tienda') {
    // La foto de su local en grande; sin ella, tres productos ASTA en fila. Y la frase debajo.
    const fh = zonaAlto * 0.7;
    if (o.fotoLocal) {
      ctx.save();
      rectRedondo(ctx, 60, zonaY, ANCHO - 120, fh, 36);
      ctx.clip();
      cubrir(ctx, o.fotoLocal, 60, zonaY, ANCHO - 120, fh);
      ctx.restore();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 8;
      rectRedondo(ctx, 60, zonaY, ANCHO - 120, fh, 36);
      ctx.stroke();
    } else {
      const n = Math.max(1, o.fotos.length);
      const hueco = 24;
      const fw = (ANCHO - 2 * 50 - (n - 1) * hueco) / n;
      o.fotos.forEach((ft, k) => fotoSinFondo(ctx, ft, 50 + k * (fw + hueco), zonaY, fw, fh));
    }
    ctx.textAlign = 'center';
    ctx.fillStyle = '#1f4f8f';
    ctx.font = f(700, H ? 46 : 34);
    lineas(ctx, 'Para tu impresora láser y de tinta. Pregúntanos por el tuyo.', ANCHO - 160, 2).forEach((l, k) => ctx.fillText(l, ANCHO / 2, zonaY + fh + (H ? 90 : 56) + k * (H ? 60 : 44)));
    ctx.textAlign = 'left';
  } else {
    // «Encuentra tu tóner»: la frase y un buscador dibujado.
    ctx.textAlign = 'center';
    ctx.fillStyle = '#1f4f8f';
    ctx.font = f(700, H ? 58 : 38);
    const frase = lineas(ctx, 'Dinos el modelo y te damos el ASTA que le va.', ANCHO - 180, 2);
    const fy = zonaY + zonaAlto * (H ? 0.24 : 0.16);
    frase.forEach((l, k) => ctx.fillText(l, ANCHO / 2, fy + k * (H ? 72 : 48)));
    const bw = ANCHO * 0.86;
    const bh = H ? 150 : 104;
    const bx = (ANCHO - bw) / 2;
    const by = fy + frase.length * (H ? 72 : 48) + (H ? 70 : 34);
    ctx.save();
    ctx.shadowColor = 'rgba(16, 80, 160, 0.18)';
    ctx.shadowBlur = 30;
    ctx.shadowOffsetY = 10;
    ctx.fillStyle = '#ffffff';
    rectRedondo(ctx, bx, by, bw, bh, bh / 2);
    ctx.fill();
    ctx.restore();
    // La lupa.
    const lr = bh * 0.17;
    const lx = bx + bh * 0.5;
    const ly = by + bh * 0.46;
    ctx.strokeStyle = '#1c8cdb';
    ctx.lineWidth = H ? 7 : 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(lx, ly, lr, 0, Math.PI * 2);
    ctx.moveTo(lx + lr * 0.72, ly + lr * 0.72);
    ctx.lineTo(lx + lr * 1.5, ly + lr * 1.5);
    ctx.stroke();
    ctx.textAlign = 'left';
    ctx.fillStyle = '#8aa0b8';
    ctx.font = f(600, H ? 42 : 30);
    ctx.fillText('Modelo de tu impresora…', bx + bh * 0.95, by + bh * 0.6);
    // El botón de buscar, a la derecha.
    const br = bh / 2 - 12;
    ctx.fillStyle = degradado(ctx, bx + bw - bh, bh);
    ctx.beginPath();
    ctx.arc(bx + bw - bh / 2, by + bh / 2, br, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = H ? 6 : 5;
    const ax = bx + bw - bh / 2;
    const ay = by + bh / 2;
    ctx.beginPath();
    ctx.moveTo(ax - br * 0.4, ay);
    ctx.lineTo(ax + br * 0.38, ay);
    ctx.moveTo(ax + br * 0.02, ay - br * 0.36);
    ctx.lineTo(ax + br * 0.4, ay);
    ctx.lineTo(ax + br * 0.02, ay + br * 0.36);
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#1f4f8f';
    ctx.font = f(600, H ? 36 : 26);
    ctx.fillText('Tóner y tinta para láser y chorro de tinta', ANCHO / 2, by + bh + (H ? 80 : 54));
    ctx.textAlign = 'left';
  }

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
  const extra = o.variante === 'tienda' ? [campos.instagram ? `@${campos.instagram.replace(/^@/, '')}` : '', campos.direccion].filter(Boolean).join('  ·  ') : '';
  const pillY = alto - (H ? 330 : 245) - (extra ? (H ? 70 : 50) : 0);
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
  if (extra) {
    ctx.fillStyle = '#4a6a90';
    ctx.font = f(600, H ? 32 : 24);
    ctx.fillText(lineas(ctx, extra, anchoBloque, 1)[0]!, cx, pillY + pillAlto + (H ? 250 : 176));
  }
  ctx.textAlign = 'left';
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

/**
 * Subir una imagen suya (su logo, la foto de su local). Se lee en su navegador
 * y solo se dibuja en el flyer: no se sube a ningún sitio. Las muy grandes se
 * reducen a 1600 px para que el dibujo no vaya lento en un teléfono.
 */
function Subir({ etiqueta, ayuda, imagen, alCambiar }: { etiqueta: string; ayuda: string; imagen: Imagen | null; alCambiar: (img: Imagen | null) => void }) {
  const [vista, setVista] = useState<string | null>(null);
  function leer(archivo: File | undefined) {
    if (!archivo || !archivo.type.startsWith('image/')) return;
    const url = URL.createObjectURL(archivo);
    const img = new Image();
    img.onload = () => {
      const escala = Math.min(1, 1600 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * escala);
      c.height = Math.round(img.height * escala);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      alCambiar(c);
      setVista(c.toDataURL('image/png'));
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }
  return (
    <div className="fsubir">
      <span className="fcampo-etiqueta">{etiqueta}</span>
      <label className={`fsubir-caja${imagen ? ' con' : ''}`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- vista previa local */}
        {imagen && vista ? <img src={vista} alt="" /> : <span className="fsubir-mas" aria-hidden="true">+</span>}
        <span className="fsubir-texto">{imagen ? 'Cambiar' : 'Subir imagen'}</span>
        <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => leer(e.target.files?.[0])} />
      </label>
      <span className="stat-sub">{ayuda}</span>
      {imagen && (
        <button
          type="button"
          className="btn-link"
          onClick={() => {
            alCambiar(null);
            setVista(null);
          }}
        >
          Quitar
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

  // «Tu tienda»: tres productos ASTA, primero los que compra. Se cargan una vez.
  const [fotosTienda, setFotosTienda] = useState<Imagen[]>([]);
  const [logoTienda, setLogoTienda] = useState<Imagen | null>(null);
  const [fotoLocal, setFotoLocal] = useState<Imagen | null>(null);
  useEffect(() => {
    if (plantilla !== 'tienda' || fotosTienda.length) return;
    const tres = [...datos.productos].sort((a, b) => Number(b.loCompra) - Number(a.loCompra)).slice(0, 3);
    void Promise.all(tres.map((p) => cargarImagen(`/api/flyers/fotos/${p.templateId}`))).then((imgs) =>
      setFotosTienda(imgs.filter((x): x is HTMLImageElement => x !== null).map(sinMargen)),
    );
  }, [plantilla, datos.productos, fotosTienda.length]);

  useEffect(() => {
    const ctx = lienzo.current?.getContext('2d');
    if (!ctx) return;
    dibujarAsta(ctx, { variante: plantilla, alto, campos, marca, panda, foto, producto, fotos: fotosTienda, logoTienda, fotoLocal, fuente, titular: listoTitular ? titular : fuente });
  }, [plantilla, alto, campos, marca, panda, foto, producto, fotosTienda, logoTienda, fotoLocal, fuente, titular, listoTitular]);

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
            {campo('destacado', 'Titular, primera línea', TITULARES[plantilla][0], 24)}
            {campo('linea2', 'Titular, segunda línea', TITULARES[plantilla][1], 30)}
          </div>
        </Paso>

        <Paso n={plantilla === 'producto' || plantilla === 'asta' ? 5 : 4} titulo="Tu tienda" nota="Sale de tu ficha; puedes cambiarlo aquí">
          <div className="fcampos">
            {campo('nombre', 'Nombre de tu tienda')}
            {campo('telefono', 'Teléfono o WhatsApp')}
            {plantilla === 'tienda' && campo('instagram', 'Instagram (opcional)', 'tutienda', 40)}
            {plantilla === 'tienda' && campo('direccion', 'Dirección (opcional)', undefined, 120)}
          </div>
          <div className="fsubidas">
            <Subir etiqueta="Logo de tu tienda" ayuda="Sale arriba, junto al de ASTA" imagen={logoTienda} alCambiar={setLogoTienda} />
            <Subir etiqueta="Foto de tu local" ayuda="De fondo, y en grande en «Tu tienda»" imagen={fotoLocal} alCambiar={setFotoLocal} />
          </div>
          <p className="stat-sub">Tu logo y tu foto se quedan en tu navegador: no se suben ni se guardan.</p>
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
