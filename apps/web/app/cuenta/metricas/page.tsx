import { requireSession } from '@/lib/session';
import { Marco } from '@/components/Marco';
import { Bienvenida } from '@/components/Bienvenida';
import { Cifra } from '@/components/Cifras';
import { Serie } from '@/components/SerieMeses';
import { Proporcion } from '@/components/Reporte';
import { ProgramaCliente } from '@/components/ProgramaCliente';
import { getMetricasCliente, ApiError, esRedireccion, ContractError } from '@/lib/api';
import { fecha, money, moneyCompact } from '@/lib/formato';
import type { MetricasCliente } from '@asta/shared-types';

/**
 * «Mis métricas»: la primera pantalla de un cliente (fase 1 del sell-out).
 *
 * Su nivel en el programa de ASTA y cómo va en el trimestre, sus compras de
 * ASTA de los últimos doce meses, qué compra y lo que se busca en sus tablets.
 * Cada bloque sale aunque otro no se haya podido leer.
 */

export const dynamic = 'force-dynamic';

const n = (x: number) => x.toLocaleString('es-VE');

function NoSePudo({ titulo }: { titulo: string }) {
  return (
    <section className="panel">
      <h2>{titulo}</h2>
      <div className="empty">No se pudo leer ahora.</div>
    </section>
  );
}

function Compras({ m }: { m: MetricasCliente }) {
  const c = m.compras;
  if (!c) return <NoSePudo titulo="Tus compras de ASTA" />;
  const serie = c.serieMensual ?? [];
  const ultimo = serie.length ? serie[serie.length - 1]! : null;
  return (
    <>
      <section className="stats">
        <Cifra icono="ventas" etiqueta="Compras de ASTA" valor={moneyCompact(c.totalFacturado)} nota={`${n(c.numeroFacturas)} ${c.numeroFacturas === 1 ? 'factura' : 'facturas'} · 12 meses`} tendencia={serie.map((p) => p.monto)} />
        {ultimo && <Cifra icono="mes" color="violeta" etiqueta="Este mes" valor={moneyCompact(ultimo.monto)} nota={`${n(ultimo.facturas)} ${ultimo.facturas === 1 ? 'factura' : 'facturas'}`} />}
        <Cifra icono="cobrar" color="ambar" etiqueta="Por pagar" nota="a hoy" valor={moneyCompact(c.porCobrar)} tono={c.porCobrar > 0 ? 'atencion' : undefined} />
        {m.perfil && (
          <Cifra
            icono="reloj"
            color="verde"
            etiqueta="Última compra"
            valor={m.perfil.diasSinComprar === null ? '—' : m.perfil.diasSinComprar === 0 ? 'Hoy' : `Hace ${n(m.perfil.diasSinComprar)} d`}
            nota={m.perfil.ultimaCompra ? fecha(m.perfil.ultimaCompra) : 'sin compras'}
          />
        )}
      </section>
      {serie.length > 0 && (
        <section className="panel">
          <h2>Mes a mes</h2>
          <Serie puntos={serie} detalle={false} />
        </section>
      )}
    </>
  );
}

function QueCompras({ m }: { m: MetricasCliente }) {
  if (!m.perfil) return <NoSePudo titulo="Qué compras" />;
  const top = m.perfil.topProductos;
  const maximo = Math.max(0, ...top.map((p) => p.monto));
  return (
    <section className="panel dash-ranking">
      <h2>Qué compras</h2>
      {top.length === 0 ? (
        <div className="empty">Sin compras de ASTA todavía.</div>
      ) : (
        <ol>
          {top.map((p, i) => (
            <li key={p.productId}>
              <span className="dash-pos">{i + 1}</span>
              <span className="dash-nombre">
                {p.nombre.replace(/^ASTA\s+/i, '')}
                <small>
                  {n(Math.round(p.cantidad))} u. · {money(p.monto)}
                </small>
              </span>
              <Proporcion valor={p.monto} maximo={maximo} />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Tablets({ m }: { m: MetricasCliente }) {
  const t = m.tablets;
  if (!t) return null;
  return (
    <section className="panel">
      <h2>En tus tablets</h2>
      <section className="stats">
        <Cifra icono="tablet" etiqueta="Búsquedas" valor={n(t.busquedas)} nota={`${n(t.cuantas)} ${t.cuantas === 1 ? 'tablet' : 'tablets'} · 12 meses`} pequena />
        <Cifra icono="cruz" color="ambar" etiqueta="Sin resultado" valor={n(t.sinResultado)} tono={t.sinResultado > 0 ? 'atencion' : undefined} pequena />
      </section>
      <div className="met-listas">
        <div>
          <h3>Impresoras más buscadas</h3>
          {t.impresoras.length === 0 ? (
            <div className="empty">Ninguna todavía.</div>
          ) : (
            <ol className="met-lista">
              {t.impresoras.map((i, k) => (
                <li key={k}>
                  <span>{[i.marca, i.nombre].filter(Boolean).join(' ')}</span>
                  <strong>{n(i.veces)}</strong>
                </li>
              ))}
            </ol>
          )}
        </div>
        <div>
          <h3>Sin encontrar</h3>
          {t.sinEncontrar.length === 0 ? (
            <div className="empty">Ninguna.</div>
          ) : (
            <ol className="met-lista">
              {t.sinEncontrar.map((s, k) => (
                <li key={k}>
                  <span>{s.texto}</span>
                  <strong>{n(s.veces)}</strong>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </section>
  );
}

export default async function MetricasPage() {
  const sesion = await requireSession();

  let m: MetricasCliente;
  try {
    m = await getMetricasCliente(sesion.accessToken);
  } catch (error) {
    if (esRedireccion(error)) throw error;
    const esPermiso = error instanceof ApiError && error.status === 403;
    return (
      <Marco usuario={sesion.usuario} titulo="Mis métricas">
        <div className={esPermiso ? 'notice' : 'notice error'}>
          <h2>{esPermiso ? 'Esta pantalla es para clientes' : 'No se pudieron cargar tus métricas'}</h2>
          {!esPermiso && <p>{error instanceof ContractError || error instanceof ApiError ? error.message : 'Error inesperado.'}</p>}
        </div>
      </Marco>
    );
  }

  return (
    <Marco usuario={sesion.usuario} titulo="Mis métricas">
      {/* Su nivel del programa; si no se pudo leer, el rol de la cuenta. */}
      <Bienvenida nombre={sesion.usuario.nombre} rol={sesion.usuario.role} categoria={m.programa?.evaluacion.nivel ?? null} />
      <ProgramaCliente programa={m.programa} />
      <Compras m={m} />
      <QueCompras m={m} />
      <Tablets m={m} />
    </Marco>
  );
}
