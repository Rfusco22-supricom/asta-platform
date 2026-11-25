import Link from 'next/link';
import { DIAS_SIN_ASTA, type ClienteSemaforo, type ColorSemaforo, type Semaforo, type TamanoTienda } from '@asta/shared-types';
import { Cifra, type ColorCifra, type IconoCifra } from '@/components/Cifras';
import { nombrePeriodo } from '@/lib/meses';

/**
 * El semáforo de clientes (`semaforo.ts` en shared-types): a quién le vendemos
 * impresoras y no le vendemos su tóner ASTA. Lo mismo para el vendedor (su
 * cartera) y el administrador (la empresa, con el vendedor de cada cliente).
 *
 * Los filtros son enlaces (`?color=&tamano=`): la página es del servidor y un
 * filtro se puede compartir.
 */

const n = (x: number) => x.toLocaleString('es-VE', { maximumFractionDigits: 0 });

/** Filas como mucho: el resto se ve filtrando. */
const TOPE = 200;

export const LUZ: Record<ColorSemaforo, { texto: string; nota: string; cifra: { icono: IconoCifra; color: ColorCifra; tono?: 'alerta' | 'atencion' } }> = {
  ROJO: { texto: 'Rojo', nota: 'compra impresoras y ningún ASTA para ellas', cifra: { icono: 'alerta', color: 'rosa', tono: 'alerta' } },
  AMARILLO: { texto: 'Amarillo', nota: 'compra ASTA para parte de sus impresoras', cifra: { icono: 'reloj', color: 'ambar', tono: 'atencion' } },
  VERDE: { texto: 'Verde', nota: 'compra ASTA para todas sus impresoras', cifra: { icono: 'check', color: 'verde' } },
};

const TAMANO: Record<TamanoTienda, string> = { GRANDE: 'Grande', MEDIANA: 'Mediana', PEQUENA: 'Pequeña' };

/**
 * Lo que hay que ofrecerle: los tóners ASTA de sus impresoras sin cubrir. Si
 * las tiene todas cubiertas pero dejó de comprar (`enfriado`), los que compraba:
 * es reponer.
 */
export function queOfrecer(c: ClienteSemaforo): Array<{ sku: string; impresora: string }> {
  const vistos = new Map<string, string>();
  const reponer = c.enfriado && c.detalle.every((i) => i.toners.length === 0 || i.cubierta);
  for (const i of c.detalle) {
    if (i.cubierta && !reponer) continue;
    for (const t of i.toners) {
      if (reponer && !t.comprado) continue;
      const sku = t.sku ?? t.nombre;
      if (!vistos.has(sku)) vistos.set(sku, i.nombre);
    }
  }
  return [...vistos.entries()].map(([sku, impresora]) => ({ sku, impresora }));
}

function enlace(base: string, color: ColorSemaforo | null, tamano: TamanoTienda | null, sede: number | null): string {
  const qs = new URLSearchParams();
  if (color) qs.set('color', color);
  if (tamano) qs.set('tamano', tamano);
  if (sede !== null) qs.set('sede', String(sede));
  const s = qs.toString();
  return s ? `${base}?${s}` : base;
}

/** «hace 45 días», «hace 5 meses», o sin compras en el periodo. */
function haceCuanto(dias: number | null): string {
  if (dias === null) return 'ninguna en 12 meses';
  if (dias <= 1) return dias === 1 ? 'ayer' : 'hoy';
  if (dias < 60) return `hace ${dias} días`;
  return `hace ${Math.round(dias / 30)} meses`;
}

export function leerFiltros(params: Record<string, string | string[] | undefined>): { color: ColorSemaforo | null; tamano: TamanoTienda | null } {
  const color = typeof params.color === 'string' && params.color in LUZ ? (params.color as ColorSemaforo) : null;
  const tamano = typeof params.tamano === 'string' && params.tamano in TAMANO ? (params.tamano as TamanoTienda) : null;
  return { color, tamano };
}

export function TablaSemaforo({
  datos: d,
  base,
  color,
  tamano,
  sede = null,
  conVendedor,
}: {
  datos: Semaforo;
  base: string;
  color: ColorSemaforo | null;
  tamano: TamanoTienda | null;
  sede?: number | null;
  conVendedor: boolean;
}) {
  const filtrados = d.clientes.filter((c) => (!color || c.color === color) && (!tamano || c.tamano === tamano));
  const periodo = nombrePeriodo(d.desde, d.hasta);
  const total = d.totales.ROJO + d.totales.AMARILLO + d.totales.VERDE;

  return (
    <>
      <section className="stats semaforo-cifras" aria-label="Clientes por color">
        {(['ROJO', 'AMARILLO', 'VERDE'] as const).map((k) => (
          <Link key={k} href={enlace(base, color === k ? null : k, tamano, sede)} className={`semaforo-cifra semaforo-${k.toLowerCase()}${color === k ? ' activa' : ''}`}>
            <Cifra {...LUZ[k].cifra} etiqueta={LUZ[k].texto} valor={n(d.totales[k])} nota={LUZ[k].nota} />
          </Link>
        ))}
      </section>
      <p className="panel-nota">
        {n(total)} clientes que nos compraron impresoras con tóner ASTA en {periodo} ({n(d.totales.impresoras)} impresoras). Una impresora está cubierta si el
        cliente compró alguno de sus tóners ASTA en ese tiempo. Si lleva más de {DIAS_SIN_ASTA} días sin comprar ASTA, baja un color. El tamaño de la tienda es por lo que nos compra frente a los demás clientes. Pulsa un color
        para filtrar.
      </p>

      <nav className="pestanas-reporte" aria-label="Tamaño de la tienda">
        <Link href={enlace(base, color, null, sede)} className={tamano === null ? 'activa' : undefined}>
          Todas
        </Link>
        {(['GRANDE', 'MEDIANA', 'PEQUENA'] as const).map((t) => (
          <Link key={t} href={enlace(base, color, t, sede)} className={tamano === t ? 'activa' : undefined}>
            {TAMANO[t]}
          </Link>
        ))}
      </nav>

      <section className="panel">
        {filtrados.length === 0 ? (
          <div className="empty">Ningún cliente con estos filtros.</div>
        ) : (
          <div className="table-wrap" style={{ border: 0 }}>
            <table className="semaforo-tabla">
              <thead>
                <tr>
                  <th aria-label="Color" />
                  <th>Cliente</th>
                  <th>Tienda</th>
                  <th>Impresoras</th>
                  <th>Último ASTA</th>
                  <th>Qué ofrecerle de ASTA</th>
                </tr>
              </thead>
              <tbody>
                {filtrados.slice(0, TOPE).map((c) => {
                  const ofrecer = queOfrecer(c);
                  return (
                    <tr key={c.partnerId}>
                      <td>
                        <span className={`semaforo-luz semaforo-${c.color.toLowerCase()}`} title={LUZ[c.color].nota} aria-label={LUZ[c.color].texto} />
                      </td>
                      <td>
                        <Link href={`/cartera/${c.partnerId}`} className="cliente-nombre enlace-ficha" data-privado>
                          {c.nombre}
                        </Link>
                        {conVendedor && <span className="cliente-contacto" data-privado>{c.vendedor ?? 'Sin vendedor'}</span>}
                      </td>
                      <td>
                        <span className="tag">{TAMANO[c.tamano]}</span>
                      </td>
                      <td>
                        <details className="semaforo-detalle">
                          <summary>
                            {n(c.impresoras)} · {c.cubiertas} de {c.conAsta} {c.conAsta === 1 ? 'modelo cubierto' : 'modelos cubiertos'}
                          </summary>
                          <ul>
                            {c.detalle.map((i, k) => (
                              <li key={k}>
                                <strong>{i.nombre}</strong> <span className="stat-sub">× {n(i.unidades)}</span>
                                {i.toners.length === 0 ? (
                                  <span className="stat-sub"> — sin tóner ASTA</span>
                                ) : (
                                  <span className="semaforo-toners">
                                    {i.toners.map((t) => (
                                      <span key={t.odooProductTmplId} className={t.comprado ? 'comprado' : undefined} title={t.nombre}>
                                        {t.comprado ? '✓ ' : ''}
                                        {t.sku ?? t.nombre}
                                      </span>
                                    ))}
                                  </span>
                                )}
                              </li>
                            ))}
                          </ul>
                        </details>
                      </td>
                      <td className={c.enfriado ? 'semaforo-frio' : undefined}>
                        <span className="semaforo-hace">{haceCuanto(c.diasSinAsta)}</span>
                        {c.enfriado && <small>dejó de comprar: bajó a {LUZ[c.color].texto.toLowerCase()}</small>}
                      </td>
                      <td>
                        {ofrecer.length === 0 ? (
                          <span className="stat-sub">Ya compra ASTA para todas</span>
                        ) : (
                          <ul className="semaforo-ofrecer">
                            {ofrecer.slice(0, 4).map((o) => (
                              <li key={o.sku}>
                                <strong>{o.sku}</strong> <span className="stat-sub">{c.enfriado && c.cubiertas === c.conAsta ? 'reponer, ' : ''}para {o.impresora}</span>
                              </li>
                            ))}
                            {ofrecer.length > 4 && <li className="stat-sub">y {ofrecer.length - 4} más</li>}
                          </ul>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filtrados.length > TOPE && (
              <p className="panel-nota">
                Se ven los primeros {TOPE} de {n(filtrados.length)}. Filtra por color o tamaño para ver el resto.
              </p>
            )}
          </div>
        )}
      </section>
    </>
  );
}
