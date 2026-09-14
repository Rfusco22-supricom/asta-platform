import { PrismaClient } from '@prisma/client';

/**
 * Cliente Prisma único por proceso. En desarrollo se guarda en `globalThis` para
 * que el hot-reload no deje una fuga de conexiones abiertas contra el pooler.
 *
 * ── Por qué aquí se lee `process.env.NODE_ENV` a pelo ────────────────────────
 *
 * Antes esto llamaba a `env()` al importarse, y ese detalle tenía una
 * consecuencia fea: `env()` lanza si falta CUALQUIER variable, y este módulo lo
 * arrastra media aplicación, así que el proceso moría aquí —con una traza de
 * pila cruda y el nombre de una sola variable— antes de que el comprobador de
 * entorno del arranque (#9) llegara a ejecutarse. El resultado era el contrario
 * del que se buscaba: un stack trace en vez de la lista de todo lo que falta.
 *
 * `NODE_ENV` aquí solo elige cuánto habla el log. No merece atar el arranque
 * entero a la validación, y su ausencia ya tiene un valor por defecto sensato en
 * el schema. La validación de verdad ocurre donde toca: en
 * `exigirEntornoValido()`, antes de abrir el puerto.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const entorno = process.env.NODE_ENV ?? 'development';

/**
 * El registro de CADA consulta es opt-in, no el comportamiento de desarrollo.
 *
 * Antes se activaba solo con NODE_ENV=development, y eso ahogaba todo lo demás:
 * cualquier script de línea de comandos —`alertas`, `check:grants`,
 * `reconciliación`— escupía veinte líneas de SQL antes de su informe, y el log
 * del servidor en desarrollo era casi todo consultas.
 *
 * Ver el SQL es una herramienta de depuración concreta, no algo que se quiera
 * siempre. Se enciende cuando hace falta:
 *
 *   PRISMA_LOG_QUERIES=1 pnpm dev:middleware
 */
const registrarConsultas = process.env.PRISMA_LOG_QUERIES === '1';

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: registrarConsultas ? ['query', 'warn', 'error'] : ['warn', 'error'],
  });

if (entorno !== 'production') globalForPrisma.prisma = prisma;
