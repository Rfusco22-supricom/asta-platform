import type { ClientTier, Partner } from '@asta/shared-types';
import { searchRead, type OdooDomain } from '../odoo/client.js';
import { isUnmappedPricelist, tierFromPricelist } from '../config/tiers.js';

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
  /**
   * Campo `property` (vive en ir.property). Se puede LEER con search_read, pero
   * NO se puede agrupar: `read_group` sobre él falla con
   * "Cannot convert field to SQL". Verificado en Fase 0.
   */
  property_product_pricelist: [number, string] | false;
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
  'property_product_pricelist',
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

function mapPartner(row: PartnerRow): PartnerWithTier {
  const pricelistId = row.property_product_pricelist ? row.property_product_pricelist[0] : null;

  return {
    id: row.id,
    nombre: row.name,
    email: row.email || null,
    telefono: row.phone || null,
    vendedorOdooUserId: row.user_id ? row.user_id[0] : null,
    vendedorNombre: row.user_id ? row.user_id[1] : null,
    commercialPartnerId: row.commercial_partner_id ? row.commercial_partner_id[0] : row.id,
    pricelistId,
    /** Nombre de la tarifa, que es lo más parecido a un "tier" que hay hoy en Odoo. */
    tier: row.property_product_pricelist ? row.property_product_pricelist[1] : null,
    tierDerivado: tierFromPricelist(pricelistId),
    tarifaSinMapear: isUnmappedPricelist(pricelistId),
    esCliente: (row.customer_rank ?? 0) > 0,
  };
}

export async function getPartner(partnerId: number): Promise<PartnerWithTier | null> {
  const rows = await searchRead<PartnerRow>(
    'res.partner',
    [['id', '=', partnerId]],
    [...PARTNER_FIELDS],
  );
  return rows[0] ? mapPartner(rows[0]) : null;
}

/** Varios partners de una sola llamada. Evita el N+1 contra el ERP. */
export async function getPartners(partnerIds: number[]): Promise<PartnerWithTier[]> {
  if (partnerIds.length === 0) return [];
  const rows = await searchRead<PartnerRow>(
    'res.partner',
    [['id', 'in', partnerIds]],
    [...PARTNER_FIELDS],
  );
  return rows.map(mapPartner);
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

  return rows.map(mapPartner);
}

export class ForbiddenPartnerAccess extends Error {
  readonly status = 403;
  readonly code = 'PARTNER_NOT_IN_PORTFOLIO';

  constructor(odooUserId: number, partnerId: number) {
    super(`El vendedor ${odooUserId} no tiene asignado al cliente ${partnerId}`);
    this.name = 'ForbiddenPartnerAccess';
  }
}

export class PartnerNotFound extends Error {
  readonly status = 404;
  readonly code = 'PARTNER_NOT_FOUND';

  constructor(partnerId: number) {
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
