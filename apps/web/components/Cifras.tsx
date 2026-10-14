/**
 * Las cifras de resumen de cada pantalla: una baldosa con su icono, el rótulo,
 * el número grande y una nota debajo. Opcionalmente, la tendencia de los meses.
 *
 * Eran `<div className="stat">` copiados en cada página, cada uno con su forma.
 * Ahora es un componente: el icono y el color dicen de qué va la cifra antes de
 * leerla, y todas las pantallas las enseñan igual. Es de servidor: no lleva
 * JavaScript al navegador.
 */

export type ColorCifra = 'cian' | 'violeta' | 'rosa' | 'verde' | 'ambar';

/** Iconos de trazo, del mismo dibujo que el menú (`NavLateral`). */
const ICONOS = {
  ventas: <path d="M3 17l6-6 4 4 8-8M15 7h6v6" />,
  mes: (
    <>
      <rect x="4" y="5" width="16" height="15" rx="3" />
      <path d="M4 10h16M9 3v4M15 3v4" />
    </>
  ),
  cuota: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4v8l5.5 5.5" />
    </>
  ),
  clientes: (
    <>
      <path d="M16 19v-1.5a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V19" />
      <circle cx="9" cy="7" r="3.2" />
      <path d="M22 19v-1.5a4 4 0 0 0-3-3.87M16.5 4.2a4 4 0 0 1 0 7.6" />
    </>
  ),
  cobrar: (
    <>
      <rect x="2.5" y="6" width="19" height="13" rx="2.5" />
      <path d="M2.5 10.5h19M7 15h3" />
    </>
  ),
  idea: (
    <>
      <path d="M9 18h6M10 21h4" />
      <path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3Z" />
    </>
  ),
  juego: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M14.5 9.2c-.5-.8-1.4-1.2-2.5-1.2-1.4 0-2.5.8-2.5 2s1.1 1.7 2.5 2 2.5.8 2.5 2-1.1 2-2.5 2c-1.1 0-2-.4-2.5-1.2M12 6.5V8M12 16v1.5" />
    </>
  ),
  corona: <path d="M4 18h16M5 15 3.5 7l5 3.5L12 5l3.5 5.5 5-3.5L19 15Z" />,
  ticket: (
    <>
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2Z" />
      <path d="M9 8h6M9 12h6" />
    </>
  ),
  caja: (
    <>
      <path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5Z" />
      <path d="M4 7.5 12 12l8-4.5M12 12v9" />
    </>
  ),
  diana: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="1" />
    </>
  ),
  busqueda: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M15.8 15.8 21 21" />
    </>
  ),
  clic: <path d="M9 3v2M4.6 4.6 6 6M3 9h2M10 10l10 4-4.5 1.5L14 20Z" />,
  alerta: (
    <>
      <path d="M12 4 2.8 19.5h18.4Z" />
      <path d="M12 10v4.5M12 17.2v.1" />
    </>
  ),
  check: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m8.3 12.2 2.5 2.5 4.9-5" />
    </>
  ),
  cruz: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m9.2 9.2 5.6 5.6M14.8 9.2l-5.6 5.6" />
    </>
  ),
  reloj: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  llave: (
    <>
      <circle cx="7.5" cy="12" r="3.5" />
      <path d="M11 12h10M18 12v3M15 12v2" />
    </>
  ),
  candado: (
    <>
      <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5M12 14.5v2" />
    </>
  ),
  copias: (
    <>
      <rect x="3" y="7" width="12" height="12" rx="2" />
      <path d="M8 4h11a2 2 0 0 1 2 2v11" />
    </>
  ),
  sincronizar: (
    <>
      <path d="M20 11a8 8 0 0 0-14.3-4.6L4 8.5M4 13a8 8 0 0 0 14.3 4.6L20 15.5" />
      <path d="M4 4v4.5h4.5M20 20v-4.5h-4.5" />
    </>
  ),
  tablet: (
    <>
      <rect x="5" y="3" width="14" height="15" rx="2" />
      <path d="M11 15h2M9 21h6M12 18v3" />
    </>
  ),
} as const;

export type IconoCifra = keyof typeof ICONOS;

/**
 * La forma de los meses, como línea con su área: sin ejes ni números. El valor
 * exacto de cada mes está en la gráfica de la pantalla.
 */
export function Tendencia({ valores }: { valores: number[] }) {
  if (valores.length < 2) return null;
  const max = Math.max(...valores, 1);
  const puntos = valores.map((v, i) => `${((i / (valores.length - 1)) * 100).toFixed(2)},${(30 - (v / max) * 26).toFixed(2)}`);
  return (
    <svg className="cifra-tendencia" viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true">
      <polygon points={`0,32 ${puntos.join(' ')} 100,32`} />
      <polyline points={puntos.join(' ')} />
    </svg>
  );
}

export function Cifra({
  icono,
  color = 'cian',
  etiqueta,
  valor,
  nota,
  tono,
  pequena = false,
  tendencia,
  className,
}: {
  icono: IconoCifra;
  color?: ColorCifra;
  etiqueta: React.ReactNode;
  valor: React.ReactNode;
  nota?: React.ReactNode;
  /** El color del número: sube (verde), atención (ámbar), baja o alerta (rojo). */
  tono?: 'sube' | 'baja' | 'alerta' | 'atencion';
  /** Número más pequeño, para importes largos con decimales. */
  pequena?: boolean;
  tendencia?: number[];
  className?: string;
}) {
  return (
    <div className={`stat cifra cifra-${color}${className ? ` ${className}` : ''}`}>
      <span className="cifra-icono" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          {ICONOS[icono]}
        </svg>
      </span>
      <div className="stat-label">{etiqueta}</div>
      <div className={`stat-value${pequena ? ' small' : ''}${tono ? ` cifra-${tono}` : ''}`}>{valor}</div>
      {nota && <div className="stat-sub">{nota}</div>}
      {tendencia && <Tendencia valores={tendencia} />}
    </div>
  );
}
