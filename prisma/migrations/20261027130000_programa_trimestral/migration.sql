-- El programa de ASTA por trimestres: el cierre de cada trimestre de cada
-- cliente (nivel con el que empezó y acaba, qué cumplió y los tokens).
-- Tabla nueva y vacía. Ver `ProgramaTrimestre` en `prisma/schema.prisma`.

-- CreateTable
CREATE TABLE `programa_trimestres` (
    `id` CHAR(36) NOT NULL,
    `clave` VARCHAR(20) NOT NULL,
    `odoo_partner_id` INTEGER UNSIGNED NOT NULL,
    `trimestre` CHAR(7) NOT NULL,
    `nivel_inicio` ENUM('GENERAL', 'BRONCE', 'PLATA', 'ORO', 'DIAMANTE') NOT NULL,
    `nivel_fin` ENUM('GENERAL', 'BRONCE', 'PLATA', 'ORO', 'DIAMANTE') NOT NULL,
    `compra` DECIMAL(14, 2) NOT NULL,
    `cumple_mensual` BOOLEAN NOT NULL,
    `cumple_trimestral` BOOLEAN NOT NULL,
    `cumple_sellout` BOOLEAN NOT NULL,
    `excedente` BOOLEAN NOT NULL,
    `racha` BOOLEAN NOT NULL,
    `variedad` BOOLEAN NOT NULL,
    `tokens` SMALLINT UNSIGNED NOT NULL,
    `cerrado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `cerrado_por` CHAR(36) NULL,

    INDEX `ix_programa_trimestres_trimestre`(`trimestre`),
    UNIQUE INDEX `uq_programa_trimestres_cliente`(`clave`, `trimestre`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

