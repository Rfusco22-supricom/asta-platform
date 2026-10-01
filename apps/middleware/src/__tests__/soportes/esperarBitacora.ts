import { prisma } from '../../config/prisma.js';

/**
 * Espera a que dejen de llegar filas a `api_request_logs` desde `desde`.
 *
 * `registroPeticiones` escribe la fila DESPUÉS de responder (en `finish`), así
 * que las últimas peticiones de un fichero pueden llegar a la base después de
 * su `deleteMany`. Esas filas huérfanas caen en la ventana de 15 minutos de
 * `alerts.test.ts`, que cuenta todo el tráfico, y lo hacen fallar según el orden
 * en que corran los ficheros: pasó una vez con «10 de 37» donde esperaba «10 de 30».
 *
 * Se da por terminado cuando dos lecturas seguidas, separadas por `pausaMs`,
 * cuentan lo mismo.
 */
export async function esperarBitacora(desde: Date, pausaMs = 250, intentos = 20): Promise<void> {
  let anterior = -1;
  for (let i = 0; i < intentos; i++) {
    const n = await prisma.apiRequestLog.count({ where: { createdAt: { gte: desde } } });
    if (n === anterior) return;
    anterior = n;
    await new Promise((r) => setTimeout(r, pausaMs));
  }
}
