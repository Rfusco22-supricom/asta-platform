#!/usr/bin/env bash
#
# Crea los issues de autenticacion propia, que aparecen al salir de Supabase.
#
#   Uso:  bash scripts/add-auth-issues.sh owner/repo
#
# Corre una sola vez: crearia duplicados si se repite.

set -euo pipefail
REPO="${1:?Uso: bash scripts/add-auth-issues.sh owner/repo}"

MILESTONE="Fase 2 - Identidad y sincronizacion"
LABELS="area:middleware,tipo:seguridad,track:A-core-vendedores"
ASSIGNEE="Rfusco22-supricom"

mk() {
  local title="$1"
  local url
  url=$(gh issue create --repo "$REPO" --title "$title" \
        --milestone "$MILESTONE" --label "$LABELS" --assignee "$ASSIGNEE" --body-file -)
  echo "    $title"
  echo "      $url"
}

echo "==> Creando issues de autenticacion propia en $REPO"

mk "AUTH: login con Argon2id y bloqueo por fuerza bruta" <<'BODY'
## Por que existe este issue

Supabase Auth se encargaba del login. Al pasar a MySQL, esa responsabilidad es
del middleware. Las tablas ya estan (`user_credentials`).

## Tareas

- [ ] `POST /auth/login` con email + contrasena
- [ ] Hash **Argon2id** con los parametros de `.env`
      (`ARGON2_MEMORY_KIB=19456`, `ITERATIONS=2`, `PARALLELISM=1` — recomendacion OWASP)
- [ ] Guardar el string PHC completo: ya incluye sal y parametros, no hace falta
      columna de sal
- [ ] Contador `failed_attempts` + `locked_until` tras N intentos
- [ ] `must_change` fuerza el cambio en el siguiente login
- [ ] Registrar los intentos fallidos en `audit_logs`

## Por que Argon2id y no HMAC

Es lo contrario del caso de las API keys. Una contrasena humana tiene poca
entropia y existen diccionarios, asi que hace falta un KDF **lento** a proposito.
Una API key son 32 bytes de CSPRNG: ahi un HMAC basta y bcrypt solo costaria
100 ms por request.

**No usar SHA-256 ni MD5 para esto bajo ningun concepto.**

## Detalle que importa

El bloqueo se cuenta **por usuario, no por IP**. Un atacante rota IPs con
facilidad; la cuenta objetivo sigue siendo la misma.

Y el mensaje de error es el mismo para "email no existe" y "contrasena
incorrecta": si no, el formulario se convierte en un verificador de qué correos
tienen cuenta.
BODY

mk "AUTH: emision, rotacion y revocacion de JWT" <<'BODY'
## Por que existe este issue

Lo emitia Supabase. Ahora el middleware firma sus propios tokens. Tabla
`user_sessions` ya creada.

## Tareas

- [ ] Access token JWT de vida corta (`JWT_ACCESS_TTL=15m`), firmado con
      `JWT_SECRET`. **No se guarda**: se valida por firma y caduca solo
- [ ] Refresh token de vida larga (`JWT_REFRESH_TTL=30d`). Se guarda **solo el
      hash SHA-256** en `user_sessions`
- [ ] `POST /auth/refresh` con **rotacion**: cada uso emite uno nuevo y revoca el
      anterior (`revoked_reason = 'rotated'`)
- [ ] Deteccion de reuso: si llega un refresh token ya rotado, revocar **toda**
      la familia de sesiones de ese usuario. Es la senal clasica de token robado
- [ ] `POST /auth/logout` revoca la sesion actual
- [ ] Cambiar la contrasena revoca todas las sesiones
      (`revoked_reason = 'password_changed'`)
- [ ] Pantalla de "sesiones activas" con opcion de cerrarlas

## Detalle que importa

Se guarda el hash y no el token: quien lea `user_sessions` no puede suplantar a
nadie.
BODY

mk "AUTH: reseteo de contrasena por email" <<'BODY'
## Por que existe este issue

El flujo de "olvide mi contrasena" lo cubria Supabase, correo incluido. Ahora
hace falta SMTP propio (`SMTP_*` en `.env`). Tabla `auth_tokens` ya creada.

## Tareas

- [ ] `POST /auth/forgot-password`: crea `auth_tokens` con
      `purpose = 'PASSWORD_RESET'` y envia el enlace
- [ ] Caducidad corta (sugerido: 1 hora) y **un solo uso** (`used_at`)
- [ ] `POST /auth/reset-password`: valida el token y actualiza el hash
- [ ] Al resetear, revocar todas las sesiones activas del usuario
- [ ] Verificacion de email en el alta (`purpose = 'EMAIL_VERIFY'`)
- [ ] Plantillas de correo: invitacion, reseteo, verificacion
- [ ] Rate limit del endpoint: si no, es un canon de spam contra terceros

## Detalle que importa

**La respuesta es siempre la misma**, exista o no el email:
*"Si esa direccion tiene cuenta, recibiras un correo."*

Responder distinto convierte el formulario en un verificador de qué correos
estan registrados, que es justo lo que busca quien prepara un phishing.

Se guarda el hash del token, no el token que viaja por email.
BODY

mk "AUTH: CLI para establecer la contrasena del SuperAdmin inicial" <<'BODY'
## Por que existe este issue

`db/mysql/002_seed.sql` crea el SuperAdmin **sin contrasena**, a proposito: poner
un hash de ejemplo en un archivo versionado es dejar la llave bajo el felpudo —
acaba en produccion porque nadie se acordo de cambiarla.

Hace falta la herramienta que cierra ese hueco.

## Tareas

- [ ] `apps/middleware/src/cli/set-password.ts`
- [ ] Uso: `pnpm --filter @asta/middleware exec tsx src/cli/set-password.ts <email>`
- [ ] Pide la contrasena por stdin **sin eco en pantalla**
- [ ] Exige una longitud minima razonable y avisa si es debil
- [ ] Genera el hash Argon2id y hace upsert en `user_credentials`
- [ ] Marca `must_change = true` si lo usa un admin sobre otra cuenta
- [ ] Registra la accion en `audit_logs`

## Que NO debe hacer

- No aceptar la contrasena como argumento de linea de comandos: queda en el
  historial del shell y en la lista de procesos
- No imprimirla nunca, ni siquiera al confirmar
BODY

echo ""
echo "==> Listo. 4 issues de autenticacion creados."
