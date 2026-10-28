'use client';

import { useCallback, useEffect, useState } from 'react';
import type { GrupoNav } from '@/lib/navegacion';
import { COOKIE_MENU } from '@/lib/menu';
import { NavInferior, NavLateral, useContadores } from './NavLateral';
import { Paleta } from './Paleta';

/**
 * La parte del marco que vive en el navegador: el lateral plegable y la paleta.
 *
 * Las dos comparten un estado —si el menú está plegado—, porque la paleta tiene
 * la acción «Plegar el menú». Por eso van en el mismo componente de cliente y no
 * cada una por su lado. El contenido de la pantalla llega como `children` desde
 * el servidor y no se vuelve a pintar al plegar.
 *
 * El estado se guarda en una cookie y el servidor la lee al pintar (`Marco`):
 * así la página llega ya plegada y no da un salto al cargar.
 */
export function MarcoCliente({
  grupos,
  ambito,
  rol,
  plegadoInicial,
  salir,
  children,
}: {
  grupos: GrupoNav[];
  ambito: string;
  rol: string;
  plegadoInicial: boolean;
  salir: () => Promise<void>;
  children: React.ReactNode;
}) {
  const [plegado, setPlegado] = useState(plegadoInicial);
  const contadores = useContadores();

  const alternarMenu = useCallback(() => setPlegado((p) => !p), []);

  useEffect(() => {
    document.cookie = `${COOKIE_MENU}=${plegado ? 'plegado' : 'abierto'}; path=/; max-age=31536000; samesite=lax`;
  }, [plegado]);

  return (
    <div className="app" data-menu={plegado ? 'plegado' : undefined}>
      <aside className="lateral">
        <div className="lateral-marca">
          {/*
            El logo de la marca, recortado por CSS: el PNG trae mucho margen
            transparente. Las medidas están en `.marca-logo` (globals.css).

            Sin `next/image` a propósito: es un activo fijo que sale en todas las
            pantallas, y el optimizador añade un salto al servidor para algo que
            el navegador ya cachea desde la primera carga.
          */}
          <span className="marca-logo">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/asta-logo.png" alt="ASTA" />
          </span>
          <span className="marca-ambito">{ambito}</span>
          <button
            type="button"
            className="plegar"
            onClick={alternarMenu}
            aria-pressed={plegado}
            aria-label={plegado ? 'Desplegar el menú' : 'Plegar el menú'}
            title={plegado ? 'Desplegar el menú' : 'Plegar el menú'}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 6l-6 6 6 6" />
            </svg>
          </button>
        </div>

        <NavLateral grupos={grupos} plegado={plegado} contadores={contadores} />
      </aside>

      {/* En estrecho el menú baja a pestañas fijas; en ancho, el CSS lo oculta. */}
      <NavInferior grupos={grupos} contadores={contadores} />

      <main className="contenido">{children}</main>

      <Paleta grupos={grupos} rol={rol} salir={salir} plegado={plegado} alternarMenu={alternarMenu} />
    </div>
  );
}
