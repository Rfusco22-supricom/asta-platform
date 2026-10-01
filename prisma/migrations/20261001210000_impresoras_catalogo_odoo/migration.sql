-- Impresoras que Supricom vende, del catálogo de Odoo (#40). Ver
-- `PrinterModel.inOdooCatalog` en `prisma/schema.prisma`.
--
-- Columna nueva con valor por defecto: las filas que ya hay quedan en `false`,
-- que es exactamente lo que eran. Los permisos de `asta_app` son por tabla, así
-- que no hace falta tocarlos.

-- AlterTable
ALTER TABLE `printer_models` ADD COLUMN `in_odoo_catalog` BOOLEAN NOT NULL DEFAULT false;
