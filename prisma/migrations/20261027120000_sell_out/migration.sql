-- Sell-out de los clientes (fase 2): lo que cada cliente reporta de un mes,
-- sus ventas de ASTA o su inventario al cierre, y sus líneas por producto.
-- Tablas nuevas y vacías. Ver `SellOutReporte` y `SellOutLinea` en
-- `prisma/schema.prisma`.

-- CreateTable
CREATE TABLE `sell_out_reportes` (
    `id` CHAR(36) NOT NULL,
    `odoo_partner_id` INTEGER UNSIGNED NOT NULL,
    `mes` CHAR(7) NOT NULL,
    `tipo` ENUM('VENTAS', 'INVENTARIO') NOT NULL,
    `archivo` VARCHAR(200) NOT NULL,
    `filas` INTEGER UNSIGNED NOT NULL,
    `unidades` DECIMAL(14, 2) NOT NULL,
    `subido_por` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `reemplazado_en` DATETIME(3) NULL,

    INDEX `ix_sell_out_reportes_cliente`(`odoo_partner_id`, `mes`, `tipo`),
    INDEX `ix_sell_out_reportes_mes`(`mes`, `tipo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sell_out_lineas` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `reporte_id` CHAR(36) NOT NULL,
    `odoo_product_id` INTEGER UNSIGNED NOT NULL,
    `sku` VARCHAR(64) NOT NULL,
    `cantidad` DECIMAL(14, 2) NOT NULL,

    INDEX `ix_sell_out_lineas_reporte`(`reporte_id`),
    INDEX `ix_sell_out_lineas_producto`(`odoo_product_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `sell_out_lineas` ADD CONSTRAINT `fk_sell_out_lineas_reporte` FOREIGN KEY (`reporte_id`) REFERENCES `sell_out_reportes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

