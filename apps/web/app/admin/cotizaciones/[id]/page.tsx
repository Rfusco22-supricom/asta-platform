import { requireSession } from '@/lib/session';
import { DetalleCotizacion } from '@/components/cotizaciones/DetalleCotizacion';

export const dynamic = 'force-dynamic';

/** Una cotización de cualquier cliente (ver `DetalleCotizacion`). */
export default async function CotizacionAdminPage({ params }: { params: Promise<{ id: string }> }) {
  const sesion = await requireSession();
  return <DetalleCotizacion sesion={sesion} id={Number((await params).id)} alcance="empresa" volver="/admin/cotizaciones" />;
}
