import { requireSession } from '@/lib/session';
import { Marco } from '@/components/Marco';
import { Sedes, sedeDeParams } from '@/components/Sedes';
import { TablaSemaforo, leerFiltros } from '@/components/Semaforo';
import { getSemaforoEmpresa, esRedireccion } from '@/lib/api';

/**
 * El semáforo de clientes de la empresa, o de una sede: a quién le vendemos
 * impresoras y no el tóner ASTA que usan, con el vendedor de cada uno
 * (`components/Semaforo.tsx`).
 */

export const dynamic = 'force-dynamic';

export default async function SemaforoAdminPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sesion = await requireSession();
  const params = await searchParams;
  const sede = sedeDeParams(params);
  const { color, tamano } = leerFiltros(params);

  let d;
  try {
    d = await getSemaforoEmpresa(sesion.accessToken, sede);
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
      <Sedes base="/admin/semaforo" sede={sede} />
      <TablaSemaforo datos={d} base="/admin/semaforo" color={color} tamano={tamano} sede={sede} conVendedor />
    </Marco>
  );
}
