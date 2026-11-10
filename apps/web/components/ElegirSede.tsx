'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { SEDES, type SedeId } from '@asta/shared-types';
import { empezarCarga } from './CargaGlobal';
import { urlCon } from '@/lib/periodos';

/** El desplegable de sede de `Sedes`: todas, o una compañía de Odoo. */
export function ElegirSede({ base, sede, periodo }: { base: string; sede: SedeId | null; periodo?: { desde: string; hasta: string } }) {
  const router = useRouter();
  const [cargando, iniciar] = useTransition();
  return (
    <label className="filtro-select" aria-busy={cargando}>
      <span className="sr-only">Sede</span>
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
        <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" />
        <circle cx="12" cy="10" r="2.3" />
      </svg>
      <select
        className="select"
        value={sede === null ? '' : String(sede)}
        onChange={(e) => {
          const id = e.target.value ? (Number(e.target.value) as SedeId) : null;
          empezarCarga();
          iniciar(() => router.push(urlCon(base, { periodo, sede: id })));
        }}
      >
        <option value="">Todas las sedes</option>
        {SEDES.map((s) => (
          <option key={s.id} value={s.id}>
            {s.nombre}
          </option>
        ))}
      </select>
    </label>
  );
}
