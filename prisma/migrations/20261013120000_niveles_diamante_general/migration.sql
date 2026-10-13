-- Dos niveles de cliente nuevos (#131): Diamante, por encima de Oro (GOLD), y
-- Cliente general, por debajo de Bronce. El nivel deja de salir de la tarifa
-- y pasa a ser la categoría de ASTA del cliente (`categoriasAsta.service`).
--
-- Solo AÑADE valores al final de los dos ENUM: ninguna fila existente cambia, y
-- en MySQL añadir al final no reescribe la tabla.

ALTER TABLE `app_users`
  MODIFY `role` ENUM('SUPERADMIN', 'VENDEDOR', 'BRONCE', 'PLATA', 'GOLD', 'DIAMANTE', 'GENERAL') NOT NULL;

ALTER TABLE `tier_pricelist_map`
  MODIFY `tier` ENUM('BRONCE', 'PLATA', 'GOLD', 'DIAMANTE', 'GENERAL') NOT NULL;
