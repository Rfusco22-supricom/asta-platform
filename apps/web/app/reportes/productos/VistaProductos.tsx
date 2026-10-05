'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { CategoriaDelReporte, ClienteDelReporteProductos, ProductoDelReporte } from '@asta/shared-types';
import { money, moneyCompact } from '@/lib/formato';

/**
 * El reporte de productos ASTA, desde los dos lados. Solo ASTA (ver
 * `reporteProductos.service`): lo de otras marcas está en «Oportunidades ASTA».
 *
 *   · Por categoría: cada categoría con lo vendido; al abrirla, sus productos;
 *     al abrir un producto, quién lo compra.
 *   · Por cliente: cuánto compra cada uno y en qué categorías; al abrirlo, sus
 *     productos.
 *
 * Todo llega sumado del servidor (la regla de `montoSchema`): aquí se filtra,
 * se ordena y se calculan porcentajes para pintar barras, nada más.
 */

type Vista = 'categorias' | 'clientes';

/** Cuántas filas se ven antes de «Ver todos»: con 600 productos, la lista entera no se lee. */
const PRIMEROS = 12;

function sinAcentos(t: string): string {
  return t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}


function pct(parte: number, total: number): number {
  return total > 0 ? Math.max(0, Math.min(100, Math.round((parte / total) * 100))) : 0;
}

function cantidad(n: number): string {
  return n.toLocaleString('es', { maximumFractionDigits: 2 });
}

export function VistaProductos({ categorias, clientes }: { categorias: CategoriaDelReporte[]; clientes: ClienteDelReporteProductos[] }) {
  const [vista, setVista] = useState<Vista>('categorias');
  const [busqueda, setBusqueda] = useState('');
  const q = sinAcentos(busqueda.trim());

  // Los productos de cada cliente, sacados de la vista por producto: es elegir
  // filas, no sumar importes.
  const productosDe = useMemo(() => {
    const m = new Map<number, Array<ProductoDelReporte & { suyo: { cantidad: number; monto: number } }>>();
    for (const c of categorias)
      for (const p of c.productos)
        for (const cl of p.clientes) {
          const lista = m.get(cl.partnerId) ?? [];
          lista.push({ ...p, suyo: { cantidad: cl.cantidad, monto: cl.monto } });
          m.set(cl.partnerId, lista);
        }
    for (const lista of m.values()) lista.sort((a, b) => b.suyo.monto - a.suyo.monto);
    return m;
  }, [categorias]);

  const categoriasVisibles = useMemo(() => {
    if (!q) return categorias;
    return categorias
      // Si lo buscado es el nombre de la categoría, se enseña entera: filtrar
      // sus productos por «consumibles» los dejaba todos fuera.
      .map((c) => (sinAcentos(c.nombre).includes(q) ? c : { ...c, productos: c.productos.filter((p) => sinAcentos(`${p.nombre} ${p.sku ?? ''} ${p.marca ?? ''}`).includes(q)) }))
      .filter((c) => c.productos.length > 0);
  }, [categorias, q]);

  const clientesVisibles = useMemo(() => (q ? clientes.filter((c) => sinAcentos(c.nombre).includes(q)) : clientes), [clientes, q]);

  const maxCategoria = Math.max(...categorias.map((c) => c.monto), 0);

  return (
    <div className="reporte-productos">
      <div className="toolbar">
        <div className="segmented" role="group" aria-label="Ver el reporte">
          <button type="button" aria-pressed={vista === 'categorias'} onClick={() => setVista('categorias')}>
            Por categoría
          </button>
          <button type="button" aria-pressed={vista === 'clientes'} onClick={() => setVista('clientes')}>
            Por cliente
          </button>
        </div>
        <input
          className="input"
          type="search"
          placeholder={vista === 'categorias' ? 'Buscar producto o referencia…' : 'Buscar cliente…'}
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          aria-label="Buscar en el reporte"
        />
        <span className="count">
          {vista === 'categorias' ? `${categoriasVisibles.length} categorías` : `${clientesVisibles.length} de ${clientes.length} clientes`}
        </span>
      </div>

      {vista === 'categorias' ? (
        <div className="rp-lista">
          {categoriasVisibles.map((c) => (
            <Categoria key={c.categoriaId} c={c} max={maxCategoria} abiertaDeEntrada={q !== ''} />
          ))}
          {categoriasVisibles.length === 0 && <div className="empty">{busqueda ? `Nada coincide con "${busqueda}".` : 'Sin ventas en este periodo.'}</div>}
        </div>
      ) : (
        <ListaClientes clientes={clientesVisibles} productosDe={productosDe} busqueda={busqueda} />
      )}
    </div>
  );
}

function Categoria({ c, max, abiertaDeEntrada }: { c: CategoriaDelReporte; max: number; abiertaDeEntrada: boolean }) {
  // null = lo que toque (abierta si se está buscando); un clic lo fija. Con un
  // booleano y un «o», buscando no había forma de plegar ninguna.
  const [abierta, setAbierta] = useState<boolean | null>(null);
  const [todos, setTodos] = useState(false);
  const verAbierta = abierta ?? abiertaDeEntrada;
  const productos = todos ? c.productos : c.productos.slice(0, PRIMEROS);

  return (
    <div className={verAbierta ? 'panel rp-categoria abierta' : 'panel rp-categoria'}>
      <button type="button" className="rp-cabecera" aria-expanded={verAbierta} onClick={() => setAbierta(!verAbierta)}>
        <span className="rp-chevron" aria-hidden="true">›</span>
        <span className="rp-nombre">
          <strong>{c.nombre}</strong>
          <small>
            {c.productos.length} {c.productos.length === 1 ? 'producto' : 'productos'} · {c.clientes} {c.clientes === 1 ? 'cliente' : 'clientes'}
          </small>
        </span>
        <span className="rp-peso" aria-hidden="true">
          <span style={{ width: `${pct(c.monto, max)}%` }} />
        </span>
        <span className="rp-monto">{moneyCompact(c.monto)}</span>
      </button>

      {verAbierta && (
        <div className="rp-cuerpo">
          <table className="rp-tabla">
            <thead>
              <tr>
                <th>Producto</th>
                <th className="num">Cantidad</th>
                <th className="num">Vendido</th>
                <th className="num">Clientes</th>
              </tr>
            </thead>
            <tbody>
              {productos.map((p) => (
                <Producto key={p.productId} p={p} />
              ))}
            </tbody>
          </table>
          {c.productos.length > PRIMEROS && (
            <button type="button" className="btn-link rp-mas" onClick={() => setTodos(!todos)}>
              {todos ? 'Ver menos' : `Ver los ${c.productos.length} productos`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Producto({ p }: { p: ProductoDelReporte }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <>
      <tr className={abierto ? 'rp-producto abierto' : 'rp-producto'} onClick={() => setAbierto(!abierto)}>
        <td>
          <button type="button" className="rp-producto-boton" aria-expanded={abierto}>
            <span className="rp-chevron" aria-hidden="true">›</span>
            <span>
              {p.sku && <span className="rp-sku">{p.sku}</span>}
              {p.nombre}
            </span>
          </button>
        </td>
        <td className="num">{cantidad(p.cantidad)}</td>
        <td className="num">{money(p.monto)}</td>
        <td className="num">{p.clientes.length}</td>
      </tr>
      {abierto && (
        <tr className="rp-quien">
          <td colSpan={4}>
            <ul>
              {p.clientes.map((cl) => (
                <li key={cl.partnerId}>
                  <Link href={`/cartera/${cl.partnerId}`}>{cl.nombre}</Link>
                  <span>{cantidad(cl.cantidad)} u.</span>
                  <span className="num">{money(cl.monto)}</span>
                </li>
              ))}
            </ul>
          </td>
        </tr>
      )}
    </>
  );
}

function ListaClientes({
  clientes,
  productosDe,
  busqueda,
}: {
  clientes: ClienteDelReporteProductos[];
  productosDe: Map<number, Array<ProductoDelReporte & { suyo: { cantidad: number; monto: number } }>>;
  busqueda: string;
}) {
  const [todos, setTodos] = useState(false);
  const [abierto, setAbierto] = useState<number | null>(null);
  const visibles = todos || busqueda ? clientes : clientes.slice(0, PRIMEROS * 2);

  return (
    <div className="table-wrap">
      <table className="rp-tabla rp-clientes">
        <thead>
          <tr>
            <th>Cliente</th>
            <th>En qué categorías</th>
            <th className="num">Productos</th>
            <th className="num">Vendido</th>
          </tr>
        </thead>
        <tbody>
          {visibles.map((c) => (
            <ClienteFila key={c.partnerId} c={c} productos={productosDe.get(c.partnerId) ?? []} abierto={abierto === c.partnerId} alAbrir={() => setAbierto(abierto === c.partnerId ? null : c.partnerId)} />
          ))}
        </tbody>
      </table>
      {visibles.length === 0 && <div className="empty">{busqueda ? `Ningún cliente coincide con "${busqueda}".` : 'Nadie compró en este periodo.'}</div>}
      {!busqueda && clientes.length > visibles.length && (
        <button type="button" className="btn-link rp-mas" onClick={() => setTodos(true)}>
          Ver los {clientes.length} clientes
        </button>
      )}
    </div>
  );
}

/** Colores de las tres primeras categorías de un cliente; el resto, gris. */
const TONOS = ['var(--primario)', 'var(--positive)', 'var(--warning)'];

function ClienteFila({
  c,
  productos,
  abierto,
  alAbrir,
}: {
  c: ClienteDelReporteProductos;
  productos: Array<ProductoDelReporte & { suyo: { cantidad: number; monto: number } }>;
  abierto: boolean;
  alAbrir: () => void;
}) {
  const principales = c.categorias.filter((x) => x.monto > 0).slice(0, 3);
  const [todos, setTodos] = useState(false);
  const suyos = todos ? productos : productos.slice(0, PRIMEROS);
  return (
    <>
      <tr className={abierto ? 'rp-producto abierto' : 'rp-producto'} onClick={alAbrir}>
        <td>
          <button type="button" className="rp-producto-boton" aria-expanded={abierto}>
            <span className="rp-chevron" aria-hidden="true">›</span>
            <span className="cliente-nombre">{c.nombre}</span>
          </button>
        </td>
        <td>
          <span className="rp-mezcla" title={c.categorias.map((x) => `${x.nombre}: ${money(x.monto)}`).join('\n')}>
            {principales.map((x, i) => (
              <span key={x.categoriaId} style={{ flexGrow: Math.max(1, x.monto), background: TONOS[i] }} />
            ))}
            {c.categorias.length > 3 && <span className="rp-mezcla-resto" style={{ flexGrow: Math.max(1, c.monto - principales.reduce((s, x) => s + x.monto, 0)) }} />}
          </span>
          <span className="rp-mezcla-leyenda">
            {principales.map((x, i) => (
              <span key={x.categoriaId}>
                <i style={{ background: TONOS[i] }} />
                {x.nombre.toLowerCase()}
              </span>
            ))}
          </span>
        </td>
        <td className="num">{c.productosDistintos}</td>
        <td className="num">{money(c.monto)}</td>
      </tr>
      {abierto && (
        <tr className="rp-quien">
          <td colSpan={4}>
            <div className="rp-cliente-detalle">
              <ul>
                {suyos.map((p) => (
                  <li key={p.productId}>
                    <span>
                      {p.sku && <span className="rp-sku">{p.sku}</span>}
                      {p.nombre}
                    </span>
                    <span>{cantidad(p.suyo.cantidad)} u.</span>
                    <span className="num">{money(p.suyo.monto)}</span>
                  </li>
                ))}
              </ul>
              <div className="rp-cliente-pie">
                {productos.length > PRIMEROS && (
                  <button type="button" className="btn-link" onClick={() => setTodos(!todos)}>
                    {todos ? 'Ver menos' : `Ver sus ${productos.length} productos`}
                  </button>
                )}
                <Link href={`/cartera/${c.partnerId}`} className="rp-ficha">
                  Abrir su ficha ›
                </Link>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
