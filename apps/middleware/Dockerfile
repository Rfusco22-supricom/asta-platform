# =============================================================================
# ASTA — Middleware
#
#   docker build -f apps/middleware/Dockerfile -t asta-middleware .
#
# OJO: se construye desde la RAÍZ del repositorio, no desde esta carpeta. Es un
# monorepo de pnpm y el build necesita ver el workspace entero.
# En EasyPanel: "Build context" = raíz, "Dockerfile path" = apps/middleware/Dockerfile
# =============================================================================

# ── 1. Dependencias y compilación ────────────────────────────────────────────
FROM node:22-slim AS build

# `openssl` lo necesita el motor de Prisma. Sin él, el cliente falla al arrancar
# con un error que no menciona OpenSSL por ningún lado y cuesta media hora.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

# node:22, no 20. `packageManager` fija pnpm 11.20.0 y esa version exige
# Node >= 22.13: con la imagen de 20 el build muere en `pnpm install` con
# "No such built-in module: node:sqlite", que no menciona ni a pnpm ni a Node.
RUN corepack enable

WORKDIR /app

# Los manifiestos primero, el código después: así el caché de capas de Docker
# solo se invalida cuando cambian las dependencias, no en cada commit.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/middleware/package.json    apps/middleware/
COPY apps/web/package.json           apps/web/
COPY packages/shared-types/package.json packages/shared-types/
COPY prisma/schema.prisma            prisma/

RUN pnpm install --frozen-lockfile

COPY packages/shared-types packages/shared-types
COPY apps/middleware       apps/middleware
COPY prisma                prisma

RUN pnpm --filter @asta/middleware exec prisma generate --schema ../../prisma/schema.prisma
RUN pnpm --filter @asta/middleware build

# ── 2. Imagen final ──────────────────────────────────────────────────────────
#
# Solo el bundle y las dependencias nativas. El código compartido va DENTRO del
# bundle (ver apps/middleware/build.mjs), así que aquí no hace falta ni el
# workspace ni TypeScript ni las herramientas de build.
FROM node:22-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production

# `@prisma/client` y `@node-rs/argon2` traen binarios compilados por plataforma y
# NO se pueden empaquetar: esbuild se lleva el JavaScript y deja atrás el `.node`
# que ese JavaScript busca. Se copian ya resueltos para Linux desde la etapa de
# build — que no es lo mismo que los de la máquina de desarrollo.
COPY --from=build /app/node_modules/.pnpm            /app/node_modules/.pnpm
COPY --from=build /app/apps/middleware/node_modules  /app/node_modules
COPY --from=build /app/apps/middleware/dist          /app/dist

# Las migraciones NO se aplican al arrancar, a propósito: eso le daría DDL al
# contenedor de la aplicación, que es justo lo que evita `asta_app` (#44). Se
# aplican a mano con `asta_migrador` en una ventana controlada.
# Se copia el esquema solo para poder ejecutar `migrate deploy` desde aquí si se
# entra al contenedor con las credenciales del migrador.
COPY --from=build /app/prisma /app/prisma

# Sin privilegios. La imagen de node ya trae el usuario `node`.
USER node

EXPOSE 3001

# Sin `npm start` ni `pnpm start` por medio: un proceso de más entre el init del
# contenedor y el servidor hace que las señales no lleguen, y el cierre ordenado
# que hay en server.ts (SIGTERM, drenar peticiones) deja de ejecutarse.
CMD ["node", "dist/server.js"]
