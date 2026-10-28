import { redirect } from 'next/navigation';

/**
 * Las alertas fueron una sección propia hasta el 2026-10-28; ahora son la
 * franja de arriba del Inicio (`BarraAlertas`). Un enlace guardado a la
 * sección lleva allí.
 */
export default function AlertasPage(): never {
  redirect('/admin');
}
