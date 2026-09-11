-- ─────────────────────────────────────────────────────────────────────────────
-- Linea base del esquema (issue #12)
--
-- Esto NO se escribio a mano ni se aplica en un entorno que ya existe: se
-- genero desde la base de desarrollo ya montada por db/mysql/001_schema.sql y
-- se marco como aplicada con `prisma migrate resolve --applied 0_init`.
--
-- Existe para que EasyPanel y cualquier entorno nuevo puedan levantarse con
-- `prisma migrate deploy` y para que los cambios futuros tengan de donde partir.
-- El disenio y el porque de cada tabla siguen viviendo en db/mysql/001_schema.sql,
-- que es donde estan los comentarios.
--
-- ── UNA COSA QUE HAY QUE SABER ANTES DE REGENERAR ESTE FICHERO ───────────────
--
-- `prisma migrate diff` SE COME LAS COLACIONES DE COLUMNA. Se comprobo: la base
-- real tiene `app_users.email COLLATE utf8mb4_bin` y el fichero generado decia
-- `VARCHAR(255)` a secas, que habria heredado el utf8mb4_unicode_ci de la base.
--
-- No es cosmetico. Con una colacion _ci el indice UNIQUE del email deja de
-- distinguir mayusculas y acentos, asi que `jose@x.com` y `JOSE@x.com` chocan
-- como duplicados y dos personas distintas no pueden tener cuenta. La colacion
-- binaria es justo lo que impide eso; la normalizacion la hace la aplicacion en
-- normalizarEmail(), a proposito, para que la regla este escrita en un sitio y
-- no dependa de la version del motor.
--
-- Por eso el COLLATE de mas abajo esta puesto A MANO. Si alguien regenera este
-- fichero con `migrate diff`, hay que volver a ponerlo, o el primer despliegue
-- limpio saldra con una garantia de unicidad distinta a la de desarrollo.
-- ─────────────────────────────────────────────────────────────────────────────

-- CreateTable
CREATE TABLE `api_key_allowed_ips` (
    `api_key_id` CHAR(36) NOT NULL,
    `cidr` VARCHAR(45) NOT NULL,

    PRIMARY KEY (`api_key_id` ASC, `cidr` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `api_key_scopes` (
    `api_key_id` CHAR(36) NOT NULL,
    `scope` ENUM('INVENTORY_READ', 'PRICING_READ', 'INVOICES_READ', 'ORDERS_READ', 'ORDERS_WRITE', 'RECOMMENDER_READ') NOT NULL,

    INDEX `ix_api_key_scopes_scope`(`scope` ASC),
    PRIMARY KEY (`api_key_id` ASC, `scope` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `api_keys` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `name` VARCHAR(60) NOT NULL,
    `environment` ENUM('LIVE', 'TEST') NOT NULL DEFAULT 'LIVE',
    `prefix` VARCHAR(16) NOT NULL,
    `key_hash` CHAR(64) NOT NULL,
    `last_four` CHAR(4) NOT NULL,
    `rate_limit_per_minute` SMALLINT UNSIGNED NOT NULL DEFAULT 60,
    `expires_at` DATETIME(3) NULL,
    `revoked_at` DATETIME(3) NULL,
    `revoked_by` CHAR(36) NULL,
    `revoke_reason` VARCHAR(200) NULL,
    `last_used_at` DATETIME(3) NULL,
    `last_used_ip` VARCHAR(45) NULL,
    `usage_count` BIGINT UNSIGNED NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_from_ip` VARCHAR(45) NULL,

    INDEX `ix_api_keys_revoked_by`(`revoked_by` ASC),
    INDEX `ix_api_keys_user_revoked`(`user_id` ASC, `revoked_at` ASC),
    UNIQUE INDEX `uq_api_keys_hash`(`key_hash` ASC),
    UNIQUE INDEX `uq_api_keys_prefix`(`prefix` ASC),
    PRIMARY KEY (`id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `api_request_logs` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `api_key_id` CHAR(36) NULL,
    `odoo_partner_id` INTEGER UNSIGNED NULL,
    `method` VARCHAR(8) NOT NULL,
    `path` VARCHAR(255) NOT NULL,
    `status_code` SMALLINT UNSIGNED NOT NULL,
    `duration_ms` INTEGER UNSIGNED NOT NULL,
    `odoo_calls` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    `cache_hit` BOOLEAN NOT NULL DEFAULT false,
    `error_code` VARCHAR(64) NULL,
    `ip` VARCHAR(45) NULL,
    `user_agent` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ix_api_logs_date`(`created_at` ASC),
    INDEX `ix_api_logs_key_date`(`api_key_id` ASC, `created_at` ASC),
    PRIMARY KEY (`id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `app_users` (
    `id` CHAR(36) NOT NULL,
    -- COLLATE A MANO. No lo quites al regenerar: ver la cabecera.
    `email` VARCHAR(255) COLLATE utf8mb4_bin NOT NULL,
    `full_name` VARCHAR(255) NOT NULL,
    `phone` VARCHAR(50) NULL,
    `role` ENUM('SUPERADMIN', 'VENDEDOR', 'BRONCE', 'PLATA', 'GOLD') NOT NULL,
    `odoo_partner_id` INTEGER UNSIGNED NOT NULL,
    `odoo_user_id` INTEGER UNSIGNED NULL,
    `odoo_pricelist_id` INTEGER UNSIGNED NULL,
    `odoo_commercial_id` INTEGER UNSIGNED NULL,
    `odoo_pricelist_name` VARCHAR(255) NULL,
    `is_customer` BOOLEAN NOT NULL DEFAULT false,
    `assigned_salesperson_id` CHAR(36) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `last_login_at` DATETIME(3) NULL,
    `sync_status` ENUM('PENDING', 'SYNCED', 'FAILED', 'ORPHANED') NOT NULL DEFAULT 'PENDING',
    `synced_at` DATETIME(3) NULL,
    `sync_error` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `ix_app_users_commercial`(`odoo_commercial_id` ASC),
    INDEX `ix_app_users_role_active`(`role` ASC, `is_active` ASC),
    INDEX `ix_app_users_salesperson`(`assigned_salesperson_id` ASC),
    UNIQUE INDEX `uq_app_users_email`(`email` ASC),
    UNIQUE INDEX `uq_app_users_odoo_partner`(`odoo_partner_id` ASC),
    UNIQUE INDEX `uq_app_users_odoo_user`(`odoo_user_id` ASC),
    PRIMARY KEY (`id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `actor_id` CHAR(36) NULL,
    `actor_email` VARCHAR(255) NULL,
    `action` VARCHAR(64) NOT NULL,
    `target_type` VARCHAR(64) NULL,
    `target_id` VARCHAR(64) NULL,
    `metadata` LONGTEXT NULL,
    `ip` VARCHAR(45) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ix_audit_action_date`(`action` ASC, `created_at` ASC),
    INDEX `ix_audit_actor_date`(`actor_id` ASC, `created_at` ASC),
    PRIMARY KEY (`id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `auth_tokens` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `purpose` ENUM('INVITE', 'PASSWORD_RESET', 'EMAIL_VERIFY') NOT NULL,
    `token_hash` CHAR(64) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `used_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_ip` VARCHAR(45) NULL,

    INDEX `ix_auth_tokens_expiry`(`expires_at` ASC),
    INDEX `ix_auth_tokens_user`(`user_id` ASC, `purpose` ASC, `used_at` ASC),
    UNIQUE INDEX `uq_auth_tokens_hash`(`token_hash` ASC),
    PRIMARY KEY (`id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `client_notes` (
    `id` CHAR(36) NOT NULL,
    `odoo_partner_id` INTEGER UNSIGNED NOT NULL,
    `author_id` CHAR(36) NULL,
    `author_name` VARCHAR(255) NOT NULL,
    `body` TEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `ix_client_notes_author`(`author_id` ASC),
    INDEX `ix_client_notes_partner`(`odoo_partner_id` ASC, `created_at` ASC),
    PRIMARY KEY (`id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `kiosk_devices` (
    `id` CHAR(36) NOT NULL,
    `label` VARCHAR(100) NOT NULL,
    `store_location` VARCHAR(150) NOT NULL,
    `token_hash` CHAR(64) NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `app_version` VARCHAR(20) NULL,
    `last_seen_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `uq_kiosk_devices_token`(`token_hash` ASC),
    PRIMARY KEY (`id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `kiosk_sessions` (
    `id` CHAR(36) NOT NULL,
    `device_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NULL,
    `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_activity_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expires_at` DATETIME(3) NOT NULL,
    `ended_at` DATETIME(3) NULL,
    `ended_reason` VARCHAR(30) NULL,

    INDEX `ix_kiosk_sessions_device`(`device_id` ASC, `ended_at` ASC),
    INDEX `ix_kiosk_sessions_expiry`(`expires_at` ASC),
    INDEX `ix_kiosk_sessions_user`(`user_id` ASC),
    PRIMARY KEY (`id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `odoo_entity_cache` (
    `odoo_model` VARCHAR(64) NOT NULL,
    `odoo_id` INTEGER UNSIGNED NOT NULL,
    `variant` VARCHAR(32) NOT NULL DEFAULT 'default',
    `payload` LONGTEXT NOT NULL,
    `synced_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expires_at` DATETIME(3) NOT NULL,

    INDEX `ix_odoo_cache_expiry`(`expires_at` ASC),
    PRIMARY KEY (`odoo_model` ASC, `odoo_id` ASC, `variant` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `recommendation_events` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `device_id` CHAR(36) NULL,
    `user_id` CHAR(36) NULL,
    `search_query` VARCHAR(200) NOT NULL,
    `matched_printer_id` INTEGER UNSIGNED NULL,
    `results_count` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    `clicked_product_id` INTEGER UNSIGNED NULL,
    `was_out_of_stock` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ix_reco_date`(`created_at` ASC),
    INDEX `ix_reco_device`(`device_id` ASC),
    INDEX `ix_reco_printer_date`(`matched_printer_id` ASC, `created_at` ASC),
    INDEX `ix_reco_user`(`user_id` ASC),
    PRIMARY KEY (`id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sync_state` (
    `entidad` VARCHAR(64) NOT NULL,
    `ultimo_write_date` VARCHAR(19) NULL,
    `ultima_ejecucion` DATETIME(3) NULL,
    `resumen` LONGTEXT NULL,
    `ejecutando` BOOLEAN NOT NULL DEFAULT false,
    `ejecutando_desde` DATETIME(3) NULL,

    PRIMARY KEY (`entidad` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tier_pricelist_map` (
    `odoo_pricelist_id` INTEGER UNSIGNED NOT NULL,
    `pricelist_name` VARCHAR(255) NOT NULL,
    `tier` ENUM('BRONCE', 'PLATA', 'GOLD') NOT NULL,
    `notes` VARCHAR(500) NULL,
    `updated_by` CHAR(36) NULL,
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `ix_tier_pricelist_tier`(`tier` ASC),
    INDEX `ix_tier_pricelist_updated_by`(`updated_by` ASC),
    PRIMARY KEY (`odoo_pricelist_id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_credentials` (
    `user_id` CHAR(36) NOT NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `must_change` BOOLEAN NOT NULL DEFAULT false,
    `password_changed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `failed_attempts` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    `locked_until` DATETIME(3) NULL,

    PRIMARY KEY (`user_id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_sessions` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `refresh_token_hash` CHAR(64) NOT NULL,
    `user_agent` VARCHAR(500) NULL,
    `ip` VARCHAR(45) NULL,
    `issued_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_used_at` DATETIME(3) NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `revoked_at` DATETIME(3) NULL,
    `revoked_reason` VARCHAR(40) NULL,

    INDEX `ix_user_sessions_expiry`(`expires_at` ASC),
    INDEX `ix_user_sessions_user`(`user_id` ASC, `revoked_at` ASC),
    UNIQUE INDEX `uq_user_sessions_token`(`refresh_token_hash` ASC),
    PRIMARY KEY (`id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `api_key_allowed_ips` ADD CONSTRAINT `fk_api_key_ips_key` FOREIGN KEY (`api_key_id`) REFERENCES `api_keys`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `api_key_scopes` ADD CONSTRAINT `fk_api_key_scopes_key` FOREIGN KEY (`api_key_id`) REFERENCES `api_keys`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `api_keys` ADD CONSTRAINT `fk_api_keys_revoked_by` FOREIGN KEY (`revoked_by`) REFERENCES `app_users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `api_keys` ADD CONSTRAINT `fk_api_keys_user` FOREIGN KEY (`user_id`) REFERENCES `app_users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `app_users` ADD CONSTRAINT `fk_app_users_salesperson` FOREIGN KEY (`assigned_salesperson_id`) REFERENCES `app_users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `fk_audit_actor` FOREIGN KEY (`actor_id`) REFERENCES `app_users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `auth_tokens` ADD CONSTRAINT `fk_auth_tokens_user` FOREIGN KEY (`user_id`) REFERENCES `app_users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `client_notes` ADD CONSTRAINT `fk_client_notes_author` FOREIGN KEY (`author_id`) REFERENCES `app_users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `kiosk_sessions` ADD CONSTRAINT `fk_kiosk_sessions_device` FOREIGN KEY (`device_id`) REFERENCES `kiosk_devices`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `kiosk_sessions` ADD CONSTRAINT `fk_kiosk_sessions_user` FOREIGN KEY (`user_id`) REFERENCES `app_users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `recommendation_events` ADD CONSTRAINT `fk_reco_device` FOREIGN KEY (`device_id`) REFERENCES `kiosk_devices`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `recommendation_events` ADD CONSTRAINT `fk_reco_user` FOREIGN KEY (`user_id`) REFERENCES `app_users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tier_pricelist_map` ADD CONSTRAINT `fk_tier_map_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `app_users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_credentials` ADD CONSTRAINT `fk_user_credentials_user` FOREIGN KEY (`user_id`) REFERENCES `app_users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_sessions` ADD CONSTRAINT `fk_user_sessions_user` FOREIGN KEY (`user_id`) REFERENCES `app_users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

