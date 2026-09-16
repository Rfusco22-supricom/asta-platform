-- La tabla de compatibilidades mantenida a mano en phpMyAdmin (#56).
--
-- En PRODUCCIÓN ya existe: la creó alguien a mano antes de que el esquema la
-- conociera. Por eso `IF NOT EXISTS`: allí esta migración no hace nada, y en una
-- base nueva (desarrollo, tests, un restore) crea la tabla vacía para que el
-- importador tenga de dónde leer.
--
-- Al hacer la línea base de docs/09, esta migración se marca como aplicada igual
-- que las demás.

CREATE TABLE IF NOT EXISTS `compatibilidad_productos` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(50) NOT NULL,
    `marca` VARCHAR(50) NOT NULL,
    `modelo` TEXT NOT NULL,
    `rendimiento_pag` INTEGER NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
