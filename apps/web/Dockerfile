# =============================================================================
# ASTA — Panel de vendedores (Next.js)
#
#   docker build -f apps/web/Dockerfile -t asta-web .
#
# OJO: se construye desde la RAÍZ del repositorio, no desde esta carpeta.
# En EasyPanel: "Build context" = raíz, "Dockerfile path" = apps/web/Dockerfile
# =============================================================================

FROM node:22-slim AS build

# `openssl` no lo necesita el panel para funcionar —no habla con MySQL— pero sí
# el `postinstall` de la raíz, que ejecuta `prisma generate`. Sin él la
# construcción escupe seis avisos de Prisma sobre libssl que no significan nada
# aquí y hacen dudar de un build que está bien.
RUN apt-get update && apt-get install -y --no-install-recommends openssl     && rm -rf /var/lib/apt/lists/*

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
FROM node:22-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# `standalone` trae SOLO lo que la aplicación usa de verdad, con su propio
# servidor dentro. La alternativa es copiar el `node_modules` completo: cientos
# de megas que en su mayoría son herramientas de desarrollo.
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static     ./apps/web/.next/static

# No se copia `apps/web/public`: este proyecto NO tiene esa carpeta.
#
# Casi todos los proyectos de Next la traen y por eso se dio por hecha, pero
# aquí el único estático es el favicon, y en App Router vive en `app/icon.svg`
# —Next lo sirve como una ruta más y acaba dentro del build—. Un `COPY` de una
# ruta que no existe no se ignora: rompe la construcción entera.
#
# Si algún día se añade `apps/web/public`, hay que volver a poner:
#   COPY --from=build /app/apps/web/public ./apps/web/public

USER node

EXPOSE 3000
ENV PORT=3000

# ── HOSTNAME se fija AQUÍ, no con un ENV ─────────────────────────────────────
#
# El servidor que genera `standalone` hace literalmente:
#
#     const hostname = process.env.HOSTNAME || '0.0.0.0'
#
# y Docker rellena `HOSTNAME` por su cuenta con el identificador del contenedor.
# Ese valor GANA sobre un `ENV HOSTNAME` del Dockerfile, así que Next acababa
# escuchando en la dirección del propio contenedor en vez de en todas las
# interfaces.
#
# El síntoma engaña: el contenedor arranca, consume memoria y aparece sano, pero
# el proxy no lo alcanza y el dominio responde "Service is not reachable". No hay
# ningún error en su log — desde dentro todo va bien.
#
# `exec` es importante: reemplaza a la shell en vez de dejarla de padre, así el
# SIGTERM del contenedor llega a Node y el cierre es ordenado.
#
# La ruta lleva `apps/web` porque `outputFileTracingRoot` apunta a la raíz del
# monorepo, y `standalone` reproduce esa estructura dentro de la imagen.
CMD ["sh", "-c", "HOSTNAME=0.0.0.0 exec node apps/web/server.js"]
