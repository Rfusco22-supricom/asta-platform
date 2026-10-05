-- Las ventas de Smartbit, el sistema de antes de Odoo (hasta el 31-mar-2026).
--
-- En PRODUCCIÓN ya existe: se copió a mano desde phpMyAdmin el 5-oct-2026. Por
-- eso `IF NOT EXISTS`, como `compatibilidad_productos`: allí esta migración no
-- hace nada, y en una base nueva (desarrollo, tests, un restore) crea la tabla
-- vacía y el panel cuenta solo lo de Odoo.
--
-- Al hacer la línea base de docs/09, esta migración se aplica con las demás del
-- paso 3: el modelo también está en `linea-base.prisma`.

CREATE TABLE IF NOT EXISTS `ventas_smartbit` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `company_id` INTEGER NOT NULL,
    `fecha` DATE NOT NULL,
    `id_sucursal` INTEGER NULL,
    `sucursal` VARCHAR(120) NULL,
    `vendedor` VARCHAR(150) NULL,
    `codigo_cliente` VARCHAR(60) NULL,
    `cliente` VARCHAR(255) NULL,
    `codigo_articulo` VARCHAR(80) NULL,
    `articulo` VARCHAR(255) NULL,
    `linea` VARCHAR(120) NULL,
    `marca` VARCHAR(120) NULL,
    `venta` DECIMAL(16, 2) NOT NULL DEFAULT 0.00,
    `unidades` DECIMAL(16, 4) NOT NULL DEFAULT 0.0000,
    `costo` DECIMAL(16, 4) NULL,
    `importado_en` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `idx_company_fecha`(`company_id`, `fecha`),
    INDEX `idx_articulo`(`codigo_articulo`),
    INDEX `idx_marca`(`marca`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
