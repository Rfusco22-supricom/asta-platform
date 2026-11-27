'use client';

import { useMemo, useState } from 'react';
import { TIPOS_CATALOGO, TITULOS_CATALOGO, type FichaCatalogo, type TipoCatalogo } from '@asta/shared-types';
import { money } from '@/lib/formato';

/**
 * Las fichas del catálogo ASTA con su buscador.
 *
 * Son pocas (unas setenta) y llegan todas con la página, así que se filtra aquí
 * mismo, sin ir al servidor. Se busca por todo lo que un cliente puede decir:
 * el código ASTA, el cartucho original que reemplaza o el modelo de su
 * impresora («6030», «L3250»). Cada palabra tiene que aparecer en algún sitio.
 *
 * Los precios son los del catálogo que se le manda al cliente, así que en el
 * modo presentación se ven (`data-publico`).
 */

type Filtro = TipoCatalogo | 'todos';

const PUNTO: Record<string, string> = { Negro: '#1f2733', Cian: '#2ea3e6', Magenta: '#d6337f', Amarillo: '#f2c230' };

/** Sin acentos, sin guiones ni espacios: «A-W2020A-CH» y «w2020» se encuentran. */
const plano = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

interface Indexada {
  ficha: FichaCatalogo;
  /** Título, marca, códigos y cartuchos: lo que ya se ve en la tarjeta. */
  propio: string;
  impresoras: Array<{ nombre: string; plano: string }>;
}

function indexar(f: FichaCatalogo): Indexada {
  return {
    ficha: f,
    propio: plano([f.titulo, f.marca, ...f.cartuchos, ...f.variantes.map((v) => v.codigo)].join(' ')),
    impresoras: f.impresoras.map((nombre) => ({ nombre, plano: plano(nombre) })),
  };
}

/** Las impresoras que explican el resultado, o null si la ficha no coincide. */
function buscar(x: Indexada, palabras: string[]): string[] | null {
  const porImpresora: string[] = [];
  for (const p of palabras) {
    if (x.propio.includes(p)) continue;
    const imp = x.impresoras.filter((i) => i.plano.includes(p));
    if (!imp.length) return null;
    for (const i of imp) if (!porImpresora.includes(i.nombre)) porImpresora.push(i.nombre);
  }
  return porImpresora;
}

export function Catalogo({ fichas, conPrecios }: { fichas: FichaCatalogo[]; conPrecios: boolean }) {
  const [texto, setTexto] = useState('');
  const [tipo, setTipo] = useState<Filtro>('todos');
  const indice = useMemo(() => fichas.map(indexar), [fichas]);

  const palabras = texto
    .split(/\s+/)
    .map(plano)
    .filter(Boolean);
  const encontradas = indice
    .map((x) => ({ ficha: x.ficha, impresoras: palabras.length ? buscar(x, palabras) : [] }))
    .filter((x): x is { ficha: FichaCatalogo; impresoras: string[] } => x.impresoras !== null);
  const porTipo = (t: TipoCatalogo) => encontradas.filter((x) => x.ficha.tipo === t);
  const visibles = TIPOS_CATALOGO.filter((t) => (tipo === 'todos' || tipo === t) && porTipo(t).length);
  const total = visibles.reduce((s, t) => s + porTipo(t).length, 0);

  return (
    <div className="catalogo" data-publico>
      <div className="toolbar">
        <input
          className="input catalogo-buscar"
          type="search"
          placeholder="Buscar por código, cartucho o impresora…"
          aria-label="Buscar en el catálogo"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
        />
        <span className="count">
          {total === 1 ? '1 producto' : `${total} productos`} · {conPrecios ? 'precios de hoy en USD, sin IVA' : 'sin precios: Odoo no respondió'}
        </span>
      </div>

      <nav className="pestanas-reporte catalogo-tipos" aria-label="Tipo de producto">
        {(['todos', ...TIPOS_CATALOGO] as Filtro[]).map((t) => {
          const n = t === 'todos' ? encontradas.length : porTipo(t).length;
          if (t !== 'todos' && !fichas.some((f) => f.tipo === t)) return null;
          return (
            <button key={t} type="button" className={tipo === t ? 'activa' : undefined} aria-pressed={tipo === t} onClick={() => setTipo(t)}>
              {t === 'todos' ? 'Todos' : TITULOS_CATALOGO[t]} <span className="catalogo-n">{n}</span>
            </button>
          );
        })}
      </nav>

      {visibles.length === 0 ? (
        <div className="empty">
          <p>Ningún producto ASTA coincide con «{texto.trim()}».</p>
          <p className="stat-sub">Prueba con el cartucho original (CF226A, 285A) o solo el número de la impresora.</p>
        </div>
      ) : (
        visibles.map((t) => (
          <section key={t} className="catalogo-seccion" aria-labelledby={`cat-${t}`}>
            <h2 id={`cat-${t}`} className="catalogo-banda">
              {TITULOS_CATALOGO[t]}
            </h2>
            <div className="catalogo-rejilla">
              {porTipo(t).map(({ ficha, impresoras }) => (
                <Tarjeta key={ficha.id} f={ficha} impresoras={impresoras} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

function Tarjeta({ f, impresoras }: { f: FichaCatalogo; impresoras: string[] }) {
  return (
    <article className="catalogo-tarjeta">
      <div className="catalogo-foto">
        {f.foto ? (
          <img src={`/catalogo/${f.foto}`} alt={f.titulo} loading="lazy" decoding="async" />
        ) : (
          <span className="catalogo-sin-foto" aria-hidden="true">
            ASTA
          </span>
        )}
      </div>
      <div className="catalogo-marca">
        {f.marca}
        {f.colores.length > 1 && (
          <span className="catalogo-colores" aria-label={f.colores.join(', ')}>
            {f.colores.map((c) => (
              <i key={c} style={{ background: PUNTO[c] }} />
            ))}
          </span>
        )}
      </div>
      <h3>{f.titulo}</h3>
      <ul className="catalogo-variantes">
        {f.variantes.map((v) => (
          <li key={v.codigo}>
            <span className="catalogo-codigo">
              {v.color && <i style={{ background: PUNTO[v.color] }} title={v.color} />}
              <code>{v.codigo || '—'}</code>
              {v.detalle && <small>{v.detalle}</small>}
            </span>
            {v.precio !== null && <strong>{money(v.precio)}</strong>}
          </li>
        ))}
      </ul>
      {impresoras.length > 0 && (
        <p className="catalogo-para">
          Para {impresoras.slice(0, 2).join(', ')}
          {impresoras.length > 2 && ` y ${impresoras.length - 2} más`}
        </p>
      )}
    </article>
  );
}
