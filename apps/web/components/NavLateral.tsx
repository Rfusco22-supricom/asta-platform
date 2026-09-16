'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { GrupoNav } from '@/lib/navegacion';

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
    case 'compatibilidades':
      // Un cartucho que encaja en su hueco.
      return (
        <svg {...comun}>
          <rect x="3" y="8" width="18" height="11" rx="2" />
          <path d="M8 8V5h8v3M9 13.5l2 2 4-4" />
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
