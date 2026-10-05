-- «Impulsa a tus clientes» (#40): qué hizo el vendedor con cada sugerencia
-- (hecha, pospuesta o vuelta a activar), para no repetírsela. Tabla nueva y
-- vacía. Ver `ImpulsaAccion` en `prisma/schema.prisma`.

-- CreateTable
CREATE TABLE `impulsa_acciones` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `odoo_partner_id` INTEGER UNSIGNED NOT NULL,
    `tipo` VARCHAR(32) NOT NULL,
    `clave` VARCHAR(64) NOT NULL,
    `estado` ENUM('ACTIVA', 'HECHA', 'POSPUESTA') NOT NULL,
    `hasta` DATE NULL,
    `firma` VARCHAR(64) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `uq_impulsa_acciones`(`user_id`, `odoo_partner_id`, `tipo`, `clave`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `impulsa_acciones` ADD CONSTRAINT `fk_impulsa_acciones_user` FOREIGN KEY (`user_id`) REFERENCES `app_users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
