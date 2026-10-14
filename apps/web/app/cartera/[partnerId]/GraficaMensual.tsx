import type { MonthlyPoint } from '@asta/shared-types';
import { money, moneyCompact } from '@/lib/formato';

/**
 * Serie mensual de facturación.
 *
 * SVG renderizado en el servidor, sin librería de gráficas y sin un byte de
 * JavaScript en el cliente. Una librería aportaría animaciones y tooltips que
 * aquí no hacen falta, a cambio de ~50 KB y un componente cliente más.
 *
 * Accesibilidad: cada barra lleva un `<title>` (tooltip nativo del navegador) y
 * debajo hay una tabla con los mismos números. Una gráfica que solo se entiende
 * mirándola deja fuera a quien usa lector de pantalla, y además aquí el número
 * exacto importa: es dinero.
 */

const ALTO = 150;
const ANCHO_BARRA = 46;
const HUECO = 10;
const MARGEN_SUP = 28;
/** Lo que sale el bloque hacia atrás: la cara de arriba y la del lado (relieve). */
const FONDO = 6;

export function GraficaMensual({ puntos }: { puntos: MonthlyPoint[] }) {
  if (puntos.length === 0) {
    return (
      <div className="empty" style={{ padding: '32px 20px' }}>
        Sin ventas de ASTA en el periodo seleccionado.
      </div>
    );
  }

  const max = Math.max(...puntos.map((p) => p.monto), 0);
  const ancho = puntos.length * (ANCHO_BARRA + HUECO) + FONDO;
  const altoTotal = ALTO + MARGEN_SUP + 34;

  return (
    <>
      <div className="chart-scroll">
        <svg
          viewBox={`0 0 ${ancho} ${altoTotal}`}
          width={ancho}
          height={altoTotal}
          role="img"
          aria-label={`Facturación mensual: ${puntos.length} periodos, máximo ${money(max)}`}
        >
          {/* Las caras de cada barra: la de delante en degradado, la de arriba
              más clara y la del lado más oscura. El mes mayor, en violeta. */}
          <defs>
            <linearGradient id="gm-frente" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#4f86f7" />
              <stop offset="1" stopColor="#27a9f1" />
            </linearGradient>
            <linearGradient id="gm-maximo" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#7c5cff" />
              <stop offset="1" stopColor="#4f86f7" />
            </linearGradient>
          </defs>

          {/* Línea base: sin ella las barras flotan y cuesta comparar alturas. */}
          <line
            x1="0"
            y1={MARGEN_SUP + ALTO + 0.5}
            x2={ancho}
            y2={MARGEN_SUP + ALTO + 0.5}
            stroke="var(--border-strong)"
            strokeWidth="1"
          />

          {puntos.map((p, i) => {
            // Altura mínima de 2px: un mes con importe pequeño pero no nulo debe
            // verse. Una barra de 0px se confunde con "no hubo facturación".
            const alto = max > 0 ? Math.max(2, (p.monto / max) * ALTO) : 0;
            const x = i * (ANCHO_BARRA + HUECO);
            const y = MARGEN_SUP + ALTO - alto;
            const esMax = p.monto === max && max > 0;

            return (
              <g key={p.periodo}>
                {/* Un ÚNICO hijo de texto: React da a <title> un trato
                    especial y con varios nodos el HTML del servidor y el del
                    cliente no coinciden, lo que rompe la hidratación. */}
                <title>{`${p.periodo}: ${money(p.monto)} en ${p.facturas} ${
                  p.facturas === 1 ? 'factura' : 'facturas'
                }`}</title>

                <g opacity={esMax ? 1 : 0.62}>
                  <rect x={x} y={y} width={ANCHO_BARRA} height={alto} fill={esMax ? 'url(#gm-maximo)' : 'url(#gm-frente)'} />
                  {alto > 0 && (
                    <>
                      <polygon
                        points={`${x},${y} ${x + ANCHO_BARRA},${y} ${x + ANCHO_BARRA + FONDO},${y - FONDO} ${x + FONDO},${y - FONDO}`}
                        fill={esMax ? '#b9adff' : '#9ad8ff'}
                      />
                      <polygon
                        points={`${x + ANCHO_BARRA},${y} ${x + ANCHO_BARRA + FONDO},${y - FONDO} ${x + ANCHO_BARRA + FONDO},${y + alto - FONDO} ${x + ANCHO_BARRA},${y + alto}`}
                        fill={esMax ? '#5a3fd0' : '#2f5fc7'}
                      />
                    </>
                  )}
                </g>

                <text
                  x={x + ANCHO_BARRA / 2}
                  y={y - FONDO - 6}
                  textAnchor="middle"
                  fontSize="10.5"
                  fill="var(--text-2)"
                  fontWeight="600"
                >
                  {moneyCompact(p.monto)}
                </text>

                {/* Solo el mes y el año en dos cifras: "julio 2026" no cabe. */}
                <text
                  x={x + ANCHO_BARRA / 2}
                  y={MARGEN_SUP + ALTO + 15}
                  textAnchor="middle"
                  fontSize="10"
                  fill="var(--text-3)"
                >
                  {abreviar(p.periodo)}
                </text>
                <text
                  x={x + ANCHO_BARRA / 2}
                  y={MARGEN_SUP + ALTO + 27}
                  textAnchor="middle"
                  fontSize="9.5"
                  fill="var(--text-3)"
                >
                  {p.facturas} fact.
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Los mismos datos en texto: para lectores de pantalla y para quien
          necesite el importe exacto sin pasar el ratón por encima. */}
      <details className="chart-table">
        <summary>Ver la serie en números</summary>
        <table>
          <thead>
            <tr>
              <th>Periodo</th>
              <th className="num">Facturado</th>
              <th className="num">Facturas</th>
            </tr>
          </thead>
          <tbody>
            {puntos.map((p) => (
              <tr key={p.periodo}>
                <td>{p.periodo}</td>
                <td className="num">{money(p.monto)}</td>
                <td className="num">{p.facturas}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </>
  );
}

/** "julio 2026" -> "jul 26". Odoo devuelve el periodo ya localizado. */
function abreviar(periodo: string): string {
  const partes = periodo.trim().split(/\s+/);
  if (partes.length < 2) return periodo;
  const [mes, anio] = partes;
  return `${mes.slice(0, 3)} ${anio.slice(-2)}`;
}
