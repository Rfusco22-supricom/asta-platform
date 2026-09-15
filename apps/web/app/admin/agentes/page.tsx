import Link from 'next/link';
import { requireSession } from '@/lib/session';
import { Marco } from '@/components/Marco';
import { getAgentes, ApiError, esRedireccion, ContractError } from '@/lib/api';
import { moneyCompact } from '@/lib/formato';
import { TablaAgentes } from './TablaAgentes';

/**
 * Agentes de venta: quién lleva qué cartera, cuánto factura y si puede entrar.
 *
 * ── Por qué las dos cosas en la misma pantalla ───────────────────────────────
 *
 * Porque separadas no contestan nada. La sección de usuarios dice quién no puede
 * entrar pero no cuánto vende; la de reconciliación cuenta clientes sin mirar al
 * comercial. Fue exactamente así como la persona con la cartera más grande de la
 * empresa —260 clientes— pasó meses sin cuenta y sin que saltara nada.
 *
 * Aquí las dos van en la misma fila, y por eso el filtro «solo los sin acceso»
 * es la acción principal de la pantalla y no un detalle.
 */

export const dynamic = 'force-dynamic';

function Metrica({
  etiqueta,
  valor,
  nota,
  tono,
}: {
  etiqueta: string;
  valor: string;
  nota?: string;
  tono?: 'mal' | 'atencion';
}) {
  const color = tono === 'mal' ? 'var(--danger)' : tono === 'atencion' ? 'var(--warning)' : undefined;
  return (
    <div className="stat">
      <div className="stat-label">{etiqueta}</div>
      <div className="stat-value" style={{ color }}>
        {valor}
      </div>
      {nota && <div className="stat-sub">{nota}</div>}
    </div>
  );
}

export default async function AgentesPage() {
  const sesion = await requireSession();

  let datos;
  try {
    datos = await getAgentes(sesion.accessToken);
  } catch (error) {
    // `redirect()` funciona lanzando: si no se relanza, el catch se la traga.
    if (esRedireccion(error)) throw error;

    const esPermiso = error instanceof ApiError && error.status === 403;
    return (
      <Marco usuario={sesion.usuario} titulo="Agentes">
        <div className="notice error">
          <h2>{esPermiso ? 'Esta sección es solo para administradores' : 'No se pudo cargar'}</h2>
          <p>
            {error instanceof ContractError || error instanceof ApiError
              ? error.message
              : 'Error inesperado.'}
          </p>
        </div>
      </Marco>
    );
  }

  const { filas, totales } = datos;
  const pctDeuda = totales.facturado > 0 ? (totales.porCobrar / totales.facturado) * 100 : 0;

  return (
    <Marco
      usuario={sesion.usuario}
      titulo="Agentes"
      descripcion={`${totales.agentes} personas con cartera asignada en Odoo · leído en ${(datos.duracionMs / 1000).toFixed(1)} s`}
    >
      <section className="stats">
        <Metrica
          etiqueta="Cartera total"
          valor={totales.clientes.toLocaleString('es-VE')}
          nota="clientes asignados"
        />
        <Metrica
          etiqueta="Facturado"
          valor={moneyCompact(totales.facturado)}
          nota="histórico, facturas contabilizadas"
        />
        <Metrica
          etiqueta="Por cobrar"
          valor={moneyCompact(totales.porCobrar)}
          nota={`${pctDeuda.toFixed(0)} % de lo facturado`}
          tono={pctDeuda >= 30 ? 'mal' : undefined}
        />
        <Metrica
          etiqueta="Sin acceso al panel"
          valor={String(totales.sinAcceso)}
          nota="trabajan hoy y no pueden entrar"
          tono={totales.sinAcceso > 0 ? 'mal' : undefined}
        />
      </section>

      {/*
        El aviso lleva la acción, no solo el número.
        Un contador en rojo sin nada que pulsar se convierte en parte del
        decorado a la tercera vez que se ve.
      */}
      {totales.sinAcceso > 0 && (
        <div className="notice" style={{ marginBottom: 18 }}>
          <h2>{totales.sinAcceso} agentes no pueden ver su cartera</h2>
          <p>
            Tienen clientes asignados en Odoo y trabajan hoy, pero o no tienen cuenta en el
            panel o nadie les ha puesto contraseña. Se resuelve desde{' '}
            <Link href="/admin/usuarios">Usuarios</Link>, generando su enlace de invitación.
          </p>
        </div>
      )}

      <TablaAgentes filas={filas} />
    </Marco>
  );
}
