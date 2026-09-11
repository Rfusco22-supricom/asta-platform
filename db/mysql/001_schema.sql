-- =============================================================================
-- ASTA — Esquema del Middleware · MySQL 8.0+
-- =============================================================================
--
-- Probado contra MySQL 8.0.13+ y MariaDB 10.4+.
-- Verificar con:  SELECT VERSION();
--
-- Las colaciones son deliberadamente las "de toda la vida" (utf8mb4_unicode_ci,
-- utf8mb4_general_ci) y no las modernas de MySQL 8 (utf8mb4_0900_*): estas
-- ULTIMAS NO EXISTEN EN MARIADB. Elegirlas ataria el esquema a un motor
-- concreto, y aqui el entorno de desarrollo (XAMPP/MariaDB) y el de despliegue
-- pueden no coincidir.
--
-- Convenciones de este esquema:
--
--   · Todas las fechas se guardan en UTC, en DATETIME(3).
--     NO se usa TIMESTAMP: MySQL lo convierte según la zona horaria de la sesión,
--     así que el mismo instante se lee distinto según quién pregunte. DATETIME
--     guarda lo que le pones. La aplicación escribe UTC y convierte al mostrar.
--
--   · Los UUID son CHAR(36) y no BINARY(16).
--     BINARY(16) ocupa menos y ordena mejor, pero vuelve ilegible cualquier
--     consulta manual y complica el soporte. A la escala de este sistema
--     (miles de filas, no millones) la diferencia no se nota, y poder leer un id
--     en un log vale más.
--
--   · Los UUID y `updated_at` los genera la APLICACIÓN, no la base.
--     El DDL llegó a declarar DEFAULT (UUID()) y ON UPDATE CURRENT_TIMESTAMP
--     como red de seguridad para inserciones manuales, pero eso hacía que
--     `prisma migrate diff` viera divergencia en cada tabla y quisiera
--     "corregirla". Entre una red de seguridad para un caso que no ocurre —la
--     aplicación es la única que escribe— y que las migraciones futuras sean
--     predecibles, gana lo segundo.
--
--   · Las claves foráneas están declaradas. InnoDB las respeta de verdad, y son
--     la última defensa contra datos huérfanos cuando un bug de la aplicación
--     se salta la lógica.
--
-- Aplicar:  mysql -u USUARIO -p asta < db/mysql/001_schema.sql
-- =============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 1;

-- EL SERVIDOR DEBE ESTAR EN MODO ESTRICTO.
--
-- Como los `id` los genera la aplicación y no la base, un INSERT que se olvide
-- del id SIN modo estricto no falla: crea una fila con id = '' y el error
-- aparece mucho después, al insertar la segunda. Con STRICT falla en el acto:
--     ERROR 1364: Field 'id' doesn't have a default value
--
-- XAMPP NO lo trae activado. En my.ini:
--     sql_mode=STRICT_ALL_TABLES,NO_ENGINE_SUBSTITUTION

-- CREATE DATABASE IF NOT EXISTS asta
--   CHARACTER SET utf8mb4
--   COLLATE utf8mb4_unicode_ci;
-- USE asta;


-- =============================================================================
-- IDENTIDAD
-- =============================================================================

-- -----------------------------------------------------------------------------
-- app_users — espejo de res.partner (clientes) y res.users (vendedores) de Odoo.
--
-- La llave que une los dos mundos es `odoo_partner_id`. Es inmutable: si cambia,
-- deja de ser el mismo cliente.
-- -----------------------------------------------------------------------------
CREATE TABLE app_users (
  id                      CHAR(36)      NOT NULL,

  -- El email usa colación BINARIA y la aplicación lo normaliza a minúsculas.
  --
  -- Se probó primero con colaciones _ci, buscando una que ignorase mayúsculas
  -- pero respetase acentos. NINGUNA lo hace. Comprobado con literales hex, para
  -- que el charset de la consola no falsee el resultado:
  --
  --     utf8mb4_general_ci      ignora mayús.  IGNORA ACENTOS
  --     utf8mb4_unicode_ci      ignora mayús.  IGNORA ACENTOS
  --     utf8mb4_spanish_ci      ignora mayús.  IGNORA ACENTOS
  --     utf8mb4_unicode_520_ci  ignora mayús.  IGNORA ACENTOS
  --     utf8mb4_bin             distingue      respeta acentos
  --
  -- Con cualquier _ci, 'jose@x.com' y 'josé@x.com' serían el MISMO usuario, y
  -- el segundo no podría darse de alta.
  --
  -- Por eso: _bin en la base, y `normalizarEmail()` en la aplicación pasa a
  -- minúsculas y recorta espacios antes de CUALQUIER inserción o búsqueda.
  --   · 'JOSE@x.com' -> 'jose@x.com'  -> colisiona (correcto)
  --   · 'josé@x.com' -> 'josé@x.com'  -> no colisiona (correcto)
  --
  -- CONTRAPARTIDA: si alguien inserta a mano sin normalizar, se cuelan
  -- duplicados que la base ya no impide. La aplicación es la única que escribe.
  email                   VARCHAR(255)  COLLATE utf8mb4_bin NOT NULL,
  full_name               VARCHAR(255)  NOT NULL,
  phone                   VARCHAR(50)            DEFAULT NULL,

  role                    ENUM('SUPERADMIN','VENDEDOR','BRONCE','PLATA','GOLD') NOT NULL,

  -- ── Vínculo con Odoo ───────────────────────────────────────────────────────
  odoo_partner_id         INT UNSIGNED  NOT NULL,                  -- res.partner.id
  odoo_user_id            INT UNSIGNED           DEFAULT NULL,     -- res.users.id (staff)
  odoo_pricelist_id       INT UNSIGNED           DEFAULT NULL,     -- product.pricelist.id
  -- res.partner.commercial_partner_id — la matriz bajo la que se consolida
  -- la facturación cuando el cliente tiene sucursales.
  odoo_commercial_id      INT UNSIGNED           DEFAULT NULL,
  -- Nombre de la tarifa tal como viene de Odoo, para depurar desalineaciones.
  odoo_pricelist_name     VARCHAR(255)           DEFAULT NULL,
  -- FALSE = prospecto: asignado a un vendedor pero nunca se le ha facturado.
  -- De los 791 partners del vendedor con más cartera, 532 están así.
  is_customer             BOOLEAN       NOT NULL DEFAULT FALSE,

  -- ── Vendedor asignado ──────────────────────────────────────────────────────
  assigned_salesperson_id CHAR(36)               DEFAULT NULL,

  is_active               BOOLEAN       NOT NULL DEFAULT TRUE,
  last_login_at           DATETIME(3)            DEFAULT NULL,

  sync_status             ENUM('PENDING','SYNCED','FAILED','ORPHANED') NOT NULL DEFAULT 'PENDING',
  synced_at               DATETIME(3)            DEFAULT NULL,
  sync_error              TEXT                   DEFAULT NULL,

  created_at              DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at              DATETIME(3)   NOT NULL,

  PRIMARY KEY (id),
  UNIQUE KEY uq_app_users_email (email),
  UNIQUE KEY uq_app_users_odoo_partner (odoo_partner_id),
  UNIQUE KEY uq_app_users_odoo_user (odoo_user_id),
  KEY ix_app_users_role_active (role, is_active),
  KEY ix_app_users_salesperson (assigned_salesperson_id),
  KEY ix_app_users_commercial (odoo_commercial_id),

  CONSTRAINT fk_app_users_salesperson
    FOREIGN KEY (assigned_salesperson_id) REFERENCES app_users (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- -----------------------------------------------------------------------------
-- user_credentials — contraseñas.
--
-- Esta tabla NO existía en el diseño con Supabase, que se encargaba de la
-- autenticación. Al pasar a MySQL, el middleware pasa a ser responsable de
-- guardar contraseñas, y eso es una responsabilidad seria.
--
-- Va en tabla aparte de `app_users` a propósito: así una consulta de perfil
-- —que es la mayoría— nunca trae el hash por accidente a memoria ni a un log.
--
-- REGLAS INNEGOCIABLES:
--   · El hash es Argon2id. NO SHA-256, NO MD5, NO bcrypt sin coste ajustado.
--     Aquí SÍ hace falta un KDF lento: una contraseña humana tiene poca entropía
--     y hay diccionarios. (Es el caso opuesto al de las API keys, donde el
--     secreto son 32 bytes aleatorios y basta un HMAC.)
--   · La columna guarda el string PHC completo ($argon2id$v=19$m=...$...),
--     que ya incluye la sal y los parámetros. No hace falta columna de sal.
--   · Nunca se escribe una contraseña en claro en ningún log ni columna.
-- -----------------------------------------------------------------------------
CREATE TABLE user_credentials (
  user_id             CHAR(36)      NOT NULL,
  -- 255 alcanza de sobra para Argon2id en formato PHC (~100 chars).
  password_hash       VARCHAR(255)  NOT NULL,
  -- Obliga a cambiarla en el próximo login (alta inicial, reseteo por soporte).
  must_change         BOOLEAN       NOT NULL DEFAULT FALSE,
  password_changed_at DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  -- Bloqueo por fuerza bruta. Se cuenta por usuario, no por IP: un atacante
  -- rota IPs con facilidad, pero la cuenta objetivo sigue siendo la misma.
  failed_attempts     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  locked_until        DATETIME(3)   DEFAULT NULL,

  PRIMARY KEY (user_id),
  CONSTRAINT fk_user_credentials_user
    FOREIGN KEY (user_id) REFERENCES app_users (id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- -----------------------------------------------------------------------------
-- user_sessions — refresh tokens.
--
-- También es nueva: la gestionaba Supabase.
--
-- Se guarda el HASH del refresh token, no el token. Si alguien lee esta tabla,
-- no puede suplantar a nadie. El access token (JWT de vida corta) no se guarda:
-- se valida por firma y caduca solo.
-- -----------------------------------------------------------------------------
CREATE TABLE user_sessions (
  id                 CHAR(36)     NOT NULL,
  user_id            CHAR(36)     NOT NULL,

  -- SHA-256 en hex del refresh token. 64 caracteres exactos.
  refresh_token_hash CHAR(64)     NOT NULL,

  user_agent         VARCHAR(500)          DEFAULT NULL,
  ip                 VARCHAR(45)           DEFAULT NULL,   -- 45 = IPv6 máximo

  issued_at          DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_used_at       DATETIME(3)           DEFAULT NULL,
  expires_at         DATETIME(3)  NOT NULL,
  revoked_at         DATETIME(3)           DEFAULT NULL,
  -- logout | expired | rotated | password_changed | admin_revoked
  revoked_reason     VARCHAR(40)           DEFAULT NULL,

  PRIMARY KEY (id),
  UNIQUE KEY uq_user_sessions_token (refresh_token_hash),
  KEY ix_user_sessions_user (user_id, revoked_at),
  KEY ix_user_sessions_expiry (expires_at),

  CONSTRAINT fk_user_sessions_user
    FOREIGN KEY (user_id) REFERENCES app_users (id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- -----------------------------------------------------------------------------
-- auth_tokens — invitaciones, reseteo de contraseña y verificación de email.
--
-- Un solo tipo de tabla para los tres casos: todos son "un secreto de un solo
-- uso, con caducidad corta, que autoriza una acción concreta".
-- -----------------------------------------------------------------------------
CREATE TABLE auth_tokens (
  id          CHAR(36)  NOT NULL,
  user_id     CHAR(36)  NOT NULL,
  purpose     ENUM('INVITE','PASSWORD_RESET','EMAIL_VERIFY') NOT NULL,

  -- Igual que arriba: se guarda el hash, nunca el token que viaja por email.
  token_hash  CHAR(64)  NOT NULL,

  expires_at  DATETIME(3) NOT NULL,
  used_at     DATETIME(3)          DEFAULT NULL,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_ip  VARCHAR(45)          DEFAULT NULL,

  PRIMARY KEY (id),
  UNIQUE KEY uq_auth_tokens_hash (token_hash),
  KEY ix_auth_tokens_user (user_id, purpose, used_at),
  KEY ix_auth_tokens_expiry (expires_at),

  CONSTRAINT fk_auth_tokens_user
    FOREIGN KEY (user_id) REFERENCES app_users (id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =============================================================================
-- NIVELES COMERCIALES
-- =============================================================================

-- -----------------------------------------------------------------------------
-- tier_pricelist_map — de qué tarifa de Odoo se deriva cada nivel.
--
-- Nace de los hallazgos de Fase 0: `x_client_tier` no existe en Odoo, así que el
-- nivel del cliente se deduce de su `property_product_pricelist`.
--
-- Vive en base de datos y no en código a propósito. Mover una tarifa de nivel es
-- una decisión comercial que pasa varias veces al año; si está en un archivo .ts
-- cada cambio exige un despliegue. Aquí lo edita el SuperAdmin desde el panel.
-- -----------------------------------------------------------------------------
CREATE TABLE tier_pricelist_map (
  odoo_pricelist_id   INT UNSIGNED NOT NULL,
  pricelist_name      VARCHAR(255) NOT NULL,
  tier                ENUM('BRONCE','PLATA','GOLD') NOT NULL,
  notes               VARCHAR(500) DEFAULT NULL,

  updated_by          CHAR(36)     DEFAULT NULL,
  updated_at          DATETIME(3)  NOT NULL,

  PRIMARY KEY (odoo_pricelist_id),
  KEY ix_tier_pricelist_tier (tier),
  KEY ix_tier_pricelist_updated_by (updated_by),

  CONSTRAINT fk_tier_map_updated_by
    FOREIGN KEY (updated_by) REFERENCES app_users (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =============================================================================
-- API KEYS
-- =============================================================================

-- -----------------------------------------------------------------------------
-- api_keys — token que el cliente genera desde su panel.
--
-- Formato:  asta_live_<prefix:8>_<secret:43>
--
--   · `prefix` va en claro e indexado -> encontrar la fila es un índice único,
--     no un recorrido de la tabla hasheando fila por fila.
--   · `key_hash` = HMAC-SHA256(pepper_de_entorno, token_completo).
--     No es bcrypt: bcrypt cuesta ~100 ms y aquí se verifica en CADA request.
--     El secreto son 32 bytes de CSPRNG, no una contraseña: no hay diccionario
--     que atacar, así que no hace falta un KDF lento.
--   · El pepper vive en el entorno, NO en esta base. Si alguien exfiltra la
--     tabla, los hashes solos no le permiten verificar ni un token.
--   · El secreto en claro se muestra UNA vez, al crearlo. No se recupera.
-- -----------------------------------------------------------------------------
CREATE TABLE api_keys (
  id                    CHAR(36)     NOT NULL,
  user_id               CHAR(36)     NOT NULL,

  name                  VARCHAR(60)  NOT NULL,   -- "Integración con mi ERP"
  environment           ENUM('LIVE','TEST') NOT NULL DEFAULT 'LIVE',

  prefix                VARCHAR(16)  NOT NULL,
  key_hash              CHAR(64)     NOT NULL,   -- HMAC-SHA256 en hex
  last_four             CHAR(4)      NOT NULL,

  rate_limit_per_minute SMALLINT UNSIGNED NOT NULL DEFAULT 60,

  expires_at            DATETIME(3)           DEFAULT NULL,
  revoked_at            DATETIME(3)           DEFAULT NULL,
  revoked_by            CHAR(36)              DEFAULT NULL,
  revoke_reason         VARCHAR(200)          DEFAULT NULL,

  last_used_at          DATETIME(3)           DEFAULT NULL,
  last_used_ip          VARCHAR(45)           DEFAULT NULL,
  usage_count           BIGINT UNSIGNED NOT NULL DEFAULT 0,

  created_at            DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_from_ip       VARCHAR(45)           DEFAULT NULL,

  PRIMARY KEY (id),
  UNIQUE KEY uq_api_keys_prefix (prefix),
  UNIQUE KEY uq_api_keys_hash (key_hash),
  -- MySQL no tiene índices parciales (el `WHERE revoked_at IS NULL` de
  -- PostgreSQL). Un índice compuesto cumple la misma función aquí.
  KEY ix_api_keys_user_revoked (user_id, revoked_at),
  -- Explicito: si no, MySQL crea uno implicito llamado como la FK.
  KEY ix_api_keys_revoked_by (revoked_by),

  CONSTRAINT fk_api_keys_user
    FOREIGN KEY (user_id) REFERENCES app_users (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_api_keys_revoked_by
    FOREIGN KEY (revoked_by) REFERENCES app_users (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- -----------------------------------------------------------------------------
-- api_key_scopes — permisos de cada key.
--
-- En PostgreSQL esto era una columna `scopes ApiScope[]`. MySQL no tiene tipo
-- array, así que va en tabla puente.
--
-- No es un mal cambio: se puede consultar "qué keys pueden escribir pedidos" con
-- un índice en vez de escanear arrays, y la clave foránea impide guardar un
-- scope inventado. Cuesta un JOIN al verificar el token.
-- -----------------------------------------------------------------------------
CREATE TABLE api_key_scopes (
  api_key_id CHAR(36) NOT NULL,
  scope      ENUM('INVENTORY_READ','PRICING_READ','INVOICES_READ',
                  'ORDERS_READ','ORDERS_WRITE','RECOMMENDER_READ') NOT NULL,

  PRIMARY KEY (api_key_id, scope),
  KEY ix_api_key_scopes_scope (scope),

  CONSTRAINT fk_api_key_scopes_key
    FOREIGN KEY (api_key_id) REFERENCES api_keys (id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- -----------------------------------------------------------------------------
-- api_key_allowed_ips — lista blanca opcional de origen.
-- Sin filas para una key = sin restricción de IP.
-- -----------------------------------------------------------------------------
CREATE TABLE api_key_allowed_ips (
  api_key_id CHAR(36)    NOT NULL,
  cidr       VARCHAR(45) NOT NULL,   -- "200.44.1.10" o "200.44.1.0/24"

  PRIMARY KEY (api_key_id, cidr),

  CONSTRAINT fk_api_key_ips_key
    FOREIGN KEY (api_key_id) REFERENCES api_keys (id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- -----------------------------------------------------------------------------
-- api_request_logs — bitácora de la API pública.
--
-- Tabla de alto volumen. Ver 003_partitioning.sql para el particionado por mes
-- y la purga a 90 días; se deja aparte porque particionar en MySQL impone una
-- restricción sobre la clave primaria que conviene decidir a conciencia.
-- -----------------------------------------------------------------------------
CREATE TABLE api_request_logs (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  api_key_id      CHAR(36)              DEFAULT NULL,

  -- Desnormalizado: si la key se borra, el registro sigue siendo auditable.
  odoo_partner_id INT UNSIGNED          DEFAULT NULL,

  method          VARCHAR(8)    NOT NULL,
  path            VARCHAR(255)  NOT NULL,
  status_code     SMALLINT UNSIGNED NOT NULL,
  duration_ms     INT UNSIGNED  NOT NULL,
  -- Cuántos RPC a Odoo costó este request. Delata un N+1 contra el ERP.
  odoo_calls      SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  cache_hit       BOOLEAN       NOT NULL DEFAULT FALSE,
  error_code      VARCHAR(64)           DEFAULT NULL,
  ip              VARCHAR(45)           DEFAULT NULL,
  user_agent      VARCHAR(500)          DEFAULT NULL,

  created_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  KEY ix_api_logs_key_date (api_key_id, created_at),
  KEY ix_api_logs_date (created_at)

  -- SIN clave foránea a api_keys, a propósito.
  --
  -- MySQL y MariaDB NO permiten particionar una tabla que tenga claves foráneas,
  -- y esta se particiona por mes para poder purgarla con DROP PARTITION en vez
  -- de un DELETE de millones de filas (ver 003_partitioning.sql).
  --
  -- Se puede prescindir de ella porque `odoo_partner_id` está desnormalizado
  -- justo para que el registro sobreviva al borrado de la key. La integridad la
  -- mantiene la aplicación, que es la única que escribe aquí.
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =============================================================================
-- KIOSCO
-- =============================================================================

CREATE TABLE kiosk_devices (
  id             CHAR(36)     NOT NULL,
  label          VARCHAR(100) NOT NULL,          -- "Tablet Mostrador 1"
  store_location VARCHAR(150) NOT NULL,
  token_hash     CHAR(64)     NOT NULL,          -- igual que las API keys
  is_active      BOOLEAN      NOT NULL DEFAULT TRUE,

  app_version    VARCHAR(20)           DEFAULT NULL,
  last_seen_at   DATETIME(3)           DEFAULT NULL,

  created_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  UNIQUE KEY uq_kiosk_devices_token (token_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- -----------------------------------------------------------------------------
-- kiosk_sessions — sesión efímera de un cliente frente a la tablet.
--
-- TTL corto y cierre agresivo: es un dispositivo compartido en piso de venta.
-- La sesión de un cliente no puede sobrevivir al siguiente, o el que llega ve
-- los precios del que se fue.
-- -----------------------------------------------------------------------------
CREATE TABLE kiosk_sessions (
  id               CHAR(36)    NOT NULL,
  device_id        CHAR(36)    NOT NULL,
  -- NULL = visitante anónimo: ve precio público, no tarifa de nivel.
  user_id          CHAR(36)             DEFAULT NULL,

  started_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_activity_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at       DATETIME(3) NOT NULL,
  ended_at         DATETIME(3)          DEFAULT NULL,
  ended_reason     VARCHAR(30)          DEFAULT NULL,  -- logout|timeout|device_reset

  PRIMARY KEY (id),
  KEY ix_kiosk_sessions_device (device_id, ended_at),
  KEY ix_kiosk_sessions_expiry (expires_at),
  KEY ix_kiosk_sessions_user (user_id),

  CONSTRAINT fk_kiosk_sessions_device
    FOREIGN KEY (device_id) REFERENCES kiosk_devices (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_kiosk_sessions_user
    FOREIGN KEY (user_id) REFERENCES app_users (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- -----------------------------------------------------------------------------
-- recommendation_events — telemetría del recomendador.
--
-- Es el activo de datos más valioso del kiosco: dice qué impresoras tiene el
-- mercado y qué tóner deberíamos tener en stock. No se puede reconstruir
-- después, así que se instrumenta desde el primer día.
-- -----------------------------------------------------------------------------
CREATE TABLE recommendation_events (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  device_id          CHAR(36)              DEFAULT NULL,
  user_id            CHAR(36)              DEFAULT NULL,

  -- El texto CRUDO que tecleó el cliente, sin normalizar.
  -- Los errores de tipeo son el dato: enseñan qué alias le faltan a cada modelo.
  search_query       VARCHAR(200)  NOT NULL,
  matched_printer_id INT UNSIGNED          DEFAULT NULL,
  results_count      SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  clicked_product_id INT UNSIGNED          DEFAULT NULL,
  -- Había producto compatible pero sin existencias: quiebre de venta medible.
  was_out_of_stock   BOOLEAN       NOT NULL DEFAULT FALSE,

  created_at         DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  KEY ix_reco_printer_date (matched_printer_id, created_at),
  KEY ix_reco_date (created_at),
  KEY ix_reco_device (device_id),
  KEY ix_reco_user (user_id),

  CONSTRAINT fk_reco_device
    FOREIGN KEY (device_id) REFERENCES kiosk_devices (id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_reco_user
    FOREIGN KEY (user_id) REFERENCES app_users (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =============================================================================
-- MÓDULO DE VENDEDORES
-- =============================================================================

-- -----------------------------------------------------------------------------
-- client_notes — perfilado del cliente (issue #24).
--
-- Vive aquí y no en Odoo a propósito: son notas operativas del panel, no del
-- ERP. Meterlas en Odoo obligaría a darle licencia a cada vendedor y ensuciaría
-- el chatter del cliente.
-- -----------------------------------------------------------------------------
CREATE TABLE client_notes (
  id              CHAR(36)     NOT NULL,
  -- Se guarda el id de Odoo y no el de app_users: un vendedor puede querer
  -- anotar sobre un prospecto que todavía no tiene cuenta en el panel.
  odoo_partner_id INT UNSIGNED NOT NULL,
  author_id       CHAR(36)              DEFAULT NULL,
  author_name     VARCHAR(255) NOT NULL,   -- desnormalizado: sobrevive al borrado
  body            TEXT         NOT NULL,

  created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)  NOT NULL,
  deleted_at      DATETIME(3)           DEFAULT NULL,

  PRIMARY KEY (id),
  KEY ix_client_notes_partner (odoo_partner_id, created_at),
  KEY ix_client_notes_author (author_id),

  CONSTRAINT fk_client_notes_author
    FOREIGN KEY (author_id) REFERENCES app_users (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =============================================================================
-- SOPORTE
-- =============================================================================

-- -----------------------------------------------------------------------------
-- odoo_entity_cache — cache de lectura del ERP.
--
-- Odoo responde en ~200 ms por RPC (medido en Fase 0). Sin cache, cada pantalla
-- del panel y cada request de la API pública paga ese peaje.
--
-- La clave incluye `variant` porque la misma ficha de producto cambia según la
-- tarifa: "pricelist:15866" y "pricelist:15836" son dos respuestas distintas del
-- mismo registro.
-- -----------------------------------------------------------------------------
CREATE TABLE odoo_entity_cache (
  odoo_model VARCHAR(64)  NOT NULL,              -- "product.template"
  odoo_id    INT UNSIGNED NOT NULL,
  variant    VARCHAR(32)  NOT NULL DEFAULT 'default',  -- "pricelist:15866"
  payload    JSON         NOT NULL,
  synced_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at DATETIME(3)  NOT NULL,

  PRIMARY KEY (odoo_model, odoo_id, variant),
  KEY ix_odoo_cache_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- -----------------------------------------------------------------------------
-- sync_state — marca de agua de cada sincronización con Odoo.
--
-- Guarda el `write_date` MÁS ALTO ya procesado, para que la siguiente pasada
-- pida solo lo que cambió. Sin esto habría que releer los 2944 clientes cada
-- 15 minutos.
--
-- Se guarda el reloj de ODOO, no el nuestro: son dos máquinas distintas y su
-- desfase, aunque sea de segundos, se traduce en registros que se saltan para
-- siempre. La marca es un dato que Odoo nos dio, no una hora que apuntamos.
--
-- Se retrocede un margen de seguridad al consultar (ver sync.service.ts): dos
-- partners modificados en el mismo segundo podrían quedar a caballo del corte.
-- -----------------------------------------------------------------------------
CREATE TABLE sync_state (
  -- "res.partner", y en el futuro los demás modelos que se sincronicen.
  entidad          VARCHAR(64)  NOT NULL,
  -- write_date de Odoo, en su formato 'YYYY-MM-DD HH:MM:SS' (UTC).
  ultimo_write_date VARCHAR(19)          DEFAULT NULL,
  ultima_ejecucion DATETIME(3)           DEFAULT NULL,
  -- Resumen de la última pasada: creados, actualizados, omitidos, fallidos.
  resumen          JSON                  DEFAULT NULL,
  ejecutando       BOOLEAN      NOT NULL DEFAULT FALSE,
  -- Para que una ejecución colgada no bloquee las siguientes para siempre.
  ejecutando_desde DATETIME(3)           DEFAULT NULL,

  PRIMARY KEY (entidad)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- -----------------------------------------------------------------------------
-- audit_logs — rastro de acciones sensibles.
--
-- Append-only. Nunca se actualiza ni se borra: un registro de auditoría que se
-- puede editar no es un registro de auditoría.
-- -----------------------------------------------------------------------------
CREATE TABLE audit_logs (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_id    CHAR(36)              DEFAULT NULL,
  -- Desnormalizado: el rastro debe seguir siendo legible aunque el usuario
  -- se borre después.
  actor_email VARCHAR(255)          DEFAULT NULL,

  action      VARCHAR(64)   NOT NULL,  -- api_key.created | user.role_changed | access.denied
  target_type VARCHAR(64)           DEFAULT NULL,
  target_id   VARCHAR(64)           DEFAULT NULL,
  metadata    JSON                  DEFAULT NULL,
  ip          VARCHAR(45)           DEFAULT NULL,

  created_at  DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  KEY ix_audit_actor_date (actor_id, created_at),
  KEY ix_audit_action_date (action, created_at),

  CONSTRAINT fk_audit_actor
    FOREIGN KEY (actor_id) REFERENCES app_users (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
