-- Las tres columnas `Json` del modelo, como JSON también en las bases creadas
-- desde las migraciones (#101).
--
-- `0_init` se generó leyendo una base MariaDB, donde JSON es un alias de
-- LONGTEXT, y las escribió como LONGTEXT:
--
--   audit_logs.metadata, odoo_entity_cache.payload, sync_state.resumen
--
-- Producción no tiene el problema: se montó con `001_schema.sql`, donde son
-- JSON. Pero toda base creada desde las migraciones —desarrollo, CI, una
-- restauración— nacía con esa deriva contra `schema.prisma`, y el próximo
-- `migrate dev` sobre una de ellas metería este cambio en una migración que no
-- tiene nada que ver. Lo anotó @LinoGouveia en #101 para `resumen`; las otras
-- dos tienen el mismo origen.
--
-- Cada ALTER se ejecuta SOLO si la columna no es ya JSON. En producción no se
-- toca nada: un ALTER sobre `audit_logs` podría reconstruir la tabla entera
-- para dejarla igual. En MariaDB `DATA_TYPE` dice `longtext` también para JSON,
-- así que allí se aplica siempre, y lo que hace es añadir el CHECK de
-- `json_valid` que MariaDB usa para su JSON.

SET @sql := (
  SELECT IF(DATA_TYPE = 'json', 'DO 0', 'ALTER TABLE `audit_logs` MODIFY `metadata` JSON NULL')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'audit_logs' AND COLUMN_NAME = 'metadata'
);
PREPARE paso FROM @sql;
EXECUTE paso;
DEALLOCATE PREPARE paso;

SET @sql := (
  SELECT IF(DATA_TYPE = 'json', 'DO 0', 'ALTER TABLE `odoo_entity_cache` MODIFY `payload` JSON NOT NULL')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'odoo_entity_cache' AND COLUMN_NAME = 'payload'
);
PREPARE paso FROM @sql;
EXECUTE paso;
DEALLOCATE PREPARE paso;

SET @sql := (
  SELECT IF(DATA_TYPE = 'json', 'DO 0', 'ALTER TABLE `sync_state` MODIFY `resumen` JSON NULL')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sync_state' AND COLUMN_NAME = 'resumen'
);
PREPARE paso FROM @sql;
EXECUTE paso;
DEALLOCATE PREPARE paso;
