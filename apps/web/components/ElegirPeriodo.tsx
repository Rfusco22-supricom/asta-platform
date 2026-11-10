'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import type { SedeId } from '@asta/shared-types';
import { nombreMes, nombrePeriodo, rangoDelAnio, rangoDelMes, ultimosMeses } from '@/lib/meses';
import { PRESETS, fechasDe, urlCon } from '@/lib/periodos';
import { empezarCarga } from './CargaGlobal';

/**
 * El desplegable de periodo de `Periodos`: los atajos, los últimos meses y los
 * últimos años, en uno. Lleva las FECHAS a la URL: el enlace dice siempre lo
 * mismo.
 */

const MESES = 24;
const ANIOS = 3;

export function ElegirPeriodo({ base, periodo, sede }: { base: string; periodo: { desde: string; hasta: string }; sede: SedeId | null }) {
  const router = useRouter();
  const [cargando, iniciar] = useTransition();
  const hoy = new Date();
  const opciones = [
    ...PRESETS.map((p) => ({ valor: `p:${p.clave}`, etiqueta: p.etiqueta, rango: fechasDe(p.clave, hoy), grupo: 'atajo' as const })),
    ...ultimosMeses(MESES, hoy).map((m) => ({ valor: `m:${m}`, etiqueta: nombreMes(m), rango: rangoDelMes(m, hoy), grupo: 'mes' as const })),
    ...Array.from({ length: ANIOS }, (_, i) => hoy.getUTCFullYear() - i).map((a) => ({ valor: `a:${a}`, etiqueta: String(a), rango: rangoDelAnio(a, hoy), grupo: 'anio' as const })),
  ];
  // La opción puesta: la primera que da exactamente estas fechas (un atajo antes que un año).
  const activa = opciones.find((o) => o.rango.desde === periodo.desde && o.rango.hasta === periodo.hasta);

  const ir = (valor: string) => {
    const o = opciones.find((x) => x.valor === valor);
    if (!o) return;
    empezarCarga();
    iniciar(() => router.push(urlCon(base, { periodo: o.rango, sede })));
  };

  const grupo = (g: 'atajo' | 'mes' | 'anio') =>
    opciones
      .filter((o) => o.grupo === g)
      .map((o) => (
        <option key={o.valor} value={o.valor}>
          {o.etiqueta}
        </option>
      ));

  return (
    <label className="filtro-select" aria-busy={cargando}>
      <span className="sr-only">Periodo</span>
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
        <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
        <path d="M3.5 10h17M8 3v4M16 3v4" />
      </svg>
      <select className="select" value={activa?.valor ?? ''} onChange={(e) => ir(e.target.value)}>
        {!activa && (
          <option value="" disabled>
            {nombrePeriodo(periodo.desde, periodo.hasta)}
          </option>
        )}
        <optgroup label="Periodo">{grupo('atajo')}</optgroup>
        <optgroup label="Un mes">{grupo('mes')}</optgroup>
        <optgroup label="Un año">{grupo('anio')}</optgroup>
      </select>
    </label>
  );
}
