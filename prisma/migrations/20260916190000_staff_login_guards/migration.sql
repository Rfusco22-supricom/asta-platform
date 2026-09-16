-- Bloqueo por intentos del personal que entra con su contraseña de Odoo (#85).
--
-- Tabla nueva, vacía: no toca a nadie. Las filas nacen en el primer intento
-- fallido de cada persona del equipo.

CREATE TABLE `staff_login_guards` (
    `user_id` CHAR(36) NOT NULL,
    `failed_attempts` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    `locked_until` DATETIME(3) NULL,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `staff_login_guards` ADD CONSTRAINT `fk_staff_login_guards_user` FOREIGN KEY (`user_id`) REFERENCES `app_users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
