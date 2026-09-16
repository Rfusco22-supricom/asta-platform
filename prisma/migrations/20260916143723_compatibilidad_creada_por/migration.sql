-- Quién AÑADIÓ una compatibilidad impresora ↔ cartucho desde el panel (#56).
--
-- Aparte de reviewed_by: un vendedor propone y un administrador valida, y los dos
-- tienen que constar. Null en lo que sale de un importador. Columna nueva y
-- anulable: no toca las filas que ya existen.

-- AlterTable
ALTER TABLE `cartridge_printer_models` ADD COLUMN `created_by` CHAR(36) NULL;

-- AddForeignKey
ALTER TABLE `cartridge_printer_models` ADD CONSTRAINT `fk_cpm_creator` FOREIGN KEY (`created_by`) REFERENCES `app_users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
