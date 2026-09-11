import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ASTA · Panel de vendedores',
  description: 'Cartera y facturación, en vivo desde Odoo',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
