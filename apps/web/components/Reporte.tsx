import Link from 'next/link';
import type { Reporte } from '@/lib/api';
import { Periodos } from '@/components/Periodos';
import { Sedes } from '@/components/Sedes';
import type { SedeId } from '@asta/shared-types';
import { money, moneyCompact } from '@/lib/formato';
import { Cifra, type ColorCifra, type IconoCifra } from './Cifras';
import { Serie } from './SerieMeses';

/**
 * El reporte, dibujado.
 *
 * Un solo componente para las dos pantallas —administración y vendedor— porque
 * el dato tiene la misma forma. Lo que NO se comparte es de dónde sale: son dos
 * endpoints con dos permisos, y la del vendedor recibe `porVendedor: null`
 * porque esa ruta no calcula ese corte. Aquí solo se comprueba si viene.
 *
 * ── Sin exportar a Excel, a propósito ────────────────────────────────────────
 *
 * Se preguntó y la respuesta fue «en pantalla». Un botón de descarga convierte
 * el panel en un generador de ficheros que alguien reenvía por correo y que
 * empiezan a circular desactualizados; mientras el número viva solo aquí, el que
 * se mira es el de hoy.
 */

function Metrica({
  etiqueta,
  valor,
  nota,
  tono,
  icono,
  color,
}: {
  etiqueta: string;
  valor: string;
  nota?: string;
  tono?: 'mal' | 'bien';
  icono: IconoCifra;
  color?: ColorCifra;
}) {
  // La misma cifra que el resto del panel (`Cifra`), para que estas tarjetas no
  // sean «casi» iguales a las de las otras pantallas.
  return <Cifra icono={icono} color={color} etiqueta={etiqueta} valor={valor} nota={nota} tono={tono === 'mal' ? 'alerta' : tono === 'bien' ? 'sube' : undefined} />;
}

export { etiquetaMes } from '@/lib/meses';

/**
 * El importe con una barra detrás, proporcional al mayor de la tabla: se ve de
 * un vistazo quién pesa cuánto sin tener que comparar cifras de seis dígitos.
 */
export function Proporcion({ valor, maximo }: { valor: number; maximo: number }) {
  const ancho = maximo > 0 ? Math.max(0, Math.min(100, (valor / maximo) * 100)) : 0;
  return (
    <span className="proporcion">
      <span className="proporcion-barra" aria-hidden="true">
        <span style={{ width: `${ancho}%` }} />
      </span>
      {money(valor)}
    </span>
  );
}

export { Serie } from './SerieMeses';

/**
 * `soloAsta`: la vista del vendedor, que cuenta solo lo vendido de ASTA, sin IVA
 * (ver `reporteAsta.service.ts`). Cambian los rótulos, no la forma: el saldo es
 * el de las facturas que llevan ASTA, así que no se da como «% de lo facturado»,
 * que mezclaría la factura entera con su parte ASTA.
 *
 * Con `soloAsta` también entra Smartbit, lo de antes de abril de 2026: en una
 * compra de Smartbit (un cliente en un día) cuenta como factura.
 */
export function VistaReporte({
  datos,
  base,
  soloAsta = false,
  sede,
}: {
  datos: Reporte;
  base: string;
  soloAsta?: boolean;
  /** Solo en la vista del administrador: pinta el selector de sede (ver `Sedes`). */
  sede?: SedeId | null;
}) {
  const { totales, asta } = datos;
  const pctDeuda = totales.facturado > 0 ? (totales.porCobrar / totales.facturado) * 100 : 0;
  const hayAlgo = totales.facturas > 0;
  const maxVendedor = Math.max(0, ...(datos.porVendedor ?? []).map((v) => v.facturado));
  const maxCliente = Math.max(0, ...datos.topClientes.map((c) => c.facturado));
  const t = soloAsta
    ? {
        vacio: 'No hay ventas de ASTA en este periodo',
        vacioTexto: 'ninguna factura con productos ASTA',
        facturado: 'Vendido en ASTA',
        facturas: `${totales.facturas.toLocaleString('es-VE')} facturas con ASTA · sin IVA`,
        fuente: 'Odoo y Smartbit (antes de abril de 2026)',
        deuda: 'en las facturas con ASTA',
        ticket: 'de ASTA por factura',
        clientes: 'con al menos una compra de ASTA',
        serie: 'ASTA mes a mes',
        top: 'Los que más compran ASTA',
        columna: 'ASTA',
      }
    : {
        vacio: 'No hay facturas en este periodo',
        vacioTexto: 'ninguna factura contabilizada',
        facturado: 'Facturado',
        facturas: `${totales.facturas.toLocaleString('es-VE')} facturas`,
        fuente: 'Odoo',
        deuda: `${pctDeuda.toFixed(0)} % de lo facturado`,
        ticket: 'por factura',
        clientes: 'con al menos una factura',
        serie: 'Facturación mes a mes',
        top: 'Los que más facturaron',
        columna: 'Facturado',
      };

  return (
    <>
      {sede !== undefined && <Sedes base={base} sede={sede} periodo={datos.periodo} />}
      <Periodos base={base} periodo={datos.periodo} sede={sede ?? null} />

      {!hayAlgo ? (
        <div className="notice">
          <h2>{t.vacio}</h2>
          <p>
            Entre el {datos.periodo.desde} y el {datos.periodo.hasta} no hay {t.vacioTexto}. Prueba con un rango más
            amplio.
          </p>
        </div>
      ) : (
        <>
          <section className="stats">
            <Metrica
              icono="ventas"
              etiqueta={t.facturado}
              valor={moneyCompact(totales.facturado)}
              nota={t.facturas}
            />
            <Metrica
              icono="cobrar"
              color="ambar"
              etiqueta="Por cobrar"
              valor={moneyCompact(totales.porCobrar)}
              nota={t.deuda}
              tono={!soloAsta && pctDeuda >= 30 ? 'mal' : undefined}
            />
            <Metrica
              icono="ticket"
              color="violeta"
              etiqueta="Ticket promedio"
              valor={moneyCompact(totales.ticketPromedio)}
              nota={t.ticket}
            />
            <Metrica
              icono="clientes"
              color="verde"
              etiqueta="Clientes que compraron"
              valor={totales.clientes.toLocaleString('es-VE')}
              nota={t.clientes}
            />
          </section>

          <section className="panel">
            <h2>{t.serie}</h2>
            <Serie puntos={datos.serieMensual} sede={sede ?? null} />
          </section>

          <section className="panel">
            <h2>ASTA frente a las demás marcas</h2>
            <p className="panel-nota">
              Solo consumibles: las categorías donde ASTA tiene producto. Fuera de ellas no hay
              nada que comparar.
              {soloAsta &&
                ' Lo de otras marcas es lo que todavía se le puede pasar a ASTA. Solo con lo facturado en Odoo, desde abril de 2026: Smartbit trae ASTA, pero no las otras marcas.'}
            </p>
            {asta.asta + asta.competencia === 0 ? (
              <div className="empty" style={{ padding: '20px' }}>
                Sin consumibles facturados en Odoo en este periodo: no hay cuota que medir.
              </div>
            ) : (
              <div className="cuota">
                <div className="cuota-barra">
                  <div className="cuota-asta" style={{ width: `${asta.cuota}%` }} />
                </div>
                <div className="cuota-pie">
                  <span>
                    <strong>{asta.cuota.toFixed(1)} %</strong> ASTA · {money(asta.asta)}
                  </span>
                  <span className="cuota-otros">
                    {(100 - asta.cuota).toFixed(1)} % otras marcas · {money(asta.competencia)}
                  </span>
                </div>
              </div>
            )}
          </section>

          {datos.porVendedor && datos.porVendedor.length > 0 && (
            <section className="panel">
              <h2>Por vendedor</h2>
              {soloAsta && (
                <p className="panel-nota">
                  Lo de Odoo, por el comercial asignado a cada cliente; lo de Smartbit (antes de abril de 2026), por quien hizo
                  la venta. Los vendedores de Smartbit sin usuario en Odoo salen con su nombre.
                </p>
              )}
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Vendedor</th>
                      <th className="num">{t.columna}</th>
                      <th className="num">Por cobrar</th>
                      <th className="num">Facturas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {datos.porVendedor.map((v) => (
                      <tr key={v.odooUserId ?? v.nombre}>
                        <td>{v.nombre}</td>
                        <td className="num">
                          <Proporcion valor={v.facturado} maximo={maxVendedor} />
                        </td>
                        <td className="num">{money(v.porCobrar)}</td>
                        <td className="num">{v.facturas}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className="panel">
            <h2>{t.top}</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th className="num">{t.columna}</th>
                    <th className="num">Facturas</th>
                  </tr>
                </thead>
                <tbody>
                  {datos.topClientes.map((c) => (
                    <tr key={c.partnerId ?? c.nombre}>
                      <td>{c.partnerId ? <Link href={`/cartera/${c.partnerId}`}>{c.nombre}</Link> : c.nombre}</td>
                      <td className="num">
                        <Proporcion valor={c.facturado} maximo={maxCliente} />
                      </td>
                      <td className="num">{c.facturas}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {/*
        El criterio, escrito donde se lee el número (#26): lo que no puede pasar
        es que el panel dé una cifra distinta del ERP y nadie sepa por qué.
      */}
      <p className="pie-criterio">
        Solo facturas contabilizadas
        {datos.criterio.incluyeNotasDeCredito
          ? ', restando las notas de crédito'
          : ', sin restar notas de crédito'}
        . Leído de {t.fuente} en {(datos.duracionMs / 1000).toFixed(1)} s.
      </p>
    </>
  );
}
