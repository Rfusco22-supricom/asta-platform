'use client';

import { ROLE_LABEL, type AppRole } from '@asta/shared-types';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GrupoNav } from '@/lib/navegacion';
import { aplicarTema } from '@/lib/tema';
import { Icono } from './NavLateral';

/**
 * La paleta ⌘K: saltar a cualquier sitio sin tocar el ratón.
 *
 * Se abre con ⌘K (Ctrl+K fuera del Mac) desde cualquier pantalla, o con el
 * buscador de la cabecera. Busca en tres sitios:
 *
 *   · Secciones — las del menú de ESTE rol, nunca otras (`navegacionDe`).
 *   · Clientes — los de la cartera del vendedor, o todos para el administrador,
 *     para abrir su ficha. Se piden una sola vez, al abrir la paleta por
 *     primera vez (`/api/buscar/clientes`).
 *   · Acciones — tema, plegar el menú, cerrar sesión.
 *
 * Sin texto escrito enseña lo último que se abrió desde aquí («Recientes»), que
 * es casi siempre a donde se quiere volver. Eso se guarda en `localStorage`: es
 * una comodidad de este navegador, y si no se puede leer, no pasa nada.
 *
 * La búsqueda ignora tildes y mayúsculas, y cada palabra escrita tiene que
 * aparecer: «cart mar» encuentra «Mi cartera» de Marta, no medio menú.
 */

/** Evento que abre la paleta: lo lanza el buscador de la cabecera. */
const EVENTO_ABRIR = 'asta:paleta';
const CLAVE_RECIENTES = 'asta-paleta-recientes';
const MAX_RECIENTES = 5;
const MAX_CLIENTES = 8;

interface Elemento {
  id: string;
  grupo: 'Recientes' | 'Secciones' | 'Clientes' | 'Acciones';
  titulo: string;
  subtitulo?: string;
  dato?: string;
  icono: string;
  /** Si lleva a una página, su ruta: es lo que se recuerda en «Recientes». */
  href?: string;
  ejecutar: () => void;
  /** Texto donde se busca, ya normalizado. */
  buscable: string;
}

interface Reciente {
  titulo: string;
  subtitulo?: string;
  href: string;
  icono: string;
}

interface ClientePaleta {
  id: number;
  nombre: string;
  nivel: string;
  facturado: number;
}

const normalizar = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

function leerRecientes(): Reciente[] {
  try {
    const v = JSON.parse(localStorage.getItem(CLAVE_RECIENTES) ?? '[]') as Reciente[];
    return Array.isArray(v) ? v.slice(0, MAX_RECIENTES) : [];
  } catch {
    return [];
  }
}

function guardarReciente(r: Reciente) {
  try {
    const resto = leerRecientes().filter((x) => x.href !== r.href);
    localStorage.setItem(CLAVE_RECIENTES, JSON.stringify([r, ...resto].slice(0, MAX_RECIENTES)));
  } catch {
    // Sin almacenamiento (ventana privada, bloqueado): la paleta funciona igual.
  }
}

const usd = new Intl.NumberFormat('es-VE', { maximumFractionDigits: 0 });

/** El botón de la cabecera que abre la paleta. */
export function BuscadorCabecera() {
  // ⌘ en el Mac y Ctrl en el resto. Se decide tras montar: el servidor no sabe
  // en qué sistema está el navegador, y pintar otra cosa rompería la hidratación.
  const [atajo, setAtajo] = useState('⌘K');
  useEffect(() => {
    if (!/Mac|iPhone|iPad/.test(navigator.platform)) setAtajo('Ctrl K');
  }, []);

  return (
    <button type="button" className="buscador" onClick={() => window.dispatchEvent(new Event(EVENTO_ABRIR))} aria-keyshortcuts="Meta+K Control+K">
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
        <circle cx="11" cy="11" r="6.5" />
        <path d="M15.8 15.8 21 21" />
      </svg>
      <span>Buscar o ir a…</span>
      <kbd className="tecla">{atajo}</kbd>
    </button>
  );
}

export function Paleta({
  grupos,
  rol,
  salir,
  plegado,
  alternarMenu,
}: {
  grupos: GrupoNav[];
  rol: string;
  salir: () => Promise<void>;
  plegado: boolean;
  alternarMenu: () => void;
}) {
  const router = useRouter();
  const [abierta, setAbierta] = useState(false);
  const [consulta, setConsulta] = useState('');
  const [indice, setIndice] = useState(0);
  const [recientes, setRecientes] = useState<Reciente[]>([]);
  const [clientes, setClientes] = useState<ClientePaleta[] | null>(null);
  const [cargandoClientes, setCargandoClientes] = useState(false);
  const entrada = useRef<HTMLInputElement>(null);
  const lista = useRef<HTMLDivElement>(null);
  // El vendedor busca en su cartera; el administrador, en todos los clientes.
  const conCartera = rol === 'VENDEDOR' || rol === 'SUPERADMIN';

  const cerrar = useCallback(() => setAbierta(false), []);

  // Abrir: ⌘K / Ctrl+K en cualquier sitio, o el evento del buscador.
  useEffect(() => {
    const teclado = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setAbierta((a) => !a);
      }
    };
    const abrir = () => setAbierta(true);
    window.addEventListener('keydown', teclado);
    window.addEventListener(EVENTO_ABRIR, abrir);
    return () => {
      window.removeEventListener('keydown', teclado);
      window.removeEventListener(EVENTO_ABRIR, abrir);
    };
  }, []);

  // Al abrir: texto vacío, foco en el campo y los recientes al día.
  useEffect(() => {
    if (!abierta) return;
    setConsulta('');
    setIndice(0);
    setRecientes(leerRecientes());
    requestAnimationFrame(() => entrada.current?.focus());
  }, [abierta]);

  // La cartera, la primera vez que se abre. Aparte del efecto de arriba: si
  // fueran juntos, la llegada de los clientes borraría lo que ya se escribió.
  useEffect(() => {
    if (abierta && conCartera && clientes === null && !cargandoClientes) {
      setCargandoClientes(true);
      fetch('/api/buscar/clientes', { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : { clientes: [] }))
        .then((d: { clientes?: ClientePaleta[] }) => setClientes(d.clientes ?? []))
        .catch(() => setClientes([]))
        .finally(() => setCargandoClientes(false));
    }
  }, [abierta, conCartera, clientes, cargandoClientes]);

  const ir = useCallback(
    (r: Reciente) => {
      guardarReciente(r);
      setAbierta(false);
      router.push(r.href);
    },
    [router],
  );

  const elementos = useMemo<Elemento[]>(() => {
    const secciones: Elemento[] = grupos.flatMap((g) =>
      g.secciones.map((s) => ({
        id: `s:${s.href}`,
        grupo: 'Secciones' as const,
        titulo: s.titulo,
        subtitulo: g.titulo ?? undefined,
        icono: s.icono,
        href: s.href,
        ejecutar: () => ir({ titulo: s.titulo, subtitulo: g.titulo ?? undefined, href: s.href, icono: s.icono }),
        buscable: normalizar(`${s.titulo} ${g.titulo ?? ''} ${s.corto ?? ''}`),
      })),
    );

    const acciones: Elemento[] = [
      { id: 'a:claro', titulo: 'Tema claro', icono: 'sol', ejecutar: () => aplicarTema('claro') },
      { id: 'a:oscuro', titulo: 'Tema oscuro', icono: 'luna', ejecutar: () => aplicarTema('oscuro') },
      { id: 'a:sistema', titulo: 'Tema del sistema', icono: 'pantalla', ejecutar: () => aplicarTema('sistema') },
      { id: 'a:menu', titulo: plegado ? 'Desplegar el menú' : 'Plegar el menú', icono: 'menu', ejecutar: alternarMenu },
      { id: 'a:salir', titulo: 'Cerrar sesión', icono: 'salir', ejecutar: () => void salir() },
    ].map((a) => ({
      ...a,
      grupo: 'Acciones' as const,
      ejecutar: () => {
        setAbierta(false);
        a.ejecutar();
      },
      buscable: normalizar(`${a.titulo} accion`),
    }));

    const q = normalizar(consulta.trim());
    if (!q) {
      const rec: Elemento[] = recientes.map((r) => ({
        id: `r:${r.href}`,
        grupo: 'Recientes',
        titulo: r.titulo,
        subtitulo: r.subtitulo,
        icono: r.icono,
        href: r.href,
        ejecutar: () => ir(r),
        buscable: '',
      }));
      const vistos = new Set(rec.map((r) => r.href));
      return [...rec, ...secciones.filter((s) => !vistos.has(s.href)), ...acciones];
    }

    const palabras = q.split(/\s+/);
    const coincide = (e: Elemento) => palabras.every((p) => e.buscable.includes(p));

    const deCartera: Elemento[] = (clientes ?? [])
      .map((c) => ({ c, b: normalizar(`${c.nombre} ${c.id}`) }))
      .filter(({ b }) => palabras.every((p) => b.includes(p)))
      .sort((x, y) => y.c.facturado - x.c.facturado)
      .slice(0, MAX_CLIENTES)
      .map(({ c, b }) => {
        const nivel = ROLE_LABEL[c.nivel as AppRole] ?? c.nivel;
        const href = `/cartera/${c.id}`;
        return {
          id: `c:${c.id}`,
          grupo: 'Clientes' as const,
          titulo: c.nombre,
          subtitulo: nivel,
          dato: c.facturado > 0 ? `${usd.format(c.facturado)} USD` : undefined,
          icono: 'cartera',
          href,
          ejecutar: () => ir({ titulo: c.nombre, subtitulo: nivel, href, icono: 'cartera' }),
          buscable: b,
        };
      });

    return [...secciones.filter(coincide), ...deCartera, ...acciones.filter(coincide)];
  }, [grupos, consulta, recientes, clientes, plegado, alternarMenu, salir, ir]);

  // Que la selección no se salga de la lista al filtrar.
  useEffect(() => {
    setIndice((i) => Math.min(i, Math.max(0, elementos.length - 1)));
  }, [elementos.length]);

  // La seleccionada, siempre a la vista.
  useEffect(() => {
    lista.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [indice]);

  if (!abierta) return null;

  const teclas = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIndice((i) => (i + 1) % Math.max(1, elementos.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIndice((i) => (i - 1 + elementos.length) % Math.max(1, elementos.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      elementos[indice]?.ejecutar();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cerrar();
    }
  };

  let grupoAnterior = '';
  const activo = elementos[indice];

  return (
    <div className="paleta-fondo" onMouseDown={cerrar}>
      <div className="paleta" role="dialog" aria-modal="true" aria-label="Buscar o ir a" onMouseDown={(e) => e.stopPropagation()} onKeyDown={teclas}>
        <div className="paleta-entrada">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="6.5" />
            <path d="M15.8 15.8 21 21" />
          </svg>
          <input
            ref={entrada}
            value={consulta}
            onChange={(e) => {
              setConsulta(e.target.value);
              setIndice(0);
            }}
            placeholder={conCartera ? 'Busca una sección, un cliente o una acción' : 'Busca una sección o una acción'}
            role="combobox"
            aria-expanded="true"
            aria-controls="paleta-lista"
            aria-activedescendant={activo ? `paleta-${activo.id}` : undefined}
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="tecla">Esc</kbd>
        </div>

        <div className="paleta-lista" id="paleta-lista" role="listbox" ref={lista} aria-label="Resultados">
          {elementos.length === 0 && (
            <div className="paleta-vacio">
              {cargandoClientes ? 'Buscando clientes…' : `Nada coincide con «${consulta}».`}
            </div>
          )}
          {elementos.map((e, i) => {
            const cabecera = e.grupo !== grupoAnterior ? e.grupo : null;
            grupoAnterior = e.grupo;
            return (
              <div key={e.id}>
                {cabecera && (
                  <div className="paleta-grupo" role="presentation">
                    {cabecera}
                    {cabecera === 'Clientes' && cargandoClientes ? ' · cargando…' : ''}
                  </div>
                )}
                <button
                  type="button"
                  id={`paleta-${e.id}`}
                  role="option"
                  aria-selected={i === indice}
                  className="paleta-item"
                  onMouseMove={() => i !== indice && setIndice(i)}
                  onClick={e.ejecutar}
                  tabIndex={-1}
                >
                  <span className="paleta-icono" aria-hidden="true">
                    <IconoPaleta nombre={e.icono} />
                  </span>
                  <span className="paleta-texto">
                    <strong>{e.titulo}</strong>
                    {e.subtitulo && <small>{e.subtitulo}</small>}
                  </span>
                  {e.dato && <span className="paleta-dato">{e.dato}</span>}
                </button>
              </div>
            );
          })}
        </div>

        <div className="paleta-pie" aria-hidden="true">
          <span>
            <kbd className="tecla">↑</kbd>
            <kbd className="tecla">↓</kbd> moverse
          </span>
          <span>
            <kbd className="tecla">↵</kbd> abrir
          </span>
          <span>
            <kbd className="tecla">Esc</kbd> cerrar
          </span>
        </div>
      </div>
    </div>
  );
}

/** Los iconos del menú, más los de las acciones, que no son secciones. */
function IconoPaleta({ nombre }: { nombre: string }) {
  const comun = {
    width: 17,
    height: 17,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  switch (nombre) {
    case 'sol':
      return (
        <svg {...comun}>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
        </svg>
      );
    case 'luna':
      return (
        <svg {...comun}>
          <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
        </svg>
      );
    case 'pantalla':
      return (
        <svg {...comun}>
          <rect x="3" y="4" width="18" height="12" rx="2" />
          <path d="M8 20h8M12 16v4" />
        </svg>
      );
    case 'menu':
      return (
        <svg {...comun}>
          <rect x="3" y="4" width="18" height="16" rx="3" />
          <path d="M9 4v16" />
        </svg>
      );
    case 'salir':
      return (
        <svg {...comun}>
          <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
          <path d="M10 8l-4 4 4 4M6 12h10" />
        </svg>
      );
    default:
      return <Icono nombre={nombre} />;
  }
}
