-- La tablet del kiosco sabe de qué almacén es y puede rotar su token (#120).
--
-- 1. `odoo_company_id` y `odoo_warehouse_id`: la existencia que publica el
--    recomendador es la del almacén que vende, y una tablet no tiene cliente del
--    que sacarlo. Sin esto, un token de dispositivo no puede responder «¿hay
--    existencias?», que es a lo que va el cliente al kiosco.
--
-- 2. `token_hash_anterior` y `token_rotado_en`: el token se rota a diario (#40),
--    y si la respuesta con el nuevo se pierde, la tablet tiene que poder seguir
--    entrando con el viejo durante 24 h. Índice único porque la autenticación
--    busca por los dos hashes.
--
-- Las dos primeras son NOT NULL sin valor por defecto: una tablet sin almacén no
-- sirve para lo que existe. Medido el 2026-10-01, `kiosk_devices` está vacía en
-- desarrollo y la app del kiosco entra todavía con la API key de la tienda
-- (#118), así que no debería haber filas. Si las hubiera, MySQL les pone 0, y
-- hay que corregirlas a mano antes de darles token de dispositivo.

-- AlterTable
ALTER TABLE `kiosk_devices` ADD COLUMN `odoo_company_id` INTEGER UNSIGNED NOT NULL AFTER `store_location`,
    ADD COLUMN `odoo_warehouse_id` INTEGER UNSIGNED NOT NULL AFTER `odoo_company_id`,
    ADD COLUMN `token_hash_anterior` CHAR(64) NULL AFTER `token_hash`,
    ADD COLUMN `token_rotado_en` DATETIME(3) NULL AFTER `token_hash_anterior`;

-- CreateIndex
CREATE UNIQUE INDEX `uq_kiosk_devices_token_anterior` ON `kiosk_devices`(`token_hash_anterior`);
