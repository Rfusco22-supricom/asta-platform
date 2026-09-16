import { requireSession } from '@/lib/session';
import { Marco } from '@/components/Marco';
import { FormularioCompatibilidad } from '@/components/FormularioCompatibilidad';
import { getPropuestasPropias, ApiError, esRedireccion, ContractError } from '@/lib/api';
import { fechaCorta } from '@/lib/formato';

/**
 * Compatibilidades, para el VENDEDOR (#56).
 *
 * El vendedor es quien oye «tengo una M404 y no sé qué tóner lleva». Aquí lo
 * propone, y ve en qué quedó lo que propuso. No revisa ni valida: eso es del
 * administrador, en su propia pantalla. Solo ve lo suyo.
 */

export const dynamic = 'force-dynamic';

const ESTADO: Record<string, { texto: string; clase: string }> = {
  PROPUESTA: { texto: 'pendiente de revisión', clase: 'estado-pendiente' },
  VALIDADA: { texto: 'validada', clase: 'estado-validada' },
  RECHAZADA: { texto: 'rechazada', clase: 'estado-rechazada' },
};

export default async function CompatibilidadesVendedorPage() {
  const sesion = await requireSession();

  let propias;
  try {
    propias = await getPropuestasPropias(sesion.accessToken);
  } catch (error) {
    if (esRedireccion(error)) throw error;
    const esPermiso = error instanceof ApiError && error.status === 403;
    return (
      <Marco usuario={sesion.usuario} titulo="Compatibilidades">
        <div className="notice error">
          <h2>{esPermiso ? 'Esta sección es para vendedores' : 'No se pudo cargar'}</h2>
          <p>{error instanceof ContractError || error instanceof ApiError ? error.message : 'Error inesperado.'}</p>
        </div>
      </Marco>
    );
  }

  const pendientes = propias.filter((p) => p.estado === 'PROPUESTA').length;

  return (
    <Marco usuario={sesion.usuario} titulo="Compatibilidades" descripcion="Propón qué cartucho le sirve a una impresora. Un administrador lo revisa antes de que llegue al kiosco.">
      <FormularioCompatibilidad como="vendedor" marcas={[...new Set(propias.map((p) => p.marcaImpresora))]} />

      <section className="panel">
        <h2>Lo que has propuesto</h2>
        {propias.length === 0 ? (
          <div className="empty">Todavía no has propuesto ninguna compatibilidad.</div>
        ) : (
          <>
            <p className="formulario-nota">
              {propias.length} {propias.length === 1 ? 'propuesta' : 'propuestas'}
              {pendientes > 0 && ` · ${pendientes} ${pendientes === 1 ? 'pendiente' : 'pendientes'} de revisión`}
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Impresora</th>
                    <th>Cartucho</th>
                    <th>Estado</th>
                    <th>Propuesta</th>
                  </tr>
                </thead>
                <tbody>
                  {propias.map((p) => (
                    <tr key={`${p.cartridgeId}:${p.printerModelId}`}>
                      <td>
                        {p.marcaImpresora} {p.modeloImpresora}
                      </td>
                      <td>
                        <span className="codigo-cartucho">{p.codigoCartucho}</span>
                        {p.marcaCartucho !== p.marcaImpresora && <div className="sku">{p.marcaCartucho}</div>}
                      </td>
                      <td>
                        <span className={`tag ${ESTADO[p.estado].clase}`}>{ESTADO[p.estado].texto}</span>
                        {p.revisadoEn && <div className="sku">{fechaCorta(p.revisadoEn)}</div>}
                      </td>
                      <td className="sku">{fechaCorta(p.creadaEn)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </Marco>
  );
}
