import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../config/dotenv.js';
import { prisma } from '../config/prisma.js';
import { cerrarSesionesVencidas, contarSesiones, MOTIVO_VENCIDA } from '../services/kiosco/sesiones.service.js';

/**
 * #41 · El servidor cierra las sesiones de kiosco vencidas, contra MySQL.
 *
 * La app las cierra a los cuatro minutos, pero eso pasa EN LA TABLET. Si se
 * queda sin batería, sin red o alguien la apaga con una sesión abierta, la fila
 * no se cierra sola. Lo que se vigila aquí:
 *
 *   · una vencida y abierta se cierra, con motivo y fecha;
 *   · una que aún no venció NO se toca;
 *   · una que ya cerró la tablet conserva SU motivo: es el dato de por qué
 *     terminó de verdad;
 *   · volver a pasarlo no cambia nada.
 *
 * Aislado con un dispositivo propio, `ZZ_SES`, que se borra al terminar y se
 * lleva sus sesiones por el ON DELETE CASCADE.
 */

const ETIQUETA = 'ZZ_SES Tablet de prueba';
let deviceId = '';
let comprobado = false;
const S: Record<'vencida' | 'viva' | 'cerradaPorCliente' | 'justoAhora', string> = {
  vencida: '',
  viva: '',
  cerradaPorCliente: '',
  justoAhora: '',
};
const AHORA = new Date('2026-09-23T12:00:00Z');
const hace = (min: number) => new Date(AHORA.getTime() - min * 60_000);
const dentroDe = (min: number) => new Date(AHORA.getTime() + min * 60_000);

const sesion = (id: keyof typeof S) => prisma.kioskSession.findUniqueOrThrow({ where: { id: S[id] } });

beforeAll(async () => {
  if (await prisma.kioskDevice.count({ where: { label: ETIQUETA } })) {
    throw new Error(`Ya hay un dispositivo ${ETIQUETA}: límpialo a mano.`);
  }
  comprobado = true;

  const device = await prisma.kioskDevice.create({
    data: { label: ETIQUETA, storeLocation: 'Pruebas', tokenHash: 'f'.repeat(64), isActive: true },
  });
  deviceId = device.id;

  const crear = async (expiresAt: Date, endedAt: Date | null = null, endedReason: string | null = null) =>
    (
      await prisma.kioskSession.create({
        data: { deviceId, startedAt: hace(10), lastActivityAt: hace(10), expiresAt, endedAt, endedReason },
        select: { id: true },
      })
    ).id;

  // Abierta y vencida hace seis minutos: la tablet se apagó sin cerrarla.
  S.vencida = await crear(hace(6));
  // Abierta y con tiempo por delante: alguien la está usando.
  S.viva = await crear(dentroDe(3));
  // Ya cerrada por el cliente con «Terminar».
  S.cerradaPorCliente = await crear(hace(8), hace(9), 'logout');
  // Vence justo en el instante que se ejecuta el job: vencida es vencida.
  S.justoAhora = await crear(AHORA);
});

afterAll(async () => {
  if (comprobado && deviceId) await prisma.kioskDevice.deleteMany({ where: { id: deviceId } });
  await prisma.$disconnect();
});

describe('#41 · cerrarSesionesVencidas', () => {
  it('cierra las vencidas y abiertas, incluida la que vence en ese instante', async () => {
    const cerradas = await cerrarSesionesVencidas(AHORA);
    expect(cerradas).toBeGreaterThanOrEqual(2);

    for (const cual of ['vencida', 'justoAhora'] as const) {
      const s = await sesion(cual);
      expect([s.endedReason, s.endedAt?.toISOString()], cual).toEqual([MOTIVO_VENCIDA, AHORA.toISOString()]);
    }
  });

  it('no toca la que sigue viva', async () => {
    const s = await sesion('viva');
    expect([s.endedAt, s.endedReason]).toEqual([null, null]);
  });

  it('respeta el motivo de la que cerró el cliente', async () => {
    const s = await sesion('cerradaPorCliente');
    expect([s.endedReason, s.endedAt?.toISOString()]).toEqual(['logout', hace(9).toISOString()]);
  });

  it('volver a pasarlo no cambia nada', async () => {
    const antes = await sesion('vencida');
    expect(await cerrarSesionesVencidas(AHORA)).toBe(0);
    expect((await sesion('vencida')).endedAt?.toISOString()).toBe(antes.endedAt?.toISOString());
  });

  it('cuando la viva vence, el siguiente pase la cierra', async () => {
    const despues = new Date(AHORA.getTime() + 10 * 60_000);
    expect(await cerrarSesionesVencidas(despues)).toBe(1);
    const s = await sesion('viva');
    expect([s.endedReason, s.endedAt?.toISOString()]).toEqual([MOTIVO_VENCIDA, despues.toISOString()]);
  });
});

describe('#41 · contarSesiones', () => {
  it('dice cuántas quedan abiertas y cuántas de esas están vencidas', async () => {
    const abierta = await prisma.kioskSession.create({
      data: { deviceId, expiresAt: new Date(Date.now() + 60_000) },
      select: { id: true },
    });
    const vencida = await prisma.kioskSession.create({
      data: { deviceId, expiresAt: new Date(Date.now() - 60_000) },
      select: { id: true },
    });

    const c = await contarSesiones();
    expect(c.abiertas).toBeGreaterThanOrEqual(2);
    expect(c.vencidas).toBeGreaterThanOrEqual(1);

    // Y tras cerrar, las vencidas de este dispositivo desaparecen de la cuenta.
    await cerrarSesionesVencidas();
    const s = await prisma.kioskSession.findUniqueOrThrow({ where: { id: vencida.id } });
    expect(s.endedReason).toBe(MOTIVO_VENCIDA);
    expect((await prisma.kioskSession.findUniqueOrThrow({ where: { id: abierta.id } })).endedAt).toBeNull();
  });
});
