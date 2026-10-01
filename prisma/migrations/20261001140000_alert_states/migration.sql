-- Memoria de las alertas de operación (#46): qué se avisó y cuándo, para no
-- repetir en cada pasada del cron lo que ya se dijo. Tabla nueva y vacía.

-- CreateTable
CREATE TABLE `alert_states` (
    `id` VARCHAR(64) NOT NULL,
    `severity` VARCHAR(10) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `since` DATETIME(3) NOT NULL,
    `last_notified_at` DATETIME(3) NOT NULL,
    `resolved_at` DATETIME(3) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

