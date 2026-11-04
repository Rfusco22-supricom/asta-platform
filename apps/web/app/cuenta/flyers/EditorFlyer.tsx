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

type Plantilla = 'tienda' | 'producto' | 'busca';
type Formato = 'post' | 'historia';

const PLANTILLAS: { clave: Plantilla; titulo: string }[] = [
  { clave: 'tienda', titulo: 'Tu tienda' },
  { clave: 'producto', titulo: 'Un producto' },
  { clave: 'busca', titulo: 'Encuentra tu tóner' },
];

const FORMATOS: { clave: Formato; titulo: string; alto: number }[] = [
  { clave: 'post', titulo: 'Publicación (cuadrada)', alto: 1080 },
  { clave: 'historia', titulo: 'Historia / estado', alto: 1920 },
];

const ANCHO = 1080;
const AZUL_NOCHE = '#0b1e3a';
const AZUL = '#1c8cdb';
const CIAN = '#5bc0eb';

interface Campos {
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

function dibujar(
  ctx: CanvasRenderingContext2D,
  { plantilla, alto, campos, logo, foto, producto, fuente }: { plantilla: Plantilla; alto: number; campos: Campos; logo: HTMLImageElement | null; foto: HTMLImageElement | null; producto: ProductoFlyer | null; fuente: string },
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

export function EditorFlyer({ datos }: { datos: DatosFlyer }) {
  const lienzo = useRef<HTMLCanvasElement>(null);
  const [plantilla, setPlantilla] = useState<Plantilla>('tienda');
  const [formato, setFormato] = useState<Formato>('post');
  const [productoId, setProductoId] = useState<number | null>(datos.productos[0]?.templateId ?? null);
  const [filtro, setFiltro] = useState('');
  const [campos, setCampos] = useState<Campos>({
    nombre: datos.tienda.nombre,
    telefono: datos.tienda.telefono ?? '',
    direccion: datos.tienda.direccion ?? '',
    instagram: '',
    destacado: '',
    precio: '',
  });
  const [logo, setLogo] = useState<HTMLImageElement | null>(null);
  const [foto, setFoto] = useState<HTMLImageElement | null>(null);
  const [fuente, setFuente] = useState('sans-serif');
  const [aviso, setAviso] = useState<string | null>(null);

  const alto = FORMATOS.find((x) => x.clave === formato)!.alto;
  const producto = datos.productos.find((p) => p.templateId === productoId) ?? null;
  const visibles = useMemo(() => {
    const q = filtro.trim().toLowerCase();
    return q ? datos.productos.filter((p) => `${p.nombre} ${p.sku ?? ''}`.toLowerCase().includes(q)) : datos.productos;
  }, [filtro, datos.productos]);

  // La fuente del panel (Inter, con el nombre que le da Next), y el logo, una vez.
  useEffect(() => {
    setFuente(getComputedStyle(document.body).fontFamily || 'sans-serif');
    void document.fonts?.ready.then(() => setFuente(getComputedStyle(document.body).fontFamily || 'sans-serif'));
    void cargarImagen('/asta-logo-blanco.png').then(setLogo);
  }, []);

  useEffect(() => {
    setFoto(null);
    if (plantilla !== 'producto' || productoId === null) return;
    let vigente = true;
    void cargarImagen(`/api/flyers/fotos/${productoId}`).then((img) => vigente && setFoto(img));
    return () => {
      vigente = false;
    };
  }, [plantilla, productoId]);

  useEffect(() => {
    const ctx = lienzo.current?.getContext('2d');
    if (!ctx) return;
    dibujar(ctx, { plantilla, alto, campos, logo, foto, producto, fuente });
  }, [plantilla, alto, campos, logo, foto, producto, fuente]);

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
    <label className="flyer-campo">
      <span className="stat-sub">{etiqueta}</span>
      <input className="input" value={campos[clave]} maxLength={max} placeholder={ayuda} onChange={(e) => setCampos((c) => ({ ...c, [clave]: e.target.value }))} />
    </label>
  );

  return (
    <section className="panel flyer" aria-labelledby="flyer-titulo">
      <div className="flyer-controles">
        <h2 id="flyer-titulo">Tu flyer</h2>
        <div className="flyer-grupo">
          <span className="stat-sub">Plantilla</span>
          <div className="segmented" role="group" aria-label="Plantilla">
            {PLANTILLAS.map((p) => (
              <button key={p.clave} type="button" aria-pressed={plantilla === p.clave} onClick={() => setPlantilla(p.clave)}>
                {p.titulo}
              </button>
            ))}
          </div>
        </div>
        <div className="flyer-grupo">
          <span className="stat-sub">Formato</span>
          <div className="segmented" role="group" aria-label="Formato">
            {FORMATOS.map((x) => (
              <button key={x.clave} type="button" aria-pressed={formato === x.clave} onClick={() => setFormato(x.clave)}>
                {x.titulo}
              </button>
            ))}
          </div>
        </div>

        {plantilla === 'producto' && (
          <div className="flyer-grupo">
            <span className="stat-sub">Producto</span>
            <input className="input" value={filtro} placeholder="Busca por nombre o código" onChange={(e) => setFiltro(e.target.value)} aria-label="Buscar producto" />
            <select className="select" value={productoId ?? ''} onChange={(e) => setProductoId(Number(e.target.value))} aria-label="Producto" size={6}>
              {visibles.map((p) => (
                <option key={p.templateId} value={p.templateId}>
                  {p.loCompra ? '★ ' : ''}
                  {p.nombre.replace(/^ASTA\s+/i, '')}
                  {p.sku ? ` · ${p.sku}` : ''}
                </option>
              ))}
            </select>
            <span className="stat-sub">★ los que nos compras</span>
            {campo('precio', 'Precio (opcional)', 'Por ejemplo: $25', 20)}
          </div>
        )}

        {campo('destacado', 'Texto destacado (opcional)', plantilla === 'producto' ? 'Ya disponible' : plantilla === 'busca' ? '¿Qué tóner usa tu impresora?' : 'Tóner y tinta ASTA', 60)}
        {campo('nombre', 'Nombre de tu tienda')}
        {campo('telefono', 'Teléfono o WhatsApp')}
        {campo('instagram', 'Instagram (opcional)', 'tutienda', 40)}
        {campo('direccion', 'Dirección', undefined, 120)}

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
