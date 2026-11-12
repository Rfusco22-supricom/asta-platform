import type { Metadata, Viewport } from 'next';
import { DM_Mono, Sora } from 'next/font/google';
import './aplicacion.css';

/**
 * La aplicación ASTA en el navegador (PWA), mientras no estén las cuentas de
 * App Store y Google Play. La tablet abre `/aplicacion` y la instala en su
 * pantalla de inicio: se abre a pantalla completa, como la nativa.
 *
 * Sora y DM Mono, como las apps nativas (el panel usa Inter). Con `next/font`
 * se sirven desde el propio panel: funcionan igual en la red de la tienda.
 */
const sora = Sora({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--aa-sora', display: 'swap' });
const mono = DM_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--aa-mono', display: 'swap' });

export const metadata: Metadata = {
  title: 'ASTA · Encuentra tu tóner',
  description: 'Escribe el modelo de tu impresora y te decimos qué tóner ASTA le sirve.',
  manifest: '/aplicacion/manifest.webmanifest',
  applicationName: 'ASTA',
  appleWebApp: { capable: true, title: 'ASTA', statusBarStyle: 'black-translucent' },
  icons: { icon: '/aplicacion/icono-192.png', apple: '/aplicacion/icono-180.png' },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Una tablet compartida: que nadie la deje ampliada para el siguiente.
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#2A86F0',
};

export default function AplicacionLayout({ children }: { children: React.ReactNode }) {
  return <div className={`aa ${sora.variable} ${mono.variable}`}>{children}</div>;
}
