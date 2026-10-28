'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import type { SedeId } from '@asta/shared-types';
import { nombreMes, rangoDelAnio, rangoDelMes, ultimosMeses } from '@/lib/meses';
import { urlCon } from './Sedes';

/**
 * Elegir un mes o un año concreto, junto a los botones de `Periodos`. Como
 * ellos, lleva las FECHAS a la URL: el enlace dice siempre lo mismo.
 */

const MESES = 24;
const ANIOS = 3;

export function ElegirPeriodo({ base, periodo, sede }: { base: string; periodo: { desde: string; hasta: string }; sede: SedeId | null }) {
  const router = useRouter();
  const [cargando, iniciar] = useTransition();
  const hoy = new Date();
  const meses = ultimosMeses(MESES, hoy);
  const anios = Array.from({ length: ANIOS }, (_, i) => hoy.getUTCFullYear() - i);

  // Qué opción está puesta: la que da exactamente estas fechas.
  const mesActivo = meses.find((m) => {
    const r = rangoDelMes(m, hoy);
    return r.desde === periodo.desde && r.hasta === periodo.hasta;
  });
  const anioActivo = anios.find((a) => {
    const r = rangoDelAnio(a, hoy);
    return r.desde === periodo.desde && r.hasta === periodo.hasta;
  });

  const ir = (rango: { desde: string; hasta: string }) => iniciar(() => router.push(urlCon(base, { periodo: rango, sede })));

  return (
    <div className="periodos-elegir" aria-busy={cargando}>
      <label>
        <span className="sr-only">Un mes</span>
        <select
          className={`select periodo-select${mesActivo ? ' periodo--activo' : ''}`}
          value={mesActivo ?? ''}
          onChange={(e) => e.target.value && ir(rangoDelMes(e.target.value, hoy))}
        >
          <option value="">Mes…</option>
          {meses.map((m) => (
            <option key={m} value={m}>
              {nombreMes(m)}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span className="sr-only">Un año</span>
        <select
          className={`select periodo-select${anioActivo ? ' periodo--activo' : ''}`}
          value={anioActivo ?? ''}
          onChange={(e) => e.target.value && ir(rangoDelAnio(Number(e.target.value), hoy))}
        >
          <option value="">Año…</option>
          {anios.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
