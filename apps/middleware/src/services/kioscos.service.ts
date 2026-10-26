import { createHmac, randomBytes, randomInt } from 'node:crypto';
import type { AlmacenKiosco, CodigoRevision, CodigoTablet, ErrorCode, EstadoCodigoTablet, Kiosco, NuevoKiosco, VincularTablet } from '@asta/shared-types';
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
 * ── De quién es la tablet ────────────────────────────────────────────────────
 *
 *   · de Supricom: tiene almacén y enseña existencias. La vincula un
 *     administrador eligiendo el almacén de la tienda;
 *   · de un cliente (`odoo_partner_id`): la vincula el cliente desde su cuenta
 *     del panel, para su propia tienda. Sin almacén: solo compatibilidades;
 *   · de un revisor de Apple o Google: con el código de revisión. Sin almacén.
 *
 * ── El token ─────────────────────────────────────────────────────────────────
 *
 *   asta_kio_<43 caracteres base64url>      (32 bytes al azar)
 *
 * Se guarda su HMAC-SHA256 con el mismo pepper que las API keys, y con su
 * rotación (#45): con `API_KEY_PEPPER_ANTERIOR` puesto, un token hasheado con
 * el pepper viejo sigue entrando y se pasa al nuevo en ese mismo uso. El token
 * en claro sale una sola vez: a la tablet al vincularla, o en el panel al darla
 * de alta a mano (una app compilada con el token dentro).
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

export class CodigoNoEncontrado extends Error {
  readonly status = 404;
  readonly code: ErrorCode = 'NOT_FOUND';
  constructor() {
    super('Código no encontrado.');
    this.name = 'CodigoNoEncontrado';
  }
}

export class DemasiadosCodigos extends Error {
  readonly status = 429;
  readonly code: ErrorCode = 'RATE_LIMITED';
  constructor() {
    super('Hay demasiados códigos sin usar. Usa los que ya pediste o espera a que caduquen.');
    this.name = 'DemasiadosCodigos';
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

async function almacenElegido(warehouseId: number): Promise<{ almacen: AlmacenKiosco; almacenes: Map<number, AlmacenKiosco> }> {
  const almacenes = new Map((await almacenesDeOdoo()).map((a) => [a.warehouseId, a]));
  const almacen = almacenes.get(warehouseId);
  if (!almacen) throw new AlmacenNoValido();
  return { almacen, almacenes };
}

// ─────────────────────────────────────────────────────────────────────────────
// Gestión desde el panel
// ─────────────────────────────────────────────────────────────────────────────

type Fila = {
  id: string;
  label: string;
  storeLocation: string;
  odooCompanyId: number | null;
  odooWarehouseId: number | null;
  odooPartnerId: number | null;
  isActive: boolean;
  lastSeenAt: Date | null;
  appVersion: string | null;
  createdAt: Date;
};

function aKiosco(f: Fila, almacenes: Map<number, AlmacenKiosco> | null, clientes: Map<number, string>): Kiosco {
  const a = f.odooWarehouseId !== null ? almacenes?.get(f.odooWarehouseId) : undefined;
  return {
    id: f.id,
    nombre: f.label,
    tienda: f.storeLocation,
    odooCompanyId: f.odooCompanyId,
    odooWarehouseId: f.odooWarehouseId,
    odooPartnerId: f.odooPartnerId,
    cliente: f.odooPartnerId !== null ? (clientes.get(f.odooPartnerId) ?? null) : null,
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
  odooPartnerId: true,
  isActive: true,
  lastSeenAt: true,
  appVersion: true,
  createdAt: true,
} as const;

/** El nombre de cada cliente dueño, de su cuenta del panel. */
async function nombresDeClientes(filas: Fila[]): Promise<Map<number, string>> {
  const ids = [...new Set(filas.map((f) => f.odooPartnerId).filter((id): id is number => id !== null))];
  if (!ids.length) return new Map();
  const usuarios = await prisma.appUser.findMany({ where: { odooPartnerId: { in: ids } }, select: { odooPartnerId: true, fullName: true }, orderBy: { createdAt: 'asc' } });
  const m = new Map<number, string>();
  for (const u of usuarios) if (!m.has(u.odooPartnerId)) m.set(u.odooPartnerId, u.fullName);
  return m;
}

async function aKioscos(filas: Fila[], almacenes: Map<number, AlmacenKiosco> | null): Promise<Kiosco[]> {
  const clientes = await nombresDeClientes(filas);
  return filas.map((f) => aKiosco(f, almacenes, clientes));
}

/**
 * Las tablets, activas primero. Con `partnerId`, solo las de ese cliente: es
 * la lista de su cuenta, y no necesita Odoo (sus tablets no tienen almacén).
 */
export async function listarKioscos(partnerId?: number): Promise<{ kioscos: Kiosco[]; odooDisponible: boolean }> {
  const delCliente = partnerId !== undefined;
  const [filas, almacenes] = await Promise.all([
    prisma.kioskDevice.findMany({
      where: delCliente ? { odooPartnerId: partnerId } : {},
      select: CAMPOS,
      orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
    }),
    delCliente ? Promise.resolve(null) : almacenesSiOdooResponde(),
  ]);
  return { kioscos: await aKioscos(filas, almacenes), odooDisponible: delCliente || almacenes !== null };
}

/**
 * Da de alta una tablet de Supricom a mano, con su token a la vista: para una
 * app compilada con el token dentro. La compañía sale del almacén, no de la
 * petición: así no puede quedar una tablet con un almacén de una compañía y la
 * otra de otra.
 */
export async function registrarKiosco(datos: NuevoKiosco): Promise<{ kiosco: Kiosco; token: string }> {
  const { almacen, almacenes } = await almacenElegido(datos.odooWarehouseId);
  const { token, hash } = emitirToken();
  const fila = await prisma.kioskDevice.create({
    data: { label: datos.nombre, storeLocation: datos.tienda, odooCompanyId: almacen.companyId, odooWarehouseId: almacen.warehouseId, tokenHash: hash },
    select: CAMPOS,
  });
  return { kiosco: aKiosco(fila, almacenes, new Map()), token };
}

/** Un token nuevo. El de antes deja de valer en el acto (ver arriba). */
export async function nuevoTokenKiosco(id: string): Promise<{ kiosco: Kiosco; token: string }> {
  const { token, hash } = emitirToken();
  const r = await prisma.kioskDevice.updateMany({ where: { id }, data: { tokenHash: hash, tokenHashAnterior: null, tokenRotadoEn: new Date() } });
  if (r.count === 0) throw new KioscoNoEncontrado();
  const fila = await prisma.kioskDevice.findUniqueOrThrow({ where: { id }, select: CAMPOS });
  const [k] = await aKioscos([fila], await almacenesSiOdooResponde());
  return { kiosco: k!, token };
}

/**
 * Desactivar no borra: la tablet deja de entrar (y vuelve a pedir un código), y
 * su historial se queda. Con `partnerId`, solo si la tablet es de ese cliente:
 * una ajena responde lo mismo que una que no existe.
 */
export async function cambiarKiosco(id: string, activo: boolean, partnerId?: number): Promise<Kiosco> {
  const where = partnerId !== undefined ? { id, odooPartnerId: partnerId } : { id };
  const r = await prisma.kioskDevice.updateMany({ where, data: { isActive: activo } });
  if (r.count === 0) throw new KioscoNoEncontrado();
  const fila = await prisma.kioskDevice.findUniqueOrThrow({ where: { id }, select: CAMPOS });
  const [k] = await aKioscos([fila], partnerId !== undefined ? null : await almacenesSiOdooResponde());
  return k!;
}

// ─────────────────────────────────────────────────────────────────────────────
// Vincular una tablet con un código del panel
// ─────────────────────────────────────────────────────────────────────────────
//
// La aplicación de la tienda de apps es la misma para todas las tablets, así
// que no puede llevar el token dentro. En el panel se pide un código:
//
//   · 6 dígitos al azar, de un solo uso, que caducan en `VIGENCIA_CODIGO_MS`;
//   · en la tablet se escribe (o se escanea su QR) y la tablet recibe su token,
//     emitido en ese momento: en la base nunca hay un token en claro esperando.
//
// Lo que tendrá la tablet (nombre, tienda, cliente, almacén) se decide al pedir
// el código, en el panel, y no lo puede cambiar la tablet.
//
// Probar códigos al azar: un millón de combinaciones, unos pocos vivos a la vez
// durante minutos, y la ruta frena por IP los intentos fallidos.
//
// El código de los revisores de Apple y Google es aparte: 12 dígitos, sin
// caducidad, de varios usos, y crea tablets de solo compatibilidades. Lo exige
// la revisión de las tiendas (unas credenciales que funcionen siempre). Hay
// uno como mucho: crear otro revoca el anterior.

/** Lo que vale un código desde que se pide en el panel. */
export const VIGENCIA_CODIGO_MS = 10 * 60 * 1000;
/** Códigos vivos sin usar por quien los pide. Más es pedir uno tras otro sin usarlos. */
export const MAX_CODIGOS_VIVOS = 10;
/** Lo que se le dice a la tablet ante cualquier código que no sirve: no se distingue por qué. */
export const MENSAJE_CODIGO_NO_VALIDO = 'Código no válido o caducado. Pide uno nuevo en el panel: Tablets → «Añadir tablet».';

function digitos(n: number): string {
  return Array.from({ length: n }, () => randomInt(10)).join('');
}

const hashCodigo = (codigo: string) => hmac(env().API_KEY_PEPPER, `codigo-tablet:${codigo}`);

/** Vivo: sin revocar, sin caducar y, si no es reutilizable, sin usar. */
const vivo = (ahora: Date) => ({
  revocadoEn: null,
  OR: [{ expiresAt: null }, { expiresAt: { gt: ahora } }],
  AND: [{ OR: [{ reutilizable: true }, { usos: 0 }] }],
});

async function crearCodigo(
  datos: { nombre: string; tienda: string; odooPartnerId?: number; almacen?: AlmacenKiosco; reutilizable?: boolean },
  creadoPor: string,
  ahora = new Date(),
): Promise<CodigoTablet> {
  if (!datos.reutilizable) {
    const vivos = await prisma.kioskCodigo.count({ where: { creadoPor, reutilizable: false, ...vivo(ahora) } });
    if (vivos >= MAX_CODIGOS_VIVOS) throw new DemasiadosCodigos();
  }
  // Un código vivo no puede repetirse: con uno repetido, la tablet se iría con
  // lo que pidió otro. Los viejos sí: ya no sirven.
  let codigo = '';
  for (let intento = 0; ; intento++) {
    codigo = digitos(datos.reutilizable ? 12 : 6);
    const repetido = await prisma.kioskCodigo.count({ where: { codigoHash: hashCodigo(codigo), ...vivo(ahora) } });
    if (!repetido) break;
    if (intento >= 9) throw new Error('No se encontró un código libre');
  }
  const expiresAt = datos.reutilizable ? null : new Date(ahora.getTime() + VIGENCIA_CODIGO_MS);
  const fila = await prisma.kioskCodigo.create({
    data: {
      codigoHash: hashCodigo(codigo),
      nombre: datos.nombre,
      tienda: datos.tienda,
      odooPartnerId: datos.odooPartnerId ?? null,
      odooCompanyId: datos.almacen?.companyId ?? null,
      odooWarehouseId: datos.almacen?.warehouseId ?? null,
      reutilizable: datos.reutilizable ?? false,
      creadoPor,
      createdAt: ahora,
      expiresAt,
    },
    select: { id: true },
  });
  return { id: fila.id, codigo, expiraEn: expiresAt?.toISOString() ?? null };
}

/** Una tablet de una tienda de Supricom, con su almacén: enseña existencias. */
export async function codigoParaSupricom(datos: NuevoKiosco, creadoPor: string): Promise<CodigoTablet> {
  const { almacen } = await almacenElegido(datos.odooWarehouseId);
  return crearCodigo({ nombre: datos.nombre, tienda: datos.tienda, almacen }, creadoPor);
}

/** Una tablet de la tienda de un cliente: sin almacén, solo compatibilidades. */
export async function codigoParaCliente(datos: { nombre: string; tienda?: string }, partnerId: number, creadoPor: string): Promise<CodigoTablet> {
  return crearCodigo({ nombre: datos.nombre, tienda: datos.tienda || 'Sin ubicación', odooPartnerId: partnerId }, creadoPor);
}

/** Si ya se usó, para que el panel diga «✓ Tablet conectada». Solo los de quien pregunta. */
export async function estadoCodigo(id: string, creadoPor: string, ahora = new Date()): Promise<EstadoCodigoTablet> {
  const f = await prisma.kioskCodigo.findFirst({
    where: { id, creadoPor, reutilizable: false },
    select: { usos: true, revocadoEn: true, expiresAt: true, device: { select: { id: true, label: true } } },
  });
  if (!f) throw new CodigoNoEncontrado();
  const tablet = f.device ? { id: f.device.id, nombre: f.device.label } : null;
  if (f.usos > 0) return { estado: 'USADO', tablet };
  if (f.revocadoEn) return { estado: 'REVOCADO', tablet: null };
  if (f.expiresAt && f.expiresAt <= ahora) return { estado: 'CADUCADO', tablet: null };
  return { estado: 'PENDIENTE', tablet: null };
}

/**
 * El código con el que la tablet entra. `null` ante cualquier código que no
 * sirve —mal escrito, caducado, usado o revocado—: la misma respuesta para
 * todos, como con los tokens.
 */
export async function vincularTablet(
  datos: Omit<VincularTablet, 'codigo'> & { codigo: string },
  ahora = new Date(),
): Promise<{ token: string; nombre: string; conExistencias: boolean } | null> {
  const c = await prisma.kioskCodigo.findFirst({ where: { codigoHash: hashCodigo(datos.codigo), ...vivo(ahora) } });
  if (!c) return null;

  const { token, hash } = emitirToken();
  return prisma.$transaction(async (tx) => {
    // De un solo uso: si dos tablets lo usan a la vez, solo una se lo lleva.
    const tomado = await tx.kioskCodigo.updateMany({
      where: c.reutilizable ? { id: c.id, revocadoEn: null } : { id: c.id, usos: 0 },
      data: { usos: { increment: 1 }, usadoEn: c.usadoEn ?? ahora },
    });
    if (tomado.count === 0) return null;
    const nombre = c.reutilizable ? `${c.nombre} ${c.usos + 1}` : c.nombre;
    const fila = await tx.kioskDevice.create({
      data: {
        label: nombre,
        storeLocation: c.tienda,
        odooPartnerId: c.odooPartnerId,
        odooCompanyId: c.odooCompanyId,
        odooWarehouseId: c.odooWarehouseId,
        tokenHash: hash,
        appVersion: datos.version?.slice(0, 20) || null,
        lastSeenAt: ahora,
      },
      select: { id: true },
    });
    await tx.kioskCodigo.update({ where: { id: c.id }, data: { deviceId: fila.id } });
    return { token, nombre, conExistencias: c.odooWarehouseId !== null };
  });
}

/** El código de los revisores, sin el código: ese solo se ve al crearlo. */
export async function codigoRevision(): Promise<CodigoRevision> {
  const f = await prisma.kioskCodigo.findFirst({
    where: { reutilizable: true, revocadoEn: null },
    select: { id: true, createdAt: true, usos: true, usadoEn: true, device: { select: { createdAt: true } } },
    orderBy: { createdAt: 'desc' },
  });
  if (!f) return null;
  return { id: f.id, creadoEn: f.createdAt.toISOString(), usos: f.usos, ultimoUso: f.device?.createdAt.toISOString() ?? null };
}

/** Uno nuevo para los revisores de Apple y Google. El anterior deja de valer. */
export async function nuevoCodigoRevision(creadoPor: string, ahora = new Date()): Promise<CodigoTablet> {
  await revocarCodigoRevision(ahora);
  return crearCodigo({ nombre: 'Revisión de tiendas de apps', tienda: 'Revisión de tiendas de apps', reutilizable: true }, creadoPor, ahora);
}

/**
 * Revoca el código de los revisores. Las tablets que ya entraron con él siguen
 * hasta que se desactiven en la lista.
 */
export async function revocarCodigoRevision(ahora = new Date()): Promise<number> {
  const r = await prisma.kioskCodigo.updateMany({ where: { reutilizable: true, revocadoEn: null }, data: { revocadoEn: ahora } });
  return r.count;
}

// ─────────────────────────────────────────────────────────────────────────────
// Autenticación de la tablet
// ─────────────────────────────────────────────────────────────────────────────

export interface KioscoAutenticado {
  deviceId: string;
  /** `null`: una tablet sin almacén, que enseña solo compatibilidades. */
  almacen: AlmacenCliente | null;
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

  const almacen =
    fila.odooCompanyId !== null && fila.odooWarehouseId !== null ? { companyId: fila.odooCompanyId, warehouseId: fila.odooWarehouseId } : null;
  return { deviceId: fila.id, almacen };
}
