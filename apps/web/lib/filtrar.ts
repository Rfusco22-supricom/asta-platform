import { NextResponse } from 'next/server';
import { cuerpoFiltrado } from './filtrarCuerpo';
import type { z } from 'zod';

/**
 * Lo que un puente del CLIENTE devuelve al navegador: solo lo que dice el
 * contrato. La regla está en `filtrarCuerpo.ts` (sin Next, para probarla).
 */
export async function respuestaFiltrada(res: Response, exito: z.ZodType, datosDelError?: z.ZodType): Promise<NextResponse> {
  if (res.status === 204) return new NextResponse(null, { status: 204 });
  const body: unknown = await res.json().catch(() => null);
  const r = cuerpoFiltrado(res.status, body, exito, datosDelError);
  if (r.descartado) console.error(`[filtrar] la respuesta de ${res.url} no encaja con su esquema`, r.descartado);
  return NextResponse.json(r.body, { status: r.status });
}
