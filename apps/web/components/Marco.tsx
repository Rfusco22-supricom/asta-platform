import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { clearSession } from '@/lib/session';
import { ambitoDe, navegacionDe } from '@/lib/navegacion';
import { COOKIE_MENU } from '@/lib/menu';
import { limpiarEspacios, nombrePersona } from '@asta/shared-types';
import { MarcoCliente } from './MarcoCliente';
import { MenuUsuario } from './MenuUsuario';
import { BuscadorCabecera } from './Paleta';

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
 * Porque el número de secciones crece, y una barra superior se rompe a la
 * cuarta. El lateral crece hacia abajo, que es gratis, y se pliega a iconos
 * cuando hace falta el ancho para una tabla.
 *
 * ── Servidor por fuera, cliente por dentro ───────────────────────────────────
 *
 * Esto es un componente de SERVIDOR: lee la sesión y la preferencia del menú,
 * y pinta la cabecera. Lo interactivo —plegar el menú, la paleta ⌘K, marcar la
 * sección activa— va en `MarcoCliente`. Salir es una acción de servidor: el
 * formulario del menú funciona aunque el JavaScript falle.
 */

async function salir() {
  'use server';
  await clearSession();
  redirect('/login');
}

/** Iniciales para el avatar. Dos como mucho: tres ya no se leen a 34 px. */
function iniciales(nombre: string): string {
  const partes = nombre.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '·';
  return (partes[0][0] + (partes[1]?.[0] ?? '')).toUpperCase();
}

export async function Marco({
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
  /** Botones propios de la pantalla, a la izquierda del buscador. */
  acciones?: React.ReactNode;
  children: React.ReactNode;
}) {
  const grupos = navegacionDe(usuario.role);
  const plegado = (await cookies()).get(COOKIE_MENU)?.value === 'plegado';
  // El vendedor es una persona y su nombre viene de Odoo tal cual («MARTA  RUIZ (v)»).
  // El de un cliente es una razón social: solo se le quitan los espacios de más.
  const nombreVisible = usuario.role === 'VENDEDOR' ? nombrePersona(usuario.nombre) : limpiarEspacios(usuario.nombre);

  return (
    <MarcoCliente grupos={grupos} ambito={ambitoDe(usuario.role)} rol={usuario.role} plegadoInicial={plegado} salir={salir}>
      <header className="cabecera">
        <div className="cabecera-titulo">
          <h1>{titulo}</h1>
          {descripcion && <p>{descripcion}</p>}
        </div>

        {/*
          El chip del usuario ABRE un menú: tema, sesiones activas y cerrar
          sesión. A su izquierda, el buscador que abre la paleta ⌘K.
        */}
        <div className="cabecera-acciones">
          {acciones}
          <BuscadorCabecera />
          <MenuUsuario nombre={nombreVisible} rol={usuario.role} iniciales={iniciales(nombreVisible)} salir={salir} />
        </div>
      </header>

      {children}
    </MarcoCliente>
  );
}
