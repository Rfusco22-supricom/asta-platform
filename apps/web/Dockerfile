# =============================================================================
# ASTA — Panel de vendedores (Next.js)
#
#   docker build -f apps/web/Dockerfile -t asta-web .
#
# OJO: se construye desde la RAÍZ del repositorio, no desde esta carpeta.
# En EasyPanel: "Build context" = raíz, "Dockerfile path" = apps/web/Dockerfile
# =============================================================================

FROM node:20-slim AS build

RUN corepack enable
WORKDIR /app

# Manifiestos primero: el caché de capas solo se invalida cuando cambian las
# dependencias, no en cada commit.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json           apps/web/
COPY apps/middleware/package.json    apps/middleware/
COPY packages/shared-types/package.json packages/shared-types/
COPY prisma/schema.prisma            prisma/

# El `postinstall` de la raíz llama a `prisma generate`. El panel no usa Prisma
# —habla con el middleware por HTTP— pero el script corre igual, así que el
# esquema tiene que estar presente o la instalación falla.
RUN pnpm install --frozen-lockfile

COPY packages/shared-types packages/shared-types
COPY apps/web              apps/web

# `standalone` está detrás de esta variable a propósito: crea enlaces
# simbólicos, y en Windows el build falla con EPERM. Encenderlo siempre rompería
# `pnpm build` en las máquinas del equipo para servir solo a este contenedor.
ENV BUILD_STANDALONE=1

# NEXT_TELEMETRY_DISABLED: un build de producción no tiene por qué llamar a
# casa. Y en un contenedor sin salida a internet, el intento añade latencia.
ENV NEXT_TELEMETRY_DISABLED=1

RUN pnpm --filter @asta/web build

# ── Imagen final ─────────────────────────────────────────────────────────────
FROM node:20-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# `standalone` trae SOLO lo que la aplicación usa de verdad, con su propio
# servidor dentro. La alternativa es copiar el `node_modules` completo: cientos
# de megas que en su mayoría son herramientas de desarrollo.
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static     ./apps/web/.next/static
COPY --from=build /app/apps/web/public           ./apps/web/public

USER node

EXPOSE 3000
ENV PORT=3000
# Sin esto, el servidor de Next escucha solo en localhost y el contenedor no
# responde desde fuera aunque el puerto esté publicado.
ENV HOSTNAME=0.0.0.0

# La ruta lleva `apps/web` porque `outputFileTracingRoot` apunta a la raíz del
# monorepo, y `standalone` reproduce esa estructura dentro de la imagen.
CMD ["node", "apps/web/server.js"]
