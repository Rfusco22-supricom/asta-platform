import { prisma } from '../config/prisma.js';

/**
 * Notas del vendedor sobre un cliente (issue #24).
 *
 * ── Por qué viven aquí y no en Odoo ──────────────────────────────────────────
 *
 * Son datos operativos del panel, no del ERP. Meterlas en el chatter de Odoo
 * obligaría a dar licencia a cada vendedor y llenaría de ruido el historial del
 * cliente, que se usa para otra cosa.
 *
 * ── Quién ve qué ─────────────────────────────────────────────────────────────
 *
 * Las notas de un cliente las ve quien puede ver ese cliente: su vendedor y el
 * administrador. El control lo aplica `autorizar('cliente.perfil.ver')` con
 * ámbito `partner-propio` ANTES de llegar aquí, así que este servicio no repite
 * la comprobación — pero tampoco debe llamarse sin ella.
 *
 * Borrar es SUAVE (`deleted_at`). Una nota es el rastro de una conversación con
 * un cliente; si alguien la borra por error, recuperarla importa. Y si alguien
 * la borra a propósito para tapar algo, también.
 */

export interface Nota {
  id: string;
  texto: string;
  autorNombre: string;
  autorId: string | null;
  creadoEn: string;
  /** true si la escribió quien está mirando: solo esas se pueden borrar. */
  esMia: boolean;
}

export const LARGO_MAXIMO = 4000;

export async function listarNotas(
  odooPartnerId: number,
  lectorId: string,
): Promise<Nota[]> {
  const filas = await prisma.clientNote.findMany({
    where: { odooPartnerId, deletedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: {
      id: true,
      body: true,
      authorName: true,
      authorId: true,
      createdAt: true,
    },
  });

  return filas.map((f) => ({
    id: f.id,
    texto: f.body,
    autorNombre: f.authorName,
    autorId: f.authorId,
    creadoEn: f.createdAt.toISOString(),
    esMia: f.authorId === lectorId,
  }));
}

export class NotaInvalida extends Error {
  readonly status = 400;
  readonly code = 'VALIDATION_ERROR';
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'NotaInvalida';
  }
}

export async function crearNota(
  odooPartnerId: number,
  autorId: string,
  texto: string,
): Promise<Nota> {
  const limpio = texto.trim();

  if (limpio.length === 0) throw new NotaInvalida('La nota está vacía.');
  if (limpio.length > LARGO_MAXIMO) {
    throw new NotaInvalida(`La nota no puede pasar de ${LARGO_MAXIMO} caracteres.`);
  }

  const autor = await prisma.appUser.findUnique({
    where: { id: autorId },
    select: { fullName: true },
  });

  const fila = await prisma.clientNote.create({
    data: {
      odooPartnerId,
      authorId: autorId,
      // Se guarda el nombre DESNORMALIZADO: si mañana el vendedor se da de baja,
      // la nota sigue diciendo quién la escribió. Un rastro anónimo no sirve.
      authorName: autor?.fullName ?? 'Usuario eliminado',
      body: limpio,
    },
    select: { id: true, body: true, authorName: true, authorId: true, createdAt: true },
  });

  return {
    id: fila.id,
    texto: fila.body,
    autorNombre: fila.authorName,
    autorId: fila.authorId,
    creadoEn: fila.createdAt.toISOString(),
    esMia: true,
  };
}

export class NotaAjena extends Error {
  readonly status = 403;
  readonly code = 'ROLE_NOT_ALLOWED';
  constructor() {
    super('Solo puedes borrar tus propias notas.');
    this.name = 'NotaAjena';
  }
}

export class NotaNoEncontrada extends Error {
  readonly status = 404;
  readonly code = 'NOT_FOUND';
  constructor() {
    super('Esa nota no existe.');
    this.name = 'NotaNoEncontrada';
  }
}

/**
 * Borra una nota (suave).
 *
 * Solo el autor, o un administrador. Un vendedor no puede borrar la nota de
 * otro: es el registro de una conversación que no tuvo él, y en una cartera
 * que cambia de manos ese historial es justo lo que hay que conservar.
 */
export async function borrarNota(
  notaId: string,
  solicitanteId: string,
  esAdmin: boolean,
): Promise<void> {
  const nota = await prisma.clientNote.findUnique({
    where: { id: notaId },
    select: { id: true, authorId: true, deletedAt: true },
  });

  if (!nota || nota.deletedAt) throw new NotaNoEncontrada();
  if (!esAdmin && nota.authorId !== solicitanteId) throw new NotaAjena();

  await prisma.clientNote.update({
    where: { id: notaId },
    data: { deletedAt: new Date() },
  });
}
