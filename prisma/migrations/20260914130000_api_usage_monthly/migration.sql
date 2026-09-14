-- CreateTable
CREATE TABLE `api_usage_monthly` (
    `odoo_partner_id` INTEGER UNSIGNED NOT NULL,
    `periodo` CHAR(7) NOT NULL,
    `peticiones` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `errores` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `duracion_total_ms` BIGINT UNSIGNED NOT NULL DEFAULT 0,
    `odoo_calls` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `calculado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ix_api_usage_periodo`(`periodo`),
    PRIMARY KEY (`odoo_partner_id`, `periodo`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

