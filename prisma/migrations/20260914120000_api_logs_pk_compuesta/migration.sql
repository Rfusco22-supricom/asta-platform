-- Primaria compuesta en api_request_logs (issue #47)
--
-- MySQL exige que TODA clave única de una tabla particionada incluya la columna
-- de partición. Esta tabla se particiona por `created_at` en
-- db/mysql/003_partitioning.sql, así que su primaria tiene que ser
-- `(id, created_at)`.
--
-- Antes la primaria era `(id)` y era el propio 003 quien la cambiaba con un
-- ALTER. Eso dejaba una bomba de relojería: en cuanto se aplicaba el
-- particionado, `prisma migrate diff` veía deriva y quería DESHACERLO. La
-- siguiente migración habría intentado devolver la primaria a `(id)` —imposible
-- sobre una tabla particionada— o desparticionado la tabla en producción.
--
-- Comprobado contra una base real: con 003 aplicado, el diff pedía
--   ALTER TABLE `api_request_logs` DROP PRIMARY KEY, ADD PRIMARY KEY (`id`);
-- Con este cambio, no pide nada.
--
-- En una tabla sin particionar la primaria compuesta no molesta: `id` sigue
-- siendo autoincremental y único de hecho.

ALTER TABLE `api_request_logs` DROP PRIMARY KEY,
    ADD PRIMARY KEY (`id`, `created_at`);
