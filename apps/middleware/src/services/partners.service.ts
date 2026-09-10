import { searchRead, type OdooDomain } from '../odoo/client.js';

interface PartnerRow {
  id: number;
  name: string;
  email: string | false;
  phone: string | false;
  /** Vendedor asignado: [res.users.id, nombre] o false. */
  user_id: [number, string] | false;
  /** Empresa matriz cuando el partner es un contacto hijo. */
  commercial_partner_id: [number, string] | false;
  property_product_pricelist: [number, string] | false;
  /** Campo personalizado de ASTA: bronce | plata | gold. */
  x_client_tier: string | false;
}

const PARTNER_FIELDS = [
  'id',
  'name',
  'email',
  'phone',
  'user_id',
  'commercial_partner_id',
  'property_product_pricelist',
  'x_client_tier',
] as const;

export interface Partner {
  id: number;
  nombre: string;
  email: string | null;
  telefono: string | null;
  vendedorOdooUserId: number | null;
  vendedorNombre: string | null;
  commercialPartnerId: number;
  pricelistId: number | null;
  tier: string | null;
}

function mapPartner(row: PartnerRow): Partner {
  return {
    id: row.id,
    nombre: row.name,
    email: row.email || null,
    telefono: row.phone || null,
    vendedorOdooUserId: row.user_id ? row.user_id[0] : null,
    vendedorNombre: row.user_id ? row.user_id[1] : null,
    commercialPartnerId: row.commercial_partner_id ? row.commercial_partner_id[0] : row.id,
    pricelistId: row.property_product_pricelist ? row.property_product_pricelist[0] : null,
    tier: row.x_client_tier || null,
  };
}

export async function getPartner(partnerId: number): Promise<Partner | null> {
  const rows = await searchRead<PartnerRow>('res.partner', [['id', '=', partnerId]], [
    ...PARTNER_FIELDS,
  ]);
  return rows[0] ? mapPartner(rows[0]) : null;
}

/** Cartera de un vendedor: los partners cuyo `user_id` es él. */
export async function getPartnersBySalesperson(odooUserId: number): Promise<Partner[]> {
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
 * Se consulta a Odoo — no al espejo en Postgres — porque la reasignación de
 * cartera ocurre en el ERP y el espejo puede ir minutos por detrás. Aquí un dato
 * viejo significa que un vendedor ve la facturación de un cliente que ya no es
 * suyo, así que se paga el RPC.
 *
 * La verificación sube por `commercial_partner_id`: si el vendedor tiene asignada
 * la matriz, puede ver también sus sucursales.
 */
export async function assertSalespersonOwnsPartner(
  odooUserId: number,
  partnerId: number,
): Promise<Partner> {
  const partner = await getPartner(partnerId);
  if (!partner) throw new PartnerNotFound(partnerId);

  if (partner.vendedorOdooUserId === odooUserId) return partner;

  if (partner.commercialPartnerId !== partner.id) {
    const matriz = await getPartner(partner.commercialPartnerId);
    if (matriz?.vendedorOdooUserId === odooUserId) return partner;
  }

  throw new ForbiddenPartnerAccess(odooUserId, partnerId);
}
