'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { GrupoNav, Seccion } from '@/lib/navegacion';

/**
 * El menú lateral.
 *
 * Es de cliente por una sola razón: marcar la sección activa necesita saber en
 * qué ruta está el navegador, y eso solo lo sabe `usePathname`. Todo lo demás
 * —quién es, qué ve— llega resuelto desde el servidor.
 */

/**
 * Iconos en SVG, dibujados aquí.
 *
 * Sin librería de iconos a propósito. Son seis glifos: una dependencia para eso
 * son 300 kB y un paso de build más para que la próxima persona tenga que
 * aprender otra API. Trazo de 1.5 y esquinas redondeadas, que es lo que hace que
 * un icono se lea a 16 px sin ensuciar.
 */
function Icono({ nombre }: { nombre: string }) {
  const comun = {
    width: 16,
    height: 16,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };

  switch (nombre) {
    case 'resumen':
      return (
        <svg {...comun}>
          <path d="M3 13h5v8H3zM10 3h5v18h-5zM17 9h4v12h-4z" />
        </svg>
      );
    case 'reportes':
      return (
        <svg {...comun}>
          <path d="M4 19V5a1 1 0 0 1 1-1h9l6 6v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1Z" />
          <path d="M14 4v6h6" />
          <path d="M8.5 17v-3.5M12 17v-6M15.5 17v-2" />
        </svg>
      );
    case 'usuarios':
      return (
        <svg {...comun}>
          <path d="M16 19v-1.5a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V19" />
          <circle cx="9" cy="7" r="3.2" />
          <path d="M22 19v-1.5a4 4 0 0 0-3-3.87M16.5 4.2a4 4 0 0 1 0 7.6" />
        </svg>
      );
    case 'marca':
      return (
        <svg {...comun}>
          <path d="M4 7.5h16M4 7.5v9a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-9" />
          <path d="M7.5 4.5h9l3.5 3H4z" />
          <path d="M10 12h4" />
        </svg>
      );
    case 'agentes':
      return (
        <svg {...comun}>
          <path d="M3.5 20v-1a4 4 0 0 1 4-4h3a4 4 0 0 1 4 4v1" />
          <circle cx="9" cy="7.5" r="3.2" />
          <path d="M17 11.5l1.6 1.6L21.5 10" />
        </svg>
      );
    case 'cartera':
      return (
        <svg {...comun}>
          <rect x="2.5" y="6.5" width="19" height="13" rx="2.5" />
          <path d="M8 6.5V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v1.5M2.5 12h19" />
        </svg>
      );
    case 'llave':
      return (
        <svg {...comun}>
          <circle cx="7.5" cy="12" r="3.5" />
          <path d="M11 12h10M18 12v3M15 12v2" />
        </svg>
      );
    case 'recomendador':
      // Una lupa sobre una hoja: lo que la gente busca.
      return (
        <svg {...comun}>
          <circle cx="11" cy="11" r="6.5" />
          <path d="M15.8 15.8 21 21M8.5 11h5M11 8.5v5" />
        </svg>
      );
    case 'compatibilidades':
      // Un cartucho que encaja en su hueco.
      return (
        <svg {...comun}>
          <rect x="3" y="8" width="18" height="11" rx="2" />
          <path d="M8 8V5h8v3M9 13.5l2 2 4-4" />
        </svg>
      );
    case 'duplicados':
      // Dos fichas iguales, una encima de otra: el mismo cliente dos veces.
      return (
        <svg {...comun}>
          <rect x="3" y="7" width="12" height="12" rx="2" />
          <path d="M8 4h11a2 2 0 0 1 2 2v11" />
        </svg>
      );
    case 'impulsa':
      // Una flecha que sube: lo que se puede vender más.
      return (
        <svg {...comun}>
          <path d="M3 17l6-6 4 4 8-8" />
          <path d="M15 7h6v6" />
        </svg>
      );
    case 'sesiones':
      return (
        <svg {...comun}>
          <rect x="2.5" y="4" width="19" height="13" rx="2" />
          <path d="M8 21h8M12 17v4" />
        </svg>
      );
    default:
      return (
        <svg {...comun}>
          <circle cx="12" cy="12" r="8.5" />
        </svg>
      );
  }
}

/**
 * ¿Está el usuario dentro de esta sección?
 *
 * `prefijo` existe para `/cartera`: abrir un cliente lleva a `/cartera/105841` y
 * el menú tiene que seguir señalando «Mi cartera». Sin esto, entrar en un
 * cliente apaga la única entrada encendida y parece que te has salido de la
 * aplicación.
 *
 * Con comparación exacta para el resto, porque `/cuenta/sesiones` y
 * `/cuenta/api-keys` comparten prefijo y se encenderían las dos a la vez.
 */
function estaActiva(ruta: string, href: string, prefijo?: boolean): boolean {
  return prefijo ? ruta === href || ruta.startsWith(`${href}/`) : ruta === href;
}

export function NavLateral({ grupos }: { grupos: GrupoNav[] }) {
  const ruta = usePathname();

  return (
    <nav className="nav" aria-label="Secciones">
      {grupos.map((g, i) => (
        <div key={g.titulo ?? `grupo-${i}`} className="nav-grupo">
          {g.titulo && <div className="nav-titulo">{g.titulo}</div>}
          {g.secciones.map((s) => {
            const activa = estaActiva(ruta, s.href, s.prefijo);
            return (
              <Link
                key={s.href}
                href={s.href}
                className={activa ? 'nav-item activa' : 'nav-item'}
                // Para quien navega con lector de pantalla: sin esto, «activa»
                // es solo un color y no se anuncia.
                aria-current={activa ? 'page' : undefined}
              >
                <Icono nombre={s.icono} />
                <span>{s.titulo}</span>
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

/** Cuántas pestañas caben abajo en un móvil de 360 px sin que el texto se corte. */
const MAX_PESTANAS = 5;

/**
 * El menú en pantallas estrechas: pestañas fijas abajo, como en una app.
 *
 * Las mismas secciones que el lateral, que en estrecho se queda solo con el
 * logo (ver `@media (max-width: 880px)` en `globals.css`). Si son más de cinco
 * —el administrador tiene nueve— van cuatro y «Más», que abre una hoja con el
 * resto. Las dos navegaciones se pintan siempre y es el CSS quien decide cuál
 * se ve: con JavaScript mirando el ancho, servidor y navegador pintarían cosas
 * distintas y la hidratación fallaría.
 */
export function NavInferior({ grupos }: { grupos: GrupoNav[] }) {
  const ruta = usePathname();
  const [abierta, setAbierta] = useState(false);

  // Al cambiar de pantalla, la hoja se cierra sola.
  useEffect(() => setAbierta(false), [ruta]);

  useEffect(() => {
    if (!abierta) return;
    const alTeclear = (e: KeyboardEvent) => e.key === 'Escape' && setAbierta(false);
    window.addEventListener('keydown', alTeclear);
    return () => window.removeEventListener('keydown', alTeclear);
  }, [abierta]);

  const todas = grupos.flatMap((g) => g.secciones);
  const caben = todas.length <= MAX_PESTANAS;
  const fijas = caben ? todas : todas.slice(0, MAX_PESTANAS - 1);
  const resto = caben ? [] : todas.slice(MAX_PESTANAS - 1);
  const masActiva = resto.some((s) => estaActiva(ruta, s.href, s.prefijo));

  const pestana = (s: Seccion) => {
    const activa = estaActiva(ruta, s.href, s.prefijo);
    return (
      <Link key={s.href} href={s.href} className={activa ? 'pestana activa' : 'pestana'} aria-current={activa ? 'page' : undefined}>
        <span className="pestana-icono">
          <Icono nombre={s.icono} />
        </span>
        <span className="pestana-texto">{s.corto ?? s.titulo}</span>
      </Link>
    );
  };

  return (
    <>
      <nav className="nav-inferior" aria-label="Secciones">
        {fijas.map(pestana)}
        {resto.length > 0 && (
          <button
            type="button"
            className={masActiva || abierta ? 'pestana activa' : 'pestana'}
            aria-expanded={abierta}
            aria-controls="hoja-mas"
            onClick={() => setAbierta((a) => !a)}
          >
            <span className="pestana-icono">
              <svg width={16} height={16} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <circle cx="5" cy="12" r="1.8" />
                <circle cx="12" cy="12" r="1.8" />
                <circle cx="19" cy="12" r="1.8" />
              </svg>
            </span>
            <span className="pestana-texto">Más</span>
          </button>
        )}
      </nav>

      {resto.length > 0 && (
        <div className={abierta ? 'hoja-fondo abierta' : 'hoja-fondo'} onClick={() => setAbierta(false)} aria-hidden={!abierta}>
          <div id="hoja-mas" className="hoja" role="dialog" aria-label="Más secciones" onClick={(e) => e.stopPropagation()}>
            <span className="hoja-asa" aria-hidden="true" />
            {resto.map((s) => {
              const activa = estaActiva(ruta, s.href, s.prefijo);
              return (
                <Link key={s.href} href={s.href} className={activa ? 'hoja-item activa' : 'hoja-item'} aria-current={activa ? 'page' : undefined} tabIndex={abierta ? 0 : -1}>
                  <Icono nombre={s.icono} />
                  <span>{s.titulo}</span>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
