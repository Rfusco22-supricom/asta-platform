-- Pedidos sugeridos que los clientes envían desde el panel, y sus líneas.
-- No se escriben en Odoo: los recibe el vendedor, que los marca aquí.
-- Tablas nuevas y vacías. Ver `PedidoCliente` y `PedidoClienteLinea` en
-- `prisma/schema.prisma`.

-- CreateTable
CREATE TABLE `pedidos_cliente` (
    `id` CHAR(36) NOT NULL,
    `odoo_partner_id` INTEGER UNSIGNED NOT NULL,
    `cliente` VARCHAR(200) NOT NULL,
    `odoo_vendedor_id` INTEGER UNSIGNED NULL,
    `nota` VARCHAR(500) NULL,
    `importe_estimado` DECIMAL(14, 2) NULL,
    `enviado_por` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `estado` ENUM('ENVIADO', 'EN_ODOO', 'DESCARTADO') NOT NULL DEFAULT 'ENVIADO',
    `folio_odoo` VARCHAR(64) NULL,
    `motivo` VARCHAR(300) NULL,
    `atendido_por` CHAR(36) NULL,
    `atendido_en` DATETIME(3) NULL,

    INDEX `ix_pedidos_cliente_estado`(`estado`, `created_at`),
    INDEX `ix_pedidos_cliente_cliente`(`odoo_partner_id`, `created_at`),
    INDEX `ix_pedidos_cliente_vendedor`(`odoo_vendedor_id`, `estado`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pedidos_cliente_lineas` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `pedido_id` CHAR(36) NOT NULL,
    `odoo_product_id` INTEGER UNSIGNED NOT NULL,
    `sku` VARCHAR(64) NULL,
    `nombre` VARCHAR(255) NOT NULL,
    `cantidad` INTEGER UNSIGNED NOT NULL,
    `sugeridas` INTEGER UNSIGNED NULL,
    `precio` DECIMAL(14, 2) NULL,

    INDEX `ix_pedidos_cliente_lineas_pedido`(`pedido_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `pedidos_cliente_lineas` ADD CONSTRAINT `fk_pedidos_cliente_lineas_pedido` FOREIGN KEY (`pedido_id`) REFERENCES `pedidos_cliente`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
