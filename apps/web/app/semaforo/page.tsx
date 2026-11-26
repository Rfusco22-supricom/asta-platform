import { redirect } from 'next/navigation';
import { requireSession } from '@/lib/session';
import { destinoPara } from '@/lib/navegacion';
import { Marco } from '@/components/Marco';
import { TablaSemaforo, leerFiltros } from '@/components/Semaforo';
import { Periodos, fechasDe } from '@/components/Periodos';
import { getSemaforoCartera, esRedireccion } from '@/lib/api';

/**
 * El semáforo de SU cartera: a qué clientes les vende impresoras y no el tóner
 * ASTA que usan, y qué ofrecerles (`components/Semaforo.tsx`).
 */

export const dynamic = 'force-dynamic';

export default async function SemaforoVendedorPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sesion = await requireSession();
  if (sesion.usuario.role !== 'VENDEDOR') redirect(destinoPara(sesion.usuario.role));
  const params = await searchParams;
  const { color, tamano, q } = leerFiltros(params);
  const rango = typeof params.desde === 'string' && typeof params.hasta === 'string' ? { desde: params.desde, hasta: params.hasta } : fechasDe('12m');

  let d;
  try {
    d = await getSemaforoCartera(sesion.accessToken, rango);
  } catch (error) {
    if (esRedireccion(error)) throw error;
    return (
      <Marco usuario={sesion.usuario} titulo="Semáforo de clientes">
        <div className="notice error">
          <h2>No se pudo leer de Odoo ahora</h2>
          <p>Recarga en un momento.</p>
        </div>
      </Marco>
    );
  }

  return (
    <Marco usuario={sesion.usuario} titulo="Semáforo de clientes">
      <Periodos base="/semaforo" periodo={rango} />
      <TablaSemaforo datos={d} base="/semaforo" color={color} tamano={tamano} q={q} conVendedor={false} />
    </Marco>
  );
}
