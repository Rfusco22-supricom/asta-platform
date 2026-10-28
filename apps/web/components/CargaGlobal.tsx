'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';

/**
 * El aviso de «cargando» de TODO el panel, para que ningún clic se quede sin
 * respuesta visible mientras Odoo contesta.
 *
 * Antes solo lo tenían los enlaces que llevaban `CargandoEnlace` dentro (el
 * menú, las sedes, los periodos…): pulsar un filtro de una tabla, un «Ver
 * todos →» o una pestaña no hacía nada visible durante uno o dos segundos.
 * Aquí se escucha en todo el documento y se marca `<html data-cargando>`; el
 * CSS pinta lo mismo que `body:has(.enlace-cargando)` (ver `globals.css`):
 *
 *   · `navegando` — un enlace interno, un formulario o un `router.push` que
 *     avisa con el evento `asta:carga` (`empezarCarga`): barra arriba, cursor
 *     de espera, contenido atenuado y el enlace pulsado marcado. Se quita en
 *     cuanto cambia la URL.
 *   · `accion` — una llamada a `/api/…` de un botón (guardar, buscar, validar):
 *     solo la barra y el cursor, sin atenuar, para poder seguir escribiendo.
 *     Aparece si tarda más de un momento.
 *
 * Si algo no llega nunca a cambiar la URL (un enlace a la misma página), se
 * quita solo al rato: el aviso nunca puede quedarse puesto.
 */

const EVENTO = 'asta:carga';
const MAXIMO_MS = 15_000;
const ESPERA_ACCION_MS = 250;
/** Llamadas que el panel hace solo, sin que nadie pulse nada: no avisan. */
const DE_FONDO = ['/api/contadores', '/api/buscar'];

/** Para quien navega con `router.push` en vez de con un enlace. */
export function empezarCarga(): void {
  window.dispatchEvent(new Event(EVENTO));
}

function marcar(estado: 'navegando' | 'accion' | null): void {
  const html = document.documentElement;
  if (estado) html.dataset.cargando = estado;
  else delete html.dataset.cargando;
}

export function CargaGlobal() {
  const ruta = usePathname();
  const busqueda = useSearchParams();

  // La pantalla nueva llegó: fuera el aviso y la marca del enlace pulsado.
  useEffect(() => {
    if (document.documentElement.dataset.cargando === 'navegando') marcar(null);
    document.querySelectorAll('[data-pulsado]').forEach((e) => e.removeAttribute('data-pulsado'));
  }, [ruta, busqueda]);

  useEffect(() => {
    let reloj: ReturnType<typeof setTimeout> | undefined;
    const navegar = (pulsado?: Element) => {
      marcar('navegando');
      pulsado?.setAttribute('data-pulsado', '');
      clearTimeout(reloj);
      reloj = setTimeout(() => {
        marcar(null);
        pulsado?.removeAttribute('data-pulsado');
      }, MAXIMO_MS);
    };

    const alPulsar = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a[href]');
      if (!(a instanceof HTMLAnchorElement) || a.target === '_blank' || a.hasAttribute('download')) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
      // A la misma pantalla (o solo a un ancla) no hay nada que esperar.
      if (url.pathname === location.pathname && url.search === location.search) return;
      navegar(a);
    };
    const alEnviar = (e: SubmitEvent) => {
      if (!e.defaultPrevented) navegar(e.target as Element);
    };
    const alAvisar = () => navegar();

    // Capturando: Next cancela el clic del <Link> para navegar él, y aquí hay
    // que verlo antes. `alEnviar` va sin capturar para ver si alguien lo canceló.
    document.addEventListener('click', alPulsar, true);
    document.addEventListener('submit', alEnviar);
    window.addEventListener(EVENTO, alAvisar);

    // Las llamadas de los botones al propio panel.
    const original = window.fetch;
    let enCurso = 0;
    let aviso: ReturnType<typeof setTimeout> | undefined;
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const destino = typeof args[0] === 'string' ? args[0] : args[0] instanceof URL ? args[0].href : args[0].url;
      const url = new URL(destino, location.href);
      const cuenta = url.origin === location.origin && url.pathname.startsWith('/api/') && !DE_FONDO.some((p) => url.pathname.startsWith(p));
      if (!cuenta) return original(...args);
      if (enCurso++ === 0) {
        aviso = setTimeout(() => {
          if (document.documentElement.dataset.cargando !== 'navegando') marcar('accion');
        }, ESPERA_ACCION_MS);
      }
      try {
        return await original(...args);
      } finally {
        if (--enCurso === 0) {
          clearTimeout(aviso);
          if (document.documentElement.dataset.cargando === 'accion') marcar(null);
        }
      }
    };

    return () => {
      document.removeEventListener('click', alPulsar, true);
      document.removeEventListener('submit', alEnviar);
      window.removeEventListener(EVENTO, alAvisar);
      window.fetch = original;
      clearTimeout(reloj);
      clearTimeout(aviso);
    };
  }, []);

  return null;
}
