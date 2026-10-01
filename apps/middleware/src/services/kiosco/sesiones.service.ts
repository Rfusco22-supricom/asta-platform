import { prisma } from '../../config/prisma.js';

/**
 * Cierre de las sesiones de kiosco vencidas (#41).
 *
 * La app cierra la sesión sola a los cuatro minutos, pero eso ocurre EN LA
 * TABLET: si se queda sin batería, sin red o alguien la apaga con una sesión
 * abierta, la fila se queda abierta para siempre. Y una sesión abierta es una
 * sesión que alguien podría dar por válida más tarde.
 *
 * Por eso el servidor también las cierra, sin fiarse del dispositivo. Es la
 * misma idea que `expires_at`: la fecha manda, no lo que diga el cliente.
 *
 * Solo escribe en filas ya vencidas y todavía abiertas. Las que cerró la tablet
 * no se tocan: su `ended_reason` dice por qué se cerró de verdad, y eso es el
 * dato.
 */

/** Por qué se cerró. Los valores que ya documenta `001_schema.sql`. */
export const MOTIVO_VENCIDA = 'timeout';

export async function cerrarSesionesVencidas(ahora = new Date()): Promise<number> {
  const { count } = await prisma.kioskSession.updateMany({
    where: { endedAt: null, expiresAt: { lte: ahora } },
    data: { endedAt: ahora, endedReason: MOTIVO_VENCIDA },
  });
  return count;
}

export interface SesionesAbiertas {
  abiertas: number;
  /** Abiertas y ya vencidas: si sale > 0 después del job, algo no está corriendo. */
  vencidas: number;
}

export async function contarSesiones(ahora = new Date()): Promise<SesionesAbiertas> {
  const [abiertas, vencidas] = await Promise.all([
    prisma.kioskSession.count({ where: { endedAt: null } }),
    prisma.kioskSession.count({ where: { endedAt: null, expiresAt: { lte: ahora } } }),
  ]);
  return { abiertas, vencidas };
}
