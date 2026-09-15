'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

/**
 * El chip del usuario, con menú.
 *
 * Era decorativo: enseñaba el nombre y el rol y no se podía pulsar, con el botón
 * de Salir suelto al lado. Todo el mundo intenta pulsar ahí —es donde está en
 * cualquier herramienta— y no pasaba nada.
 *
 * ── Detalles que hacen que un menú así no moleste ────────────────────────────
 *
 * Se cierra al pulsar fuera, con Escape, y al navegar. Los tres hacen falta: sin
 * el primero se queda abierto tapando la tabla, sin Escape no hay forma de salir
 * con el teclado, y sin el tercero el menú sobrevive al cambio de página y
 * aparece abierto en la siguiente.
 *
 * Salir sigue siendo un `<form>` con acción de servidor, ahora dentro del menú:
 * funciona aunque el JavaScript falle, que es la propiedad que más conviene
 * conservar justo en esa opción.
 */

export function MenuUsuario({
  nombre,
  rol,
  iniciales,
  salir,
}: {
  nombre: string;
  rol: string;
  iniciales: string;
  /** La acción de servidor que cierra la sesión. */
  salir: () => Promise<void>;
}) {
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abierto) return;

    const fuera = (e: MouseEvent) => {
      if (caja.current && !caja.current.contains(e.target as Node)) setAbierto(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAbierto(false);
    };

    document.addEventListener('mousedown', fuera);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', fuera);
      document.removeEventListener('keydown', escape);
    };
  }, [abierto]);

  return (
    <div className="menu-usuario" ref={caja}>
      <button
        type="button"
        className="chip-usuario"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        aria-haspopup="menu"
      >
        <span className="avatar" aria-hidden="true">
          {iniciales}
        </span>
        <span className="usuario-datos">
          <strong title={nombre}>{nombre}</strong>
          <small>{rol.toLowerCase()}</small>
        </span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={abierto ? 'chevron abierto' : 'chevron'}
          aria-hidden="true"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {abierto && (
        <div className="menu-desplegable" role="menu">
          <div className="menu-cabecera">
            <strong>{nombre}</strong>
            <small>{rol.toLowerCase()}</small>
          </div>

          {/* Cerrar al navegar: si no, el menú sigue abierto en la página nueva. */}
          <Link href="/cuenta/sesiones" role="menuitem" onClick={() => setAbierto(false)}>
            Sesiones activas
          </Link>

          <form action={salir}>
            <button type="submit" role="menuitem" className="menu-peligro">
              Cerrar sesión
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
