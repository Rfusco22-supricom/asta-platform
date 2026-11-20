-- El Programa ASTA de un cliente empieza con su primer acceso al panel: quien
-- nunca entró no está en el programa. `primer_acceso_at` guarda ese momento.
--
-- Para las cuentas que ya entraron, el primer acceso es la sesión más antigua
-- que quede (o el último acceso, si no queda ninguna). Las de personal también
-- se rellenan: no se usan en el programa y así la columna dice lo mismo para todos.

-- AlterTable
ALTER TABLE `app_users` ADD COLUMN `primer_acceso_at` DATETIME(3) NULL;

-- Rellenar
UPDATE `app_users` u
  LEFT JOIN (SELECT `user_id`, MIN(`issued_at`) AS `primera` FROM `user_sessions` GROUP BY `user_id`) s ON s.`user_id` = u.`id`
SET u.`primer_acceso_at` = LEAST(COALESCE(s.`primera`, u.`last_login_at`), COALESCE(u.`last_login_at`, s.`primera`))
WHERE s.`primera` IS NOT NULL OR u.`last_login_at` IS NOT NULL;
