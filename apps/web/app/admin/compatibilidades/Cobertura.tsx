import Link from 'next/link';
import type { CoberturaTop } from '@asta/shared-types';
import { money } from '@/lib/formato';

/**
 * Cuánto del top de ventas puede recomendar ya el kiosco (#56, Fase 4).
 *
 * Es la cifra que decide si la Fase 5 sale, y aquí sirve para lo de todos los
 * días: decirle a quien revisa **por dónde seguir y cuándo parar**. Revisar
 * 1117 propuestas sin saber cuáles mueven la aguja es lo que hace que nadie
 * empiece.
 *
 * Cada producto que falta dice QUÉ le falta y enlaza a la pestaña donde se
 * arregla: el cartucho en Productos, la impresora en Impresoras.
 */

const TRAMOS = {
  procede: { texto: 'El kiosco puede salir como estaba planeado', color: 'var(--positive)' },
  con_respaldo: { texto: 'Sale con flujo de respaldo: «no encontramos tu modelo, deja tus datos»', color: 'var(--warning)' },
  pospuesta: { texto: 'Por debajo del 60 %: el kiosco sigue pospuesto', color: 'var(--danger)' },
} as const;

const FALTA = {
  sin_cartucho: { texto: 'falta validar su cartucho', tab: '/admin/compatibilidades' },
  sin_impresora: { texto: 'falta decir qué impresora lo usa', tab: '/admin/compatibilidades/impresoras' },
  completo: { texto: '', tab: '' },
} as const;

/**
 * Qué lleva el enlace de cada fila.
 *
 * Con `sin_impresora`, el CÓDIGO DEL CARTUCHO, y no como búsqueda sino para el
 * formulario de alta: ese cartucho no tiene ninguna impresora todavía, así que
 * buscarlo en la lista no devuelve nada. Con `sin_cartucho`, la referencia del
 * producto, que allí sí se busca.
 */
function busqueda(p: CoberturaTop['productos'][number]): string {
  if (p.estado === 'sin_impresora') return p.cartuchos[0] ?? p.sku ?? p.nombre ?? '';
  return p.sku ?? p.nombre ?? '';
}

export function Cobertura({ datos }: { datos: CoberturaTop }) {
  const { totales, productos } = datos;
  if (totales.top === 0) return null;

  const tramo = TRAMOS[totales.tramo];
  const faltan = productos.filter((p) => p.estado !== 'completo');

  return (
    <section className="panel cobertura">
      <h2>Cobertura del top {totales.top} de ventas</h2>
      <div className="cobertura-cabecera">
        <div>
          <div className="cobertura-pct" style={{ color: tramo.color }}>
            {totales.porcentaje} %
          </div>
          <div className="stat-sub">
            {totales.completos} de {totales.top} con la cadena completa: impresora → cartucho → producto
          </div>
        </div>
        <div className="cobertura-nota">
          <p style={{ color: tramo.color, fontWeight: 560 }}>{tramo.texto}</p>
          <p className="stat-sub">
            {money(totales.importeCubierto)} de {money(totales.importeTop)} facturados en 12 meses ya se pueden recomendar. El umbral lo fija
            el issue #7: más del 85 % procede, entre 60 y 85 % con respaldo.
          </p>
        </div>
      </div>

      {faltan.length > 0 && (
        <div className="table-wrap">
          <table className="tabla-cobertura">
            <thead>
              <tr>
                <th>Producto que falta</th>
                <th className="num">12 meses</th>
                <th>Qué le falta</th>
              </tr>
            </thead>
            <tbody>
              {faltan.map((p) => (
                <tr key={p.templateId}>
                  <td>
                    {p.nombre ?? <em>plantilla {p.templateId}</em>}
                    {p.sku && <div className="sku">{p.sku}</div>}
                  </td>
                  <td className="num">{money(p.ventas12m)}</td>
                  <td>
                    {/*
                      El enlace lleva ya buscado, a la pestaña donde se arregla. Y con
                      lo que allí se busca: en Impresoras, el CÓDIGO DEL CARTUCHO —la
                      referencia del producto no encuentra nada—; en Productos, la
                      referencia.
                    */}
                    <Link href={`${FALTA[p.estado].tab}?${p.estado === 'sin_impresora' ? 'cartucho' : 'q'}=${encodeURIComponent(busqueda(p))}`}>
                      {FALTA[p.estado].texto}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
