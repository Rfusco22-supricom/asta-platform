import { requireSession } from '@/lib/session';
import { DetalleCotizacion } from '@/components/cotizaciones/DetalleCotizacion';

export const dynamic = 'force-dynamic';

/** Una cotización de un cliente de la propia cartera (ver `DetalleCotizacion`). */
export default async function CotizacionVendedorPage({ params }: { params: Promise<{ id: string }> }) {
  const sesion = await requireSession();
  return <DetalleCotizacion sesion={sesion} id={Number((await params).id)} alcance="cartera" volver="/cotizaciones" />;
}
