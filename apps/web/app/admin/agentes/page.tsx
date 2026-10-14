import Link from 'next/link';
import { requireSession } from '@/lib/session';
import { Marco } from '@/components/Marco';
import { Sedes, sedeDeParams } from '@/components/Sedes';
import { getAgentes, ApiError, esRedireccion, ContractError } from '@/lib/api';
import { nombreSede } from '@asta/shared-types';
import { moneyCompact } from '@/lib/formato';
import { TablaAgentes } from './TablaAgentes';
import { Cifra, type ColorCifra, type IconoCifra } from '@/components/Cifras';

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
  icono,
  color,
}: {
  etiqueta: string;
  valor: string;
  nota?: string;
  tono?: 'mal' | 'atencion';
  icono: IconoCifra;
  color?: ColorCifra;
}) {
  return <Cifra icono={icono} color={color} etiqueta={etiqueta} valor={valor} nota={nota} tono={tono === 'mal' ? 'alerta' : tono} />;
}

export default async function AgentesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sesion = await requireSession();
  const sede = sedeDeParams(await searchParams);

  let datos;
  try {
    datos = await getAgentes(sesion.accessToken, sede);
  } catch (error) {
    // `redirect()` funciona lanzando: si no se relanza, el catch se la traga.
    if (esRedireccion(error)) throw error;

    const esPermiso = error instanceof ApiError && error.status === 403;
    return (
      <Marco usuario={sesion.usuario} titulo="Vendedores">
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

  return (
    <Marco
      usuario={sesion.usuario}
      titulo="Vendedores"
      descripcion={`${totales.agentes} personas con cartera asignada en Odoo · solo ASTA${sede === null ? '' : `, vendido en ${nombreSede(sede)}`} · leído en ${(datos.duracionMs / 1000).toFixed(1)} s`}
    >
      <Sedes base="/admin/agentes" sede={sede} />
      <section className="stats">
        <Metrica
          icono="clientes"
          color="violeta"
          etiqueta="Cartera total"
          valor={totales.clientes.toLocaleString('es-VE')}
          nota="clientes asignados"
        />
        <Metrica
          icono="ventas"
          etiqueta="Vendido en ASTA"
          valor={moneyCompact(totales.facturado)}
          nota="histórico, sin IVA, neto de devoluciones; lo de Smartbit, por quien hizo la venta"
        />
        <Metrica
          icono="cobrar"
          color="ambar"
          etiqueta="Por cobrar"
          valor={moneyCompact(totales.porCobrar)}
          nota="en las facturas con ASTA"
        />
        <Metrica
          icono="candado"
          color="rosa"
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
          <h2>{totales.sinAcceso} vendedores no pueden ver su cartera</h2>
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
