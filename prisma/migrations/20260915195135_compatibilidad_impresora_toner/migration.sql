-- Compatibilidad impresora ↔ tóner (issues #56 y #101)
--
-- Seis tablas nuevas y una clave foránea sobre una que ya existía. El diseño y
-- el porqué de cada decisión están en `prisma/schema.prisma`, que para estas
-- tablas es la fuente: se escribieron ahí y esta migración es su reflejo.
--
-- ── Lo único que puede fallar al aplicarla ───────────────────────────────────
--
-- El último `ALTER` ata `recommendation_events.matched_printer_id` a
-- `printer_models`. Si esa tabla ya tuviera filas con un `matched_printer_id`
-- que no existe —imposible antes, porque no había a qué apuntar—, MySQL
-- rechazaría la clave foránea con «Cannot add or update a child row» y la
-- migración quedaría a medias.
--
-- Hoy la telemetría del recomendador está vacía: el kiosco no existe todavía.
-- Si alguna vez se aplica sobre una base con datos, esto lo dice antes:
--
--   SELECT COUNT(*) FROM recommendation_events WHERE matched_printer_id IS NOT NULL;
--
-- Si no da 0, hay que poner esos valores a NULL antes de aplicar. Perder ese
-- campo en filas viejas no cuesta nada: apuntaba a una tabla que no existía.

-- CreateTable
CREATE TABLE `printer_brands` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(60) NOT NULL,
    `odoo_brand_id` INTEGER UNSIGNED NULL,

    UNIQUE INDEX `uq_printer_brands_name`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `printer_models` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `brand_id` INTEGER UNSIGNED NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `name_normalized` VARCHAR(120) NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `ix_printer_models_name`(`name_normalized`),
    UNIQUE INDEX `uq_printer_models_brand_name`(`brand_id`, `name_normalized`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `printer_model_aliases` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `printer_model_id` INTEGER UNSIGNED NOT NULL,
    `alias` VARCHAR(120) NOT NULL,
    `alias_normalized` VARCHAR(120) NOT NULL,
    `source` ENUM('FABRICANTE', 'PARSEO', 'MANUAL', 'BUSQUEDA') NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ix_aliases_alias`(`alias_normalized`),
    UNIQUE INDEX `uq_aliases_model_alias`(`printer_model_id`, `alias_normalized`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cartridges` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `brand_id` INTEGER UNSIGNED NOT NULL,
    `code` VARCHAR(40) NOT NULL,
    `code_normalized` VARCHAR(40) NOT NULL,
    `kind` ENUM('TONER', 'TINTA', 'DRUM', 'OTRO') NOT NULL,
    `color` VARCHAR(20) NULL,
    `yield_pages` INTEGER UNSIGNED NULL,

    UNIQUE INDEX `uq_cartridges_brand_code`(`brand_id`, `code_normalized`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cartridge_printer_models` (
    `cartridge_id` INTEGER UNSIGNED NOT NULL,
    `printer_model_id` INTEGER UNSIGNED NOT NULL,
    `source` ENUM('FABRICANTE', 'PARSEO', 'MANUAL', 'BUSQUEDA') NOT NULL,
    `source_ref` VARCHAR(255) NULL,
    `status` ENUM('PROPUESTA', 'VALIDADA', 'RECHAZADA') NOT NULL DEFAULT 'PROPUESTA',
    `reviewed_by` CHAR(36) NULL,
    `reviewed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ix_cpm_printer_status`(`printer_model_id`, `status`),
    PRIMARY KEY (`cartridge_id`, `printer_model_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `product_cartridges` (
    `odoo_product_tmpl_id` INTEGER UNSIGNED NOT NULL,
    `cartridge_id` INTEGER UNSIGNED NOT NULL,
    `relation` ENUM('ORIGINAL', 'COMPATIBLE') NOT NULL,
    `source` ENUM('FABRICANTE', 'PARSEO', 'MANUAL', 'BUSQUEDA') NOT NULL,
    `evidence` VARCHAR(255) NULL,
    `status` ENUM('PROPUESTA', 'VALIDADA', 'RECHAZADA') NOT NULL DEFAULT 'PROPUESTA',
    `reviewed_by` CHAR(36) NULL,
    `reviewed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ix_pc_cartridge_status`(`cartridge_id`, `status`),
    PRIMARY KEY (`odoo_product_tmpl_id`, `cartridge_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `recommendation_events` ADD CONSTRAINT `fk_reco_printer` FOREIGN KEY (`matched_printer_id`) REFERENCES `printer_models`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `printer_models` ADD CONSTRAINT `fk_printer_models_brand` FOREIGN KEY (`brand_id`) REFERENCES `printer_brands`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `printer_model_aliases` ADD CONSTRAINT `fk_aliases_model` FOREIGN KEY (`printer_model_id`) REFERENCES `printer_models`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cartridges` ADD CONSTRAINT `fk_cartridges_brand` FOREIGN KEY (`brand_id`) REFERENCES `printer_brands`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cartridge_printer_models` ADD CONSTRAINT `fk_cpm_cartridge` FOREIGN KEY (`cartridge_id`) REFERENCES `cartridges`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cartridge_printer_models` ADD CONSTRAINT `fk_cpm_printer` FOREIGN KEY (`printer_model_id`) REFERENCES `printer_models`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cartridge_printer_models` ADD CONSTRAINT `fk_cpm_reviewer` FOREIGN KEY (`reviewed_by`) REFERENCES `app_users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_cartridges` ADD CONSTRAINT `fk_pc_cartridge` FOREIGN KEY (`cartridge_id`) REFERENCES `cartridges`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_cartridges` ADD CONSTRAINT `fk_pc_reviewer` FOREIGN KEY (`reviewed_by`) REFERENCES `app_users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
