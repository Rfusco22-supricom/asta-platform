-- El correo de acceso de un cliente puede fijarse desde el panel cuando no
-- puede usar el de su ficha de Odoo y Odoo no se cambia. Con `email_fijado`, la
-- sincronización con Odoo deja de copiar el correo a esa cuenta.
-- Columna nueva con valor por defecto: las cuentas existentes no cambian.

-- AlterTable
ALTER TABLE `app_users` ADD COLUMN `email_fijado` BOOLEAN NOT NULL DEFAULT false;
