import { redirect } from 'next/navigation';
import { clearSession } from '@/lib/session';
import { ambitoDe, navegacionDe } from '@/lib/navegacion';
import { NavLateral } from './NavLateral';

/**
 * El marco de toda pantalla con sesión: menú lateral, cabecera y contenido.
 *
 * ── Por qué es un componente y no se copia ───────────────────────────────────
 *
 * Estaba copiado. Cada pantalla definía su propio `Marco` con la misma barra
 * superior, y la de API keys ya había empezado a separarse de la de sesiones.
 * Es la misma historia que el enrutado por rol: dos copias, se arregla una, la
 * otra se queda — y ahí el síntoma fue un cliente leyendo «no tienes permiso»
 * en su primera pantalla.
 *
 * ── Menú lateral y no pestañas arriba ────────────────────────────────────────
 *
 * Porque el número de secciones va a crecer —agentes, ASTA, reportes— y una
 * barra superior se rompe a la cuarta. El lateral crece hacia abajo, que es
 * gratis, y deja el ancho entero para lo que importa: tablas de datos.
 *
 * ── Sin JavaScript para lo que no lo necesita ────────────────────────────────
 *
 * El marco es un componente de SERVIDOR. Solo el menú es de cliente, y solo
 * porque marcar la sección activa necesita la ruta del navegador. Salir es un
 * formulario con una acción de servidor: funciona aunque el JavaScript falle, y
 * la pantalla de la que más conviene poder salir siempre es esta.
 */

async function salir() {
  'use server';
  await clearSession();
  redirect('/login');
}

/** Iniciales para el avatar. Dos como mucho: tres ya no se leen a 28 px. */
function iniciales(nombre: string): string {
  const partes = nombre.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '·';
  return (partes[0][0] + (partes[1]?.[0] ?? '')).toUpperCase();
}

export function Marco({
  usuario,
  titulo,
  descripcion,
  acciones,
  children,
}: {
  usuario: { nombre: string; role: string };
  titulo: string;
  /** Una línea que diga a qué pregunta responde la pantalla. */
  descripcion?: string;
  /** Botones propios de la pantalla, a la izquierda del chip de usuario. */
  acciones?: React.ReactNode;
  children: React.ReactNode;
}) {
  const grupos = navegacionDe(usuario.role);

  return (
    <div className="app">
      <aside className="lateral">
        <div className="lateral-marca">
          {/*
            El logo de la marca, recortado por CSS.
            El PNG viene con mucho margen transparente alrededor —la tinta ocupa
            de x 94 a 3798 y de y 652 a 2106 en un lienzo de 3881×3105—, así que
            con `contain` saldría pequeño y descentrado. Los desplazamientos de
            `.marca-logo img` están calculados con esas medidas; si se cambia el
            fichero, hay que volver a medirlas.

            Sin `next/image` a propósito: es un activo fijo de 128 kB que sale en
            todas las pantallas, y el optimizador añade un salto al servidor para
            algo que el navegador ya cachea desde la primera carga.
          */}
          <span className="marca-logo">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/asta-logo.png" alt="ASTA" />
          </span>
          <span className="marca-ambito">{ambitoDe(usuario.role)}</span>
        </div>

        <NavLateral grupos={grupos} />

        {/*
          El pie dice de dónde salen los datos, no adorna.
          En una herramienta que lee un ERP en vivo, «¿esto está actualizado?» es
          la pregunta que más se repite, y tenerla contestada en un sitio fijo
          ahorra el viaje a preguntarlo.
        */}
        <div className="lateral-pie">
          <strong>Datos en vivo</strong>
          Facturación y cartera se leen de Odoo en cada carga.
        </div>
      </aside>

      <main className="contenido">
        <header className="cabecera">
          <div>
            <h1>{titulo}</h1>
            {descripcion && <p>{descripcion}</p>}
          </div>

          {/* Usuario arriba a la derecha, como en la referencia. Estaba en el
              pie del lateral, donde el indicador de desarrollo de Next lo tapaba
              justo encima del botón de salir. */}
          <div className="cabecera-acciones">
            {acciones}
            <span className="chip-usuario">
              <span className="avatar" aria-hidden="true">
                {iniciales(usuario.nombre)}
              </span>
              <span className="usuario-datos">
                <strong title={usuario.nombre}>{usuario.nombre}</strong>
                <small>{usuario.role.toLowerCase()}</small>
              </span>
            </span>
            <form action={salir}>
              <button type="submit" className="btn-salir">
                Salir
              </button>
            </form>
          </div>
        </header>

        {children}
      </main>
    </div>
  );
}
