import Link from 'next/link';

/**
 * El marco de las páginas públicas de la aplicación ASTA: la política de
 * privacidad y el soporte. Las piden App Store y Google Play, así que se abren
 * sin iniciar sesión (ninguna llama a `requireSession`).
 */

/** El correo de contacto de la aplicación ASTA: el que sale en las dos tiendas. */
export const CORREO_APP = 'apps@supricom.com.ve';

/** La fecha de la última revisión, que las tiendas piden ver. */
export const REVISADA = '27 de octubre de 2026';

export function PaginaPublica({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="legal">
      <header className="legal-cabeza">
        <Link href="/soporte" className="legal-logo" aria-label="ASTA · Soporte">
          {/* eslint-disable-next-line @next/next/no-img-element -- PNG estático en /public */}
          <img src="/asta-logo.png" alt="ASTA" />
        </Link>
        <nav aria-label="Páginas de la aplicación">
          <Link href="/soporte">Soporte</Link>
          <Link href="/privacidad">Privacidad</Link>
        </nav>
      </header>
      <main className="legal-texto">
        <h1>{titulo}</h1>
        {children}
      </main>
      <footer className="legal-pie">ASTA · Supricom · {new Date().getFullYear()}</footer>
    </div>
  );
}
