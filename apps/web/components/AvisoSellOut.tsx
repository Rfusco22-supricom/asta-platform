import Link from 'next/link';
import { DIAS_AVISO_SELLOUT, plazoSellout } from '@asta/shared-types';
import { nombreMes } from '@/lib/meses';

/**
 * El recordatorio del sell-out: los últimos `DIAS_AVISO_SELLOUT` días del mes,
 * mientras el cliente no haya reportado el de este mes. Para el programa vale
 * hasta su último día; después ya no cuenta para subir de nivel.
 */
export function AvisoSellOut({ reportado, enlace }: { reportado: boolean; enlace: boolean }) {
  const p = plazoSellout();
  if (reportado || p.dias > DIAS_AVISO_SELLOUT) return null;
  const mes = nombreMes(p.mes).split(' ')[0]!.toLowerCase();
  return (
    <div className="notice aviso-sellout" role="status">
      <h2>{p.dias === 1 ? `Hoy es el último día para reportar tu sell-out de ${mes}` : `Te quedan ${p.dias} días para reportar tu sell-out de ${mes}`}</h2>
      <p>
        Cuenta para tu nivel ASTA si lo reportas hasta el {p.ultimoDia} de {mes}.{' '}
        {enlace && <Link href="/cuenta/sellout">Reportarlo ahora</Link>}
      </p>
    </div>
  );
}
