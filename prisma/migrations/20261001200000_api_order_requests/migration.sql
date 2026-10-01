-- Peticiones de pedido por la API pública (#33): idempotencia y lista de
-- pedidos que el cliente creó él mismo. Ver el modelo `ApiOrderRequest` en
-- `prisma/schema.prisma`.
--
-- Tabla nueva y vacía: no toca a nadie. En producción hay que dar los permisos
-- de `asta_app` a mano después de aplicarla (`db/mysql/004_usuarios.sql`).

-- CreateTable
CREATE TABLE `api_order_requests` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `odoo_partner_id` INTEGER UNSIGNED NOT NULL,
    `idempotency_key` VARCHAR(128) NOT NULL,
    `request_hash` CHAR(64) NOT NULL,
    `estado` ENUM('EN_CURSO', 'CREADO', 'FALLIDO') NOT NULL DEFAULT 'EN_CURSO',
    `odoo_order_id` INTEGER UNSIGNED NULL,
    `respuesta` JSON NULL,
    `api_key_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `ix_api_order_requests_pedido`(`odoo_partner_id`, `odoo_order_id`),
    UNIQUE INDEX `uq_api_order_requests_clave`(`odoo_partner_id`, `idempotency_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
