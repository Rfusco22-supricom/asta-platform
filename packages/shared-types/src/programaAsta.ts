import { z } from 'zod';
import { montoSchema, odooIdSchema } from './common.js';
import { claveCategoriaSchema, reglaDe, type ClaveCategoria } from './categoriasAsta.js';

/**
 * El programa de niveles de ASTA por trimestres (decidido con Supricom el
 * 2026-10-27). Sustituye a la categoría de los cuatro últimos meses (#131):
 * ahora el nivel cambia una vez por trimestre de calendario, y el cliente
 * acumula tokens por cumplir.
 *
 * ── Al cerrar cada trimestre ─────────────────────────────────────────────────
 *
 * Se mira al cliente contra las cuotas de SU nivel (un Cliente general, contra
 * las de Bronce). Tres obligatorios, 4 tokens cada uno:
 *
 *   · cuota mensual    — los tres meses compró al menos su mínimo mensual;
 *   · cuota trimestral — en el trimestre, al menos 3 × su mínimo mensual;
 *   · sell-out         — reportó los tres meses, cada uno antes del día
 *                        `DIA_LIMITE_SELLOUT` del mes siguiente.
 *
 * Cumple los tres: sube un nivel (Diamante se queda). Falla alguno: baja uno
 * (Cliente general se queda). De uno en uno, aunque compre para más.
 *
 * Y tres extras, 1 token cada uno, que no mueven el nivel:
 *
 *   · excedente — su compra media mensual del trimestre pasa de
 *                 `EXCEDENTE[nivel]` × su mínimo mensual;
 *   · racha     — no falló ningún mes ni este trimestre ni el anterior;
 *   · variedad  — compró al menos `VARIEDAD` de las referencias ASTA que vendemos.
 *
 * Los tokens se acumulan y no caducan. Las reglas viven solo aquí.
 */

export const TOKENS = { mensual: 4, trimestral: 4, sellout: 4, excedente: 1, racha: 1, variedad: 1 } as const;
export type ConceptoToken = keyof typeof TOKENS;

/** Cuánto por encima de su mínimo mensual hay que comprar para el token de excedente. */
export const EXCEDENTE: Record<ClaveCategoria, number> = { GENERAL: 1.5, BRONCE: 1.5, PLATA: 1.4, ORO: 1.3, DIAMANTE: 1.2 };

/** La parte de las referencias ASTA que hay que comprar en el trimestre para el token de variedad. */
export const VARIEDAD = 0.2;

/** El sell-out de un mes vale si se reporta antes de este día del mes siguiente (incluido). */
export const DIA_LIMITE_SELLOUT = 10;

/** El primer trimestre del programa: el nivel de partida es la categoría de antes al empezarlo. */
export const PRIMER_TRIMESTRE = '2026-Q4';

export const trimestreSchema = z.string().regex(/^\d{4}-Q[1-4]$/);

/** De abajo arriba: el orden en que se sube. */
export const ESCALERA: readonly ClaveCategoria[] = ['GENERAL', 'BRONCE', 'PLATA', 'ORO', 'DIAMANTE'];

/** «2026-11-03» → «2026-Q4». */
export function trimestreDe(fecha: string | Date): string {
  const iso = typeof fecha === 'string' ? fecha : fecha.toISOString();
  const [a, m] = iso.slice(0, 7).split('-').map(Number) as [number, number];
  return `${a}-Q${Math.ceil(m / 3)}`;
}

/** «2026-Q4» → ['2026-10', '2026-11', '2026-12']. */
export function mesesDelTrimestre(trimestre: string): [string, string, string] {
  const [a, q] = trimestre.split('-Q').map(Number) as [number, number];
  const mes = (i: number) => `${a}-${String((q - 1) * 3 + i).padStart(2, '0')}`;
  return [mes(1), mes(2), mes(3)];
}

/** «2026-Q1» → «2025-Q4». */
export function trimestreAnterior(trimestre: string): string {
  const [a, q] = trimestre.split('-Q').map(Number) as [number, number];
  return q === 1 ? `${a - 1}-Q4` : `${a}-Q${q - 1}`;
}

/** «2026-Q4» → «oct–dic 2026». */
export function nombreTrimestre(trimestre: string): string {
  const [a, q] = trimestre.split('-Q') as [string, string];
  return ['ene–mar', 'abr–jun', 'jul–sep', 'oct–dic'][Number(q) - 1] + ` ${a}`;
}

/** Contra qué cuotas se mira a un nivel: un Cliente general, contra las de Bronce. */
export function cuotasDe(nivel: ClaveCategoria): { mensual: number; trimestral: number } {
  const regla = reglaDe(nivel === 'GENERAL' ? 'BRONCE' : nivel);
  return { mensual: regla.minimoMensual, trimestral: regla.minimoMensual * 3 };
}

export function subir(nivel: ClaveCategoria): ClaveCategoria {
  return ESCALERA[Math.min(ESCALERA.indexOf(nivel) + 1, ESCALERA.length - 1)]!;
}

export function bajar(nivel: ClaveCategoria): ClaveCategoria {
  return ESCALERA[Math.max(ESCALERA.indexOf(nivel) - 1, 0)]!;
}

/**
 * Cómo va un mes: `null` mientras no se sabe (el mes no ha terminado, o el
 * plazo del sell-out sigue abierto).
 */
export const mesProgramaSchema = z.object({
  mes: z.string().regex(/^\d{4}-\d{2}$/),
  compra: montoSchema,
  cumpleMinimo: z.boolean().nullable(),
  /** Reportó el sell-out de ese mes dentro de plazo. */
  sellout: z.boolean().nullable(),
});

export type MesPrograma = z.infer<typeof mesProgramaSchema>;

export const evaluacionTrimestreSchema = z.object({
  trimestre: trimestreSchema,
  /** El nivel con el que empezó el trimestre: contra sus cuotas se le mira. */
  nivel: claveCategoriaSchema,
  cuotaMensual: montoSchema,
  cuotaTrimestral: montoSchema,
  meses: z.array(mesProgramaSchema).length(3),
  compraTrimestre: montoSchema,
  /** `null` si todavía no se sabe. Al cerrar, nunca es `null`. */
  obligatorios: z.object({ mensual: z.boolean().nullable(), trimestral: z.boolean().nullable(), sellout: z.boolean().nullable() }),
  extras: z.object({ excedente: z.boolean().nullable(), racha: z.boolean().nullable(), variedad: z.boolean().nullable() }),
  /** Referencias ASTA distintas que compró en el trimestre, y cuántas hay. */
  referencias: z.object({ compradas: z.number().int().nonnegative(), total: z.number().int().nonnegative() }),
  /** Los tokens que gana con lo que ya está decidido. */
  tokens: z.number().int().nonnegative(),
  /** El nivel con el que acaba (o acabaría, si el trimestre siguiera igual). */
  nivelFinal: claveCategoriaSchema,
  /** Ya no puede cambiar: el trimestre terminó y venció el plazo del sell-out. */
  definitiva: z.boolean(),
});

export type EvaluacionTrimestre = z.infer<typeof evaluacionTrimestreSchema>;

/** Un cliente en el programa: su grupo (RIF) y su evaluación del trimestre. */
export const clienteProgramaSchema = z.object({
  clave: z.string(),
  partnerId: odooIdSchema,
  nombre: z.string(),
  /** El vendedor de la ficha principal, para filtrar por cartera. */
  vendedor: z.string().nullable(),
  vendedorOdooUserId: odooIdSchema.nullable(),
  evaluacion: evaluacionTrimestreSchema,
  /** Tokens acumulados de los trimestres ya cerrados. */
  saldoTokens: z.number().int().nonnegative(),
});

export type ClientePrograma = z.infer<typeof clienteProgramaSchema>;

/** El trimestre en curso de todos los clientes del programa (o de una cartera). */
export const programaEmpresaSchema = z.object({
  trimestre: trimestreSchema,
  clientes: z.array(clienteProgramaSchema),
});

export type ProgramaEmpresa = z.infer<typeof programaEmpresaSchema>;

export const programaEmpresaRespuestaSchema = z.object({
  data: programaEmpresaSchema,
  meta: z.object({ generadoEn: z.iso.datetime(), duracionMs: z.number().int().nonnegative() }),
});
