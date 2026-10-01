import type { ClientTier, Partner } from '@asta/shared-types';
import { searchRead, type OdooDomain } from '../odoo/client.js';
import { isUnmappedPricelist, tierFromPricelist } from '../config/tiers.js';
import { idTarifa, leerTarifas, nombreTarifa, type TarifaLeida } from './tarifas.service.js';

/**
 * Clientes y cartera de vendedores.
 *
 * NOTA DE FASE 0 (issue #3): este servicio leía `x_client_tier`, que NO existe
 * en la instancia. Odoo devuelve `Invalid field` y el request entero falla. El
 * nivel del cliente ahora se deriva de `property_product_pricelist`, que es el
 * mecanismo nativo. Ver `config/tiers.ts`.
 */

interface PartnerRow {
  id: number;
  name: string;
  email: string | false;
  phone: string | false;
  /** Vendedor asignado: [res.users.id, nombre] o false. */
  user_id: [number, string] | false;
  /** Empresa matriz cuando el partner es un contacto hijo. */
  commercial_partner_id: [number, string] | false;
  /** Odoo lo incrementa al facturarle. 0 = nunca ha comprado. */
  customer_rank: number;
}

const PARTNER_FIELDS = [
  'id',
  'name',
  'email',
  'phone',
  'user_id',
  'commercial_partner_id',
  // `property_product_pricelist` se lee aparte, desde la compañía de cada
  // cliente: junto al resto sale el de la compañía del usuario de servicio.
  // Ver `tarifas.service.ts` y `conTarifas`.
  'customer_rank',
] as const;

export interface PartnerWithTier extends Partner {
  tierDerivado: ClientTier;
  /** true si su tarifa no está en el mapeo: configuración incompleta que hay que revisar. */
  tarifaSinMapear: boolean;
  /**
   * false = prospecto: está asignado al vendedor pero nunca se le ha facturado.
   *
   * De los 791 partners asignados al vendedor con mayor cartera, 532 están así.
   * NO se filtran: un prospecto asignado es exactamente el trabajo pendiente del
   * vendedor, y esconderlo le quitaría dos tercios de su cartera de la vista. Se
   * marca para que el panel pueda separarlos y contarlos aparte.
   */
  esCliente: boolean;
}

/**
 * Limpia un campo de texto de Odoo.
 *
 * Odoo devuelve `false` para los vacíos, y los valores que sí trae vienen tal
 * como los tecleó alguien: con espacios al final, o siendo solo espacios. De 440
 * correos de una cartera real, 6 tenían un espacio sobrante — suficiente para
 * que fallaran la validación aguas abajo aunque la dirección fuese correcta.
 *
 * Se normaliza aquí, en la frontera por donde los datos entran al sistema, y no
 * relajando el contrato: un espacio al final no forma parte de una dirección de
 * correo, así que el contrato tiene razón y el dato está sucio.
 */
function limpiar(valor: string | false): string | null {
  if (!valor) return null;
  const t = valor.trim();
  return t.length > 0 ? t : null;
}

function mapPartner(row: PartnerRow, tarifa: TarifaLeida | undefined): PartnerWithTier {
  const pricelistId = idTarifa(tarifa);

  return {
    id: row.id,
    nombre: row.name.trim(),
    email: limpiar(row.email),
    telefono: limpiar(row.phone),
    vendedorOdooUserId: row.user_id ? row.user_id[0] : null,
    vendedorNombre: row.user_id ? row.user_id[1] : null,
    commercialPartnerId: row.commercial_partner_id ? row.commercial_partner_id[0] : row.id,
    pricelistId,
    /** Nombre de la tarifa, que es lo más parecido a un "tier" que hay hoy en Odoo. */
    tier: nombreTarifa(tarifa),
    tierDerivado: tierFromPricelist(pricelistId),
    tarifaSinMapear: isUnmappedPricelist(pricelistId),
    esCliente: (row.customer_rank ?? 0) > 0,
  };
}

/** Las filas con su tarifa, leída desde la compañía de cada cliente. */
async function conTarifas(rows: PartnerRow[]): Promise<PartnerWithTier[]> {
  const tarifas = await leerTarifas(rows.map((r) => r.id));
  return rows.map((r) => mapPartner(r, tarifas.get(r.id)));
}

export async function getPartner(partnerId: number): Promise<PartnerWithTier | null> {
  const rows = await searchRead<PartnerRow>(
    'res.partner',
    [['id', '=', partnerId]],
    [...PARTNER_FIELDS],
  );
  const [partner] = await conTarifas(rows);
  return partner ?? null;
}

/** Varios partners de una sola llamada. Evita el N+1 contra el ERP. */
export async function getPartners(partnerIds: number[]): Promise<PartnerWithTier[]> {
  if (partnerIds.length === 0) return [];
  const rows = await searchRead<PartnerRow>(
    'res.partner',
    [['id', 'in', partnerIds]],
    [...PARTNER_FIELDS],
  );
  return conTarifas(rows);
}

/** Cartera de un vendedor: los partners cuyo `user_id` es él. */
export async function getPartnersBySalesperson(odooUserId: number): Promise<PartnerWithTier[]> {
  const domain: OdooDomain = [
    ['user_id', '=', odooUserId],
    ['active', '=', true],
    // Solo la entidad comercial: evita duplicar cada contacto de una misma empresa.
    ['parent_id', '=', false],
  ];

  const rows = await searchRead<PartnerRow>('res.partner', domain, [...PARTNER_FIELDS], {
    order: 'name asc',
  });

  return conTarifas(rows);
}

export class ForbiddenPartnerAccess extends Error {
  readonly status = 403;
  readonly code = 'PARTNER_NOT_IN_PORTFOLIO';

  /**
   * El id viaja DENTRO del error, no se lee de `req.params` en el manejador.
   *
   * Express limpia `req.params` al salir de la capa de la ruta, así que cuando
   * el manejador de errores corre a nivel de aplicación ya está vacío. El
   * registro de auditoría guardaba `targetId: ""`: sabías que alguien fue
   * rechazado, pero no qué intentó ver — es decir, un rastro inútil.
   */
  constructor(
    readonly odooUserId: number,
    readonly partnerId: number,
  ) {
    super(`El vendedor ${odooUserId} no tiene asignado al cliente ${partnerId}`);
    this.name = 'ForbiddenPartnerAccess';
  }
}

export class PartnerNotFound extends Error {
  readonly status = 404;
  readonly code = 'PARTNER_NOT_FOUND';

  constructor(readonly partnerId: number) {
    super(`No existe el cliente ${partnerId}`);
    this.name = 'PartnerNotFound';
  }
}

/**
 * Puerta de autorización del módulo de vendedores.
 *
 * Se consulta a Odoo —no al espejo en Postgres— porque la reasignación de cartera
 * ocurre en el ERP y el espejo puede ir minutos por detrás. Aquí un dato viejo
 * significa que un vendedor ve la facturación de un cliente que ya no es suyo, así
 * que se paga el RPC.
 *
 * La verificación sube por `commercial_partner_id`: si el vendedor tiene asignada
 * la matriz, puede ver también sus sucursales. Sin esta parte, un vendedor pierde
 * acceso a las sucursales de sus propios clientes; y al revés, sin ella alguien
 * podría colarse pidiendo una sucursal cuya matriz es de otro vendedor.
 */
export async function assertSalespersonOwnsPartner(
  odooUserId: number,
  partnerId: number,
): Promise<PartnerWithTier> {
  const partner = await getPartner(partnerId);
  if (!partner) throw new PartnerNotFound(partnerId);

  if (partner.vendedorOdooUserId === odooUserId) return partner;

  if (partner.commercialPartnerId !== partner.id) {
    const matriz = await getPartner(partner.commercialPartnerId);
    if (matriz?.vendedorOdooUserId === odooUserId) return partner;
  }

  throw new ForbiddenPartnerAccess(odooUserId, partnerId);
}
