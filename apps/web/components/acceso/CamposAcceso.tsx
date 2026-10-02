'use client';

import { useState } from 'react';
import { useFormStatus } from 'react-dom';

/**
 * Las piezas del formulario de entrar que necesitan el navegador: ver la
 * contraseña, avisar de las mayúsculas y que el botón diga que está entrando.
 *
 * El formulario sigue siendo una server action (`app/login/page.tsx`): sin
 * JavaScript se entra igual, solo se pierden estos detalles.
 */

const icono = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export function IconoCorreo() {
  return (
    <svg {...icono} aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="3" />
      <path d="m4 7 8 6 8-6" />
    </svg>
  );
}

/** Un globo de conversación con un teléfono: se lee como «escríbenos» sin copiar el logotipo de WhatsApp. */
export function IconoWhatsapp() {
  return (
    <svg {...icono} aria-hidden="true">
      <path d="M20.5 12a8.5 8.5 0 0 1-12.4 7.55L3.5 20.5l1-4.4A8.5 8.5 0 1 1 20.5 12Z" />
      <path d="M9.2 8.6c.2-.4.6-.4.9-.2l.9 1.4c.2.3.1.6-.1.8l-.4.4c.4 1 1.3 1.9 2.4 2.4l.4-.4c.2-.2.5-.3.8-.1l1.4.9c.3.2.3.6 0 .9-.6.7-1.5.9-2.4.5a7.7 7.7 0 0 1-4.1-4.1c-.3-.9-.2-1.8.2-2.5Z" />
    </svg>
  );
}

function IconoCandado() {
  return (
    <svg {...icono} aria-hidden="true">
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </svg>
  );
}

function IconoOjo({ tachado }: { tachado: boolean }) {
  return (
    <svg {...icono} aria-hidden="true">
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
      {tachado && <path d="M4 20 20 4" />}
    </svg>
  );
}

/** Contraseña con botón para verla y aviso de bloqueo de mayúsculas. */
export function CampoContrasena({ id, name, autoComplete }: { id: string; name: string; autoComplete: string }) {
  const [visible, setVisible] = useState(false);
  const [mayusculas, setMayusculas] = useState(false);
  const comprobar = (e: React.KeyboardEvent<HTMLInputElement>) => setMayusculas(e.getModifierState?.('CapsLock') ?? false);

  return (
    <>
      <div className="acceso-entrada">
        <IconoCandado />
        <input
          id={id}
          name={name}
          type={visible ? 'text' : 'password'}
          className="input"
          autoComplete={autoComplete}
          required
          onKeyDown={comprobar}
          onKeyUp={comprobar}
          onBlur={() => setMayusculas(false)}
          aria-describedby={mayusculas ? `${id}-mayus` : undefined}
        />
        <button
          type="button"
          className="acceso-ver"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Ocultar la contraseña' : 'Ver la contraseña'}
          aria-pressed={visible}
        >
          <IconoOjo tachado={visible} />
        </button>
      </div>
      {mayusculas && (
        <p id={`${id}-mayus`} className="acceso-mayus" role="status">
          Las mayúsculas están activadas.
        </p>
      )}
    </>
  );
}

/** El botón de enviar: mientras el servidor responde, dice que está en ello y no se pulsa dos veces. */
export function BotonEnviar({ children, enviando }: { children: React.ReactNode; enviando: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn acceso-boton" disabled={pending} aria-busy={pending}>
      {pending ? (
        <>
          <span className="acceso-giro" aria-hidden="true" />
          {enviando}
        </>
      ) : (
        <>
          {children}
          <span className="acceso-flecha" aria-hidden="true">
            →
          </span>
        </>
      )}
    </button>
  );
}
