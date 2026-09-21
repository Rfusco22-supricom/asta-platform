import type { PublicCompatibleItem } from '@asta/shared-types';
import { prisma } from '../../config/prisma.js';

/**
 * Telemetría del recomendador (#43): qué buscan los clientes, qué impresora
 * eligen, qué producto tocan y cuándo no había existencias.
 *
 * El issue lo dice: esta data no se reconstruye después. Cada día sin registrar
 * es información perdida sobre qué impresoras tiene el mercado.
 *
 * ── Una fila por búsqueda ────────────────────────────────────────────────────
 *
 * `recommendation_events` tiene una fila con la búsqueda, la impresora elegida,
 * los resultados, el producto pulsado y si estaba agotado: el embudo entero.
 * La API no tiene sesión, así que la búsqueda devuelve su `busquedaId` y los
 * dos pasos siguientes lo mandan de vuelta:
 *
 *   GET  /recommender/printers?q=…                       → crea la fila, devuelve busquedaId
 *   GET  /recommender/printers/{id}/compatible?busquedaId → impresora elegida, agotado
 *   POST /recommender/busquedas/{busquedaId}/clic         → producto pulsado
 *
 * ── Lo que anota el servidor y lo que no ─────────────────────────────────────
 *
 * La búsqueda, sus resultados y el "agotado" los anota QUIEN RESPONDE: no se
 * pueden falsear desde el cliente. Solo el clic lo tiene que avisar el cliente,
 * porque ocurre en su pantalla.
 *
 * Una consulta de compatibles SIN `busquedaId` (una integración que ya sabe su
 * impresora) también se registra, en una fila propia con `search_query` vacío.
 * Una búsqueda real nunca lo está: el mínimo son 2 caracteres.
 *
 * ── Qué puede tocar cada uno ─────────────────────────────────────────────────
 *
 * Una fila solo la completa el MISMO usuario que la creó, y solo durante
 * `VENTANA_MS`. Sin lo primero, una key podría escribir en las búsquedas de otro
 * cliente; sin lo segundo, podría reescribir la historia semanas después.
 *
 * ── Nunca tumba una petición ─────────────────────────────────────────────────
 *
 * Si escribir falla, se avisa por log y la respuesta sigue. Perder una fila de
 * telemetría es malo; perder la búsqueda del cliente, peor.
 */

/** Durante cuánto se puede completar una búsqueda después de hacerla. */
export const VENTANA_MS = 30 * 60_000;

const MAX_CONSULTA = 200;

type Log = { warn: (obj: object, msg: string) => void } | undefined;

/** `busquedaId` viaja como texto: es un BIGINT, y en JSON un número así pierde precisión. */
export function leerBusquedaId(valor: unknown): bigint | null {
  if (typeof valor !== 'string' || !/^[1-9]\d{0,18}$/.test(valor)) return null;
  return BigInt(valor);
}

/** Crea la fila de una búsqueda. Devuelve su id, o `null` si no se pudo escribir. */
export async function registrarBusqueda(
  datos: { userId: string; consulta: string; coincidencias: number[] },
  log?: Log,
): Promise<string | null> {
  try {
    const fila = await prisma.recommendationEvent.create({
      data: {
        userId: datos.userId,
        // CRUDA: los errores de tipeo son el dato. Solo se recorta a la columna.
        searchQuery: datos.consulta.slice(0, MAX_CONSULTA),
        resultsCount: Math.min(datos.coincidencias.length, 65_535),
        // Con una sola coincidencia, la impresora es esa aunque el cliente no la
        // "elija": se anota ya, y se corrige si después elige otra.
        matchedPrinterId: datos.coincidencias.length === 1 ? datos.coincidencias[0] : null,
      },
      select: { id: true },
    });
    return fila.id.toString();
  } catch (error) {
    log?.warn({ err: String(error) }, 'telemetría: no se pudo registrar la búsqueda');
    return null;
  }
}

/**
 * Quiebre de venta: había productos compatibles y NINGUNO con existencia.
 * Sin productos no hay quiebre, hay falta de datos (`sinCompatibilidadesCargadas`).
 */
export function hayQuiebre(items: PublicCompatibleItem[]): boolean {
  return items.length > 0 && items.every((i) => i.stock === 'agotado');
}

/**
 * Anota la impresora elegida. Con `busquedaId`, en esa fila; sin él, en una fila
 * propia de consulta directa.
 *
 * `soloDisponibles` falsea el quiebre —los agotados no vienen—, así que con él
 * no se afirma quiebre ni ausencia de quiebre: se deja lo que hubiera.
 */
export async function registrarConsulta(
  datos: { userId: string; busquedaId: bigint | null; printerId: number; items: PublicCompatibleItem[]; soloDisponibles: boolean },
  log?: Log,
  ahora = new Date(),
): Promise<void> {
  const quiebre = datos.soloDisponibles ? undefined : hayQuiebre(datos.items);
  try {
    if (datos.busquedaId !== null) {
      const { count } = await prisma.recommendationEvent.updateMany({
        where: { id: datos.busquedaId, userId: datos.userId, searchQuery: { not: '' }, createdAt: { gte: new Date(ahora.getTime() - VENTANA_MS) } },
        data: { matchedPrinterId: datos.printerId, ...(quiebre === undefined ? {} : { wasOutOfStock: quiebre }) },
      });
      if (count === 1) return;
      // Ajena, caducada o inexistente: no se toca, y la consulta cuenta como directa.
      log?.warn({ busquedaId: datos.busquedaId.toString() }, 'telemetría: busquedaId no válido para esta key; se registra como consulta directa');
    }
    await prisma.recommendationEvent.create({
      data: { userId: datos.userId, searchQuery: '', matchedPrinterId: datos.printerId, wasOutOfStock: quiebre ?? false },
    });
  } catch (error) {
    log?.warn({ err: String(error) }, 'telemetría: no se pudo registrar la consulta de compatibles');
  }
}

/**
 * Anota el producto pulsado. `false` si la búsqueda no existe, es de otro o
 * caducó: el controlador responde lo mismo en los tres casos.
 */
export async function registrarClic(
  datos: { userId: string; busquedaId: bigint; productId: number },
  ahora = new Date(),
): Promise<boolean> {
  const { count } = await prisma.recommendationEvent.updateMany({
    where: { id: datos.busquedaId, userId: datos.userId, createdAt: { gte: new Date(ahora.getTime() - VENTANA_MS) } },
    data: { clickedProductId: datos.productId },
  });
  return count === 1;
}
