import type { Metadata, Viewport } from 'next';
import { DM_Mono, Sora } from 'next/font/google';
import { cookies } from 'next/headers';
import { COOKIE_TEMA, temaValido } from '@/lib/tema';
import './globals.css';

/**
 * Tipografía de la marca: Sora para todo y DM Mono para las cifras.
 *
 * Con `next/font` las fuentes se descargan al CONSTRUIR y se sirven desde el
 * propio panel: el navegador no habla con Google, no hay salto de tipografía al
 * cargar y funciona igual en la red de la tienda. Cada una deja su familia en
 * una variable CSS, y `globals.css` decide dónde va cada cual.
 */
const sora = Sora({ subsets: ['latin'], variable: '--fuente-sora', display: 'swap' });
const dmMono = DM_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--fuente-mono', display: 'swap' });

export const metadata: Metadata = {
  title: 'ASTA',
  description: 'Tu cuenta ASTA',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#EDF2F8' },
    { media: '(prefers-color-scheme: dark)', color: '#070D18' },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // El tema elegido en el menú de usuario. Se lee en el servidor para que la
  // página llegue ya pintada con él: decidirlo en el navegador haría un destello
  // del tema contrario en cada carga. Sin elección, manda el sistema.
  const tema = temaValido((await cookies()).get(COOKIE_TEMA)?.value);

  return (
    <html lang="es" className={`${sora.variable} ${dmMono.variable}`} data-theme={tema === 'sistema' ? undefined : tema}>
      <body>{children}</body>
    </html>
  );
}
