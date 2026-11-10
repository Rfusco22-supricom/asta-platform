import { redirect } from 'next/navigation';

/**
 * Pendientes ya no es una pantalla: lo que había aquí está en el Inicio, en
 * «Necesita tu atención» (`components/inicio/Atencion.tsx`), con lo urgente
 * primero. La ruta se queda para que los enlaces de antes sigan sirviendo.
 */
export default function PendientesPage() {
  redirect('/admin');
}
