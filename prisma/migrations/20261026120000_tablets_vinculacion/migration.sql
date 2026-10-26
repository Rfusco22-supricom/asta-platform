-- Tablets vinculadas con un código del panel. La aplicación de la tienda de
-- apps no lleva token: el panel da un código de 6 dígitos (o su QR), se escribe
-- en la tablet y ella recibe su token. Ver `KioskCodigo` y `KioskDevice` en
-- `prisma/schema.prisma`.
--
-- `kiosk_devices`: la tablet puede ser de un cliente (`odoo_partner_id`) y el
-- almacén pasa a ser opcional (sin almacén enseña solo compatibilidades). Solo
-- AÑADE una columna y QUITA el NOT NULL de dos: ninguna fila existente cambia.
-- `kiosk_codigos`: tabla nueva y vacía.

-- AlterTable
ALTER TABLE `kiosk_devices` ADD COLUMN `odoo_partner_id` INTEGER UNSIGNED NULL,
    MODIFY `odoo_company_id` INTEGER UNSIGNED NULL,
    MODIFY `odoo_warehouse_id` INTEGER UNSIGNED NULL;

-- CreateTable
CREATE TABLE `kiosk_codigos` (
    `id` CHAR(36) NOT NULL,
    `codigo_hash` CHAR(64) NOT NULL,
    `nombre` VARCHAR(100) NOT NULL,
    `tienda` VARCHAR(150) NOT NULL,
    `odoo_partner_id` INTEGER UNSIGNED NULL,
    `odoo_company_id` INTEGER UNSIGNED NULL,
    `odoo_warehouse_id` INTEGER UNSIGNED NULL,
    `reutilizable` BOOLEAN NOT NULL DEFAULT false,
    `creado_por` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expires_at` DATETIME(3) NULL,
    `revocado_en` DATETIME(3) NULL,
    `usado_en` DATETIME(3) NULL,
    `usos` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `device_id` CHAR(36) NULL,

    INDEX `ix_kiosk_codigos_hash`(`codigo_hash`),
    INDEX `ix_kiosk_codigos_device`(`device_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `ix_kiosk_devices_partner` ON `kiosk_devices`(`odoo_partner_id`);

-- AddForeignKey
ALTER TABLE `kiosk_codigos` ADD CONSTRAINT `fk_kiosk_codigos_device` FOREIGN KEY (`device_id`) REFERENCES `kiosk_devices`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

