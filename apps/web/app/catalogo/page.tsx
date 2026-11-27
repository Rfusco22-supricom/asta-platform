import { redirect } from 'next/navigation';
import { requireSession } from '@/lib/session';
import { destinoPara } from '@/lib/navegacion';
import { Marco } from '@/components/Marco';
import { Catalogo } from '@/components/Catalogo';
import { getCatalogoAsta, esRedireccion } from '@/lib/api';

/**
 * El catálogo de productos ASTA para el personal: las mismas fichas que el PDF
 * que los vendedores mandan a sus clientes, con buscador y el PDF para bajar.
 * Una sola página para el administrador y el vendedor: no depende de la cartera.
 */

export const dynamic = 'force-dynamic';

export default async function CatalogoPage() {
  const sesion = await requireSession();
  if (sesion.usuario.role !== 'SUPERADMIN' && sesion.usuario.role !== 'VENDEDOR') redirect(destinoPara(sesion.usuario.role));

  const acciones = (
    <div className="catalogo-descargas">
      <a className="btn btn-inline" href="/api/catalogo/precios" download>
        Descargar PDF
      </a>
      <a className="btn-link" href="/api/catalogo/fotos" download title="El mismo catálogo, sin la columna de precios">
        Sin precios
      </a>
    </div>
  );

  let datos;
  try {
    datos = await getCatalogoAsta(sesion.accessToken);
  } catch (error) {
    if (esRedireccion(error)) throw error;
    return (
      <Marco usuario={sesion.usuario} titulo="Catálogo">
        <div className="notice error">
          <h2>No se pudo cargar el catálogo</h2>
          <p>Recarga en un momento.</p>
        </div>
      </Marco>
    );
  }

  return (
    <Marco usuario={sesion.usuario} titulo="Catálogo" descripcion="Los productos ASTA con su foto y su precio, para enseñárselos o mandárselos a un cliente." acciones={acciones}>
      <Catalogo fichas={datos.fichas} conPrecios={datos.preciosLeidos !== null} />
    </Marco>
  );
}
