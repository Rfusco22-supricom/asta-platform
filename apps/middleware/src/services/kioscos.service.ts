import { createHmac, randomBytes } from 'node:crypto';
import type { AlmacenKiosco, ErrorCode, Kiosco, NuevoKiosco } from '@asta/shared-types';
import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { getUid, searchRead } from '../odoo/client.js';
import type { AlmacenCliente } from './inventory.service.js';

/**
 * Las tablets del kiosco (#40, #120).
 *
 * ── Por qué un token propio y no una API key ─────────────────────────────────
 *
 * «Mis API keys» es de los clientes: el permiso se le niega al personal, y una
 * key de cliente en una tablet de piso de venta ata la tablet a un cliente que
 * no es nadie. Una tablet atiende a quien entre por la puerta. Por eso tiene su
 * fila en `kiosk_devices`, con la tienda y el almacén del que salen las
 * existencias, y un token que solo abre `/api/v1/kiosk/...`: si alguien lo saca
 * de la tablet, lo único que puede hacer es preguntar qué tóner sirve.
 *
 * ── El token ─────────────────────────────────────────────────────────────────
 *
 *   asta_kio_<43 caracteres base64url>      (32 bytes al azar)
 *
 * Se guarda su HMAC-SHA256 con el mismo pepper que las API keys, y con su
 * rotación (#45): con `API_KEY_PEPPER_ANTERIOR` puesto, un token hasheado con
 * el pepper viejo sigue entrando y se pasa al nuevo en ese mismo uso. El token
 * en claro sale una sola vez, al crearlo o al pedir uno nuevo.
 *
 * `token_hash_anterior` existe para la rotación automática diaria que pide #40
 * (aceptar el anterior 24 h). Aquí ya se acepta; quien rota todavía es una
 * persona, desde el panel, y entonces el viejo deja de valer en el acto: quien
 * pide un token nuevo es porque está reconfigurando la tablet o porque la
 * perdió.
 */

const PREFIJO = 'asta_kio_';
const TOKEN = /^asta_kio_[A-Za-z0-9_-]{43}$/;
/** Cuánto vale el token anterior tras una rotación (#120). */
const VENTANA_ANTERIOR_MS = 24 * 3600 * 1000;
/** Cada cuánto se apunta `last_seen_at`: no hace falta una escritura por petición. */
const CADA_VISTO_MS = 5 * 60 * 1000;

export class KioscoNoEncontrado extends Error {
  readonly status = 404;
  readonly code: ErrorCode = 'NOT_FOUND';
  constructor() {
    super('Tablet no encontrada.');
    this.name = 'KioscoNoEncontrado';
  }
}

export class AlmacenNoValido extends Error {
  readonly status = 400;
  readonly code: ErrorCode = 'VALIDATION_ERROR';
  constructor() {
    super('Ese almacén no existe en Odoo, o el usuario de servicio no lo ve.');
    this.name = 'AlmacenNoValido';
  }
}

export function esTokenDeKiosco(texto: string): boolean {
  return texto.startsWith(PREFIJO);
}

function hmac(pepper: string, token: string): string {
  return createHmac('sha256', pepper).update(token).digest('hex');
}

function emitirToken(): { token: string; hash: string } {
  const token = `${PREFIJO}${randomBytes(32).toString('base64url')}`;
  return { token, hash: hmac(env().API_KEY_PEPPER, token) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Almacenes de Odoo, para elegir de cuál es la tablet
// ─────────────────────────────────────────────────────────────────────────────

/** Todos los almacenes que ve el usuario de servicio, en todas sus compañías. */
export async function almacenesDeOdoo(): Promise<AlmacenKiosco[]> {
  const uid = await getUid();
  const [usuario] = await searchRead<{ company_ids: number[] }>('res.users', [['id', '=', uid]], ['company_ids']);
  const companias = usuario?.company_ids ?? [];
  const almacenes = await searchRead<{ id: number; name: string; code: string | false; company_id: [number, string] | false }>(
    'stock.warehouse',
    [],
    ['name', 'code', 'company_id'],
    { order: 'company_id, name', context: { allowed_company_ids: companias } },
  );
  return almacenes
    .filter((a): a is typeof a & { company_id: [number, string] } => Boolean(a.company_id))
    .map((a) => ({ warehouseId: a.id, nombre: a.name, codigo: a.code || null, companyId: a.company_id[0], compania: a.company_id[1] }));
}

async function almacenesSiOdooResponde(): Promise<Map<number, AlmacenKiosco> | null> {
  try {
    return new Map((await almacenesDeOdoo()).map((a) => [a.warehouseId, a]));
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Gestión desde el panel
// ─────────────────────────────────────────────────────────────────────────────

type Fila = {
  id: string;
  label: string;
  storeLocation: string;
  odooCompanyId: number;
  odooWarehouseId: number;
  isActive: boolean;
  lastSeenAt: Date | null;
  appVersion: string | null;
  createdAt: Date;
};

function aKiosco(f: Fila, almacenes: Map<number, AlmacenKiosco> | null): Kiosco {
  const a = almacenes?.get(f.odooWarehouseId);
  return {
    id: f.id,
    nombre: f.label,
    tienda: f.storeLocation,
    odooCompanyId: f.odooCompanyId,
    odooWarehouseId: f.odooWarehouseId,
    almacen: a?.nombre ?? null,
    compania: a?.compania ?? null,
    activo: f.isActive,
    ultimaConexion: f.lastSeenAt?.toISOString() ?? null,
    version: f.appVersion,
    creadoEn: f.createdAt.toISOString(),
  };
}

const CAMPOS = {
  id: true,
  label: true,
  storeLocation: true,
  odooCompanyId: true,
  odooWarehouseId: true,
  isActive: true,
  lastSeenAt: true,
  appVersion: true,
  createdAt: true,
} as const;

export async function listarKioscos(): Promise<{ kioscos: Kiosco[]; odooDisponible: boolean }> {
  const [filas, almacenes] = await Promise.all([
    prisma.kioskDevice.findMany({ select: CAMPOS, orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }] }),
    almacenesSiOdooResponde(),
  ]);
  return { kioscos: filas.map((f) => aKiosco(f, almacenes)), odooDisponible: almacenes !== null };
}

/**
 * Da de alta una tablet. La compañía sale del almacén, no de la petición: así
 * no puede quedar una tablet con un almacén de una compañía y la otra de otra.
 */
export async function registrarKiosco(datos: NuevoKiosco): Promise<{ kiosco: Kiosco; token: string }> {
  const almacenes = new Map((await almacenesDeOdoo()).map((a) => [a.warehouseId, a]));
  const almacen = almacenes.get(datos.odooWarehouseId);
  if (!almacen) throw new AlmacenNoValido();
  const { token, hash } = emitirToken();
  const fila = await prisma.kioskDevice.create({
    data: { label: datos.nombre, storeLocation: datos.tienda, odooCompanyId: almacen.companyId, odooWarehouseId: almacen.warehouseId, tokenHash: hash },
    select: CAMPOS,
  });
  return { kiosco: aKiosco(fila, almacenes), token };
}

/** Un token nuevo. El de antes deja de valer en el acto (ver arriba). */
export async function nuevoTokenKiosco(id: string): Promise<{ kiosco: Kiosco; token: string }> {
  const { token, hash } = emitirToken();
  const r = await prisma.kioskDevice.updateMany({ where: { id }, data: { tokenHash: hash, tokenHashAnterior: null, tokenRotadoEn: new Date() } });
  if (r.count === 0) throw new KioscoNoEncontrado();
  const fila = await prisma.kioskDevice.findUniqueOrThrow({ where: { id }, select: CAMPOS });
  return { kiosco: aKiosco(fila, await almacenesSiOdooResponde()), token };
}

/** Desactivar no borra: la tablet deja de entrar, y su historial se queda. */
export async function cambiarKiosco(id: string, activo: boolean): Promise<Kiosco> {
  const r = await prisma.kioskDevice.updateMany({ where: { id }, data: { isActive: activo } });
  if (r.count === 0) throw new KioscoNoEncontrado();
  const fila = await prisma.kioskDevice.findUniqueOrThrow({ where: { id }, select: CAMPOS });
  return aKiosco(fila, await almacenesSiOdooResponde());
}

// ─────────────────────────────────────────────────────────────────────────────
// Autenticación de la tablet
// ─────────────────────────────────────────────────────────────────────────────

export interface KioscoAutenticado {
  deviceId: string;
  almacen: AlmacenCliente;
}

const vistoEn = new Map<string, number>();

/** Solo para tests. */
export function olvidarVistos(): void {
  vistoEn.clear();
}

/**
 * La tablet de este token, o `null`. Mismo trato que las API keys: no se dice
 * por qué no vale, y lo que se compara es un HMAC, nunca el token.
 */
export async function verificarTokenKiosco(token: string, version?: string, ahora = new Date()): Promise<KioscoAutenticado | null> {
  if (!TOKEN.test(token)) return null;
  const actual = hmac(env().API_KEY_PEPPER, token);
  const pepperAnterior = env().API_KEY_PEPPER_ANTERIOR;
  const viejo = pepperAnterior !== undefined ? hmac(pepperAnterior, token) : undefined;
  const hashes = viejo ? [actual, viejo] : [actual];

  const fila = await prisma.kioskDevice.findFirst({
    where: { OR: [{ tokenHash: { in: hashes } }, { tokenHashAnterior: { in: hashes } }] },
    select: { id: true, isActive: true, tokenHash: true, tokenHashAnterior: true, tokenRotadoEn: true, odooCompanyId: true, odooWarehouseId: true },
  });
  if (!fila || !fila.isActive) return null;

  const porElAnterior = fila.tokenHashAnterior !== null && hashes.includes(fila.tokenHashAnterior) && !hashes.includes(fila.tokenHash);
  if (porElAnterior && (!fila.tokenRotadoEn || ahora.getTime() - fila.tokenRotadoEn.getTime() > VENTANA_ANTERIOR_MS)) return null;

  // Hasheado con el pepper anterior (#45): se pasa al actual en este uso.
  if (!porElAnterior && fila.tokenHash !== actual) {
    await prisma.kioskDevice.updateMany({ where: { id: fila.id, tokenHash: fila.tokenHash }, data: { tokenHash: actual } }).catch(() => undefined);
  }

  const ultima = vistoEn.get(fila.id) ?? 0;
  if (ahora.getTime() - ultima > CADA_VISTO_MS) {
    vistoEn.set(fila.id, ahora.getTime());
    await prisma.kioskDevice
      .update({ where: { id: fila.id }, data: { lastSeenAt: ahora, ...(version ? { appVersion: version.slice(0, 20) } : {}) } })
      .catch(() => undefined);
  }

  return { deviceId: fila.id, almacen: { companyId: fila.odooCompanyId, warehouseId: fila.odooWarehouseId } };
}
