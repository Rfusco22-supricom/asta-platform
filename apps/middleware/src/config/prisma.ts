import { PrismaClient } from '@prisma/client';
import { env } from './env.js';

/**
 * Cliente Prisma único por proceso. En desarrollo se guarda en `globalThis` para
 * que el hot-reload no deje una fuga de conexiones abiertas contra el pooler.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: env.NODE_ENV === 'development' ? ['query', 'warn', 'error'] : ['warn', 'error'],
  });

if (env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
