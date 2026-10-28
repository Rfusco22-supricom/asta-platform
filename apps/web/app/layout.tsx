import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { cookies } from 'next/headers';
import { COOKIE_TEMA, temaValido } from '@/lib/tema';
import './globals.css';

/**
 * Tipografía del panel: Inter para todo, también las cifras, con números de
 * ancho fijo para que las columnas cuadren (`globals.css`). Hasta octubre de
 * 2026 eran Sora y DM Mono; la aplicación de las tablets sigue con Sora.
 *
 * Con `next/font` la fuente se descarga al CONSTRUIR y se sirve desde el propio
 * panel: el navegador no habla con Google, no hay salto de tipografía al cargar
 * y funciona igual en la red de la tienda. Deja su familia en una variable CSS.
 */
const inter = Inter({ subsets: ['latin'], variable: '--fuente-inter', display: 'swap' });

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
    <html lang="es" className={inter.variable} data-theme={tema === 'sistema' ? undefined : tema}>
      <body>{children}</body>
    </html>
  );
}
