-- =============================================================================
-- ASTA — Particionado y retención de las tablas de alto volumen · MySQL 8.0+
--
-- OPCIONAL. Aplicar cuando `api_request_logs` empiece a crecer de verdad, no en
-- el día 1: particionar una tabla vacía solo añade complejidad.
--
--   mysql -u USUARIO -p asta < db/mysql/003_partitioning.sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- El compromiso que impone MySQL
--
-- DOS restricciones, no una:
--
--   1. La tabla no puede tener NINGUNA clave foránea, ni saliente ni entrante.
--      Por eso `api_request_logs` guarda `api_key_id` como columna suelta y
--      `odoo_partner_id` desnormalizado: la integridad la mantiene la
--      aplicación, que es la única que escribe ahí.
--
--   2. Toda clave única (incluida la primaria) DEBE incluir la columna de
--      partición. Es decir: `PRIMARY KEY (id)` pasa a ser
-- `PRIMARY KEY (id, created_at)`.
--
-- Consecuencia: `id` deja de ser único por sí solo a ojos del motor. Para una
-- bitácora de accesos da igual —nadie busca un log por id suelto, se busca por
-- key y por fecha— pero NO hagas esto con tablas donde el id sea una referencia
-- real. Por eso `audit_logs` se deja sin particionar: ahí sí se cita un id.
-- -----------------------------------------------------------------------------

-- Requisito previo: la tabla NO puede tener claves foráneas. Desde 001_schema
-- ya se crea sin ellas, pero si vienes de una versión anterior del esquema hay
-- que retirarla primero, o el ALTER falla con:
--     ERROR 1217: Cannot delete or update a parent row
SET @fk := (
  SELECT constraint_name FROM information_schema.referential_constraints
  WHERE constraint_schema = DATABASE() AND table_name = 'api_request_logs' LIMIT 1
);
SET @sql := IF(@fk IS NULL, 'SELECT 1',
  CONCAT('ALTER TABLE api_request_logs DROP FOREIGN KEY ', @fk));
PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;

-- -----------------------------------------------------------------------------
-- La primaria YA es (id, created_at). No se toca aqui.
--
-- Antes este fichero la cambiaba con un ALTER, y eso dejaba una bomba: en
-- cuanto se aplicaba el particionado, `prisma migrate diff` veia deriva y
-- queria deshacerlo. La siguiente migracion habria intentado devolver la
-- primaria a `(id)` —imposible sobre una tabla particionada— o desparticionado
-- la tabla en produccion.
--
-- Ahora la primaria compuesta viene de 001_schema.sql y de schema.prisma, este
-- la tabla particionada o no. Comprobado: tras aplicar este fichero, el diff
-- contra schema.prisma sale vacio.
-- -----------------------------------------------------------------------------

ALTER TABLE api_request_logs
  PARTITION BY RANGE COLUMNS (created_at) (
    PARTITION p2026_09 VALUES LESS THAN ('2026-10-01'),
    PARTITION p2026_10 VALUES LESS THAN ('2026-11-01'),
    PARTITION p2026_11 VALUES LESS THAN ('2026-12-01'),
    PARTITION p2026_12 VALUES LESS THAN ('2027-01-01'),
    PARTITION p2027_01 VALUES LESS THAN ('2027-02-01'),
    PARTITION p_max    VALUES LESS THAN (MAXVALUE)
  );


-- -----------------------------------------------------------------------------
-- Mantenimiento mensual
--
-- Purgar con DROP PARTITION y no con DELETE. Un DELETE de millones de filas
-- bloquea, infla el log de transacciones y deja el espacio sin devolver al
-- sistema operativo. DROP PARTITION es instantáneo y libera el archivo.
--
-- Este procedimiento crea la partición del mes siguiente y tira las de más de
-- 90 días. Se programa con un EVENT (abajo) o con cron.
-- -----------------------------------------------------------------------------

DROP PROCEDURE IF EXISTS sp_rotate_api_log_partitions;

DELIMITER //

CREATE PROCEDURE sp_rotate_api_log_partitions()
BEGIN
  DECLARE v_next_name  VARCHAR(16);
  DECLARE v_next_limit VARCHAR(12);
  DECLARE v_old_name   VARCHAR(64);
  DECLARE v_periodo    CHAR(7);
  DECLARE v_cutoff     DATE;
  DECLARE v_ultimo     DATE;
  DECLARE v_objetivo   VARCHAR(12);
  DECLARE v_quedan     INT DEFAULT 1;

  -- ── 1. Crear TODAS las particiones que falten, hasta dos meses por delante ─
  --
  -- En bucle desde donde acaba la última partición real, no creando solo la de
  -- dentro de dos meses. La diferencia no es cosmética: si el trabajo se salta
  -- un mes, crear solo la de +2 deja un HUECO. Y un hueco no da error — las
  -- filas del mes que falta caen en la siguiente partición, que se llama como
  -- OTRO mes.
  --
  -- Eso es pérdida de datos silenciosa: al purgar esa partición, el agregado se
  -- calcula para el mes de su nombre, y las filas del mes sin partición se
  -- borran sin haber sido agregadas nunca. Se detectó ejecutando esto de verdad:
  -- quedaban p2026_09 y p2026_11, y octubre no existía.
  --
  -- El margen de dos meses también importa: con uno solo, un mes sin ejecutar y
  -- las filas nuevas caen en `p_max`. Una vez que hay filas ahí, `p_max` ya no
  -- se puede partir sin reorganizarla entera, que con millones de filas bloquea
  -- la tabla.
  SELECT MAX(CAST(REPLACE(PARTITION_DESCRIPTION, '''', '') AS DATE)) INTO v_ultimo
    FROM information_schema.PARTITIONS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'api_request_logs'
     AND PARTITION_NAME <> 'p_max';

  SET v_objetivo = DATE_FORMAT(DATE_ADD(CURDATE(), INTERVAL 3 MONTH), '%Y-%m-01');

  WHILE v_ultimo IS NOT NULL AND v_ultimo < v_objetivo DO
    -- Una partición llamada pYYYY_MM contiene el mes YYYY-MM, así que su límite
    -- es el día 1 del mes SIGUIENTE. `v_ultimo` es justo el día 1 del primer mes
    -- todavía sin cubrir.
    SET v_next_name  = DATE_FORMAT(v_ultimo, 'p%Y_%m');
    SET v_next_limit = DATE_FORMAT(DATE_ADD(v_ultimo, INTERVAL 1 MONTH), '%Y-%m-01');

    SET @sql = CONCAT(
      'ALTER TABLE api_request_logs REORGANIZE PARTITION p_max INTO (',
      'PARTITION ', v_next_name, ' VALUES LESS THAN (''', v_next_limit, '''), ',
      'PARTITION p_max VALUES LESS THAN (MAXVALUE))'
    );
    PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;

    SET v_ultimo = CAST(v_next_limit AS DATE);
  END WHILE;

  -- ── 2. Purgar lo de más de 90 días ───────────────────────────────────────
  --
  -- EN BUCLE, no una sola partición por ejecución. Si el trabajo no corre
  -- durante unos meses, al volver hay varias vencidas; tirando una por vez
  -- harían falta otros tantos meses para ponerse al día, y mientras tanto se
  -- guardan datos que se dijo que se iban a purgar.
  SET v_cutoff = DATE_SUB(CURDATE(), INTERVAL 90 DAY);

  WHILE v_quedan > 0 DO
    SET v_old_name = NULL;

    SELECT PARTITION_NAME INTO v_old_name
      FROM information_schema.PARTITIONS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'api_request_logs'
       AND PARTITION_NAME <> 'p_max'
       AND PARTITION_DESCRIPTION < CONCAT('''', v_cutoff, '''')
     ORDER BY PARTITION_ORDINAL_POSITION
     LIMIT 1;

    IF v_old_name IS NULL THEN
      SET v_quedan = 0;
    ELSE
      -- ── PRIMERO los agregados. Luego se tira. ──────────────────────────
      --
      -- En el mismo procedimiento a propósito. Separarlo en dos trabajos es
      -- garantizar que algún día se ejecute solo el segundo y el consumo de un
      -- mes desaparezca sin que nadie se entere, hasta que un cliente discuta
      -- su factura.
      --
      -- La partición pYYYY_MM contiene las filas anteriores a su límite, que
      -- son las del propio mes YYYY-MM.
      SET v_periodo = CONCAT(SUBSTRING(v_old_name, 2, 4), '-', SUBSTRING(v_old_name, 7, 2));

      INSERT INTO api_usage_monthly
            (odoo_partner_id, periodo, peticiones, errores, duracion_total_ms, odoo_calls, calculado_en)
      SELECT odoo_partner_id,
             v_periodo,
             COUNT(*),
             SUM(status_code >= 400),
             SUM(duration_ms),
             SUM(odoo_calls),
             UTC_TIMESTAMP(3)
        FROM api_request_logs
       WHERE odoo_partner_id IS NOT NULL
         AND DATE_FORMAT(created_at, '%Y-%m') = v_periodo
       GROUP BY odoo_partner_id
      -- Idempotente: si esto se ejecuta dos veces, o si alguien ya calculó el
      -- periodo a mano, se reemplaza en vez de fallar por clave duplicada y
      -- dejar la purga a medias.
          ON DUPLICATE KEY UPDATE
             peticiones        = VALUES(peticiones),
             errores           = VALUES(errores),
             duracion_total_ms = VALUES(duracion_total_ms),
             odoo_calls        = VALUES(odoo_calls),
             calculado_en      = VALUES(calculado_en);

      SET @sql = CONCAT('ALTER TABLE api_request_logs DROP PARTITION ', v_old_name);
      PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;
    END IF;
  END WHILE;
END //

DELIMITER ;


-- -----------------------------------------------------------------------------
-- Programación
--
-- Requiere que el scheduler esté activo:  SET GLOBAL event_scheduler = ON;
-- En hosting gestionado suele estar apagado y no siempre se puede encender; en
-- ese caso, llamar al procedimiento desde un cron del sistema.
-- -----------------------------------------------------------------------------

-- CREATE EVENT IF NOT EXISTS ev_rotate_api_log_partitions
--   ON SCHEDULE EVERY 1 MONTH
--   STARTS (TIMESTAMP(DATE_FORMAT(DATE_ADD(CURDATE(), INTERVAL 1 MONTH), '%Y-%m-01')) + INTERVAL 3 HOUR)
--   DO CALL sp_rotate_api_log_partitions();


-- -----------------------------------------------------------------------------
-- Limpieza de tablas efímeras
--
-- Estas no se particionan: se vacían solas. Conviene un cron diario.
-- -----------------------------------------------------------------------------

DROP PROCEDURE IF EXISTS sp_cleanup_expired;

DELIMITER //

CREATE PROCEDURE sp_cleanup_expired()
BEGIN
  -- Sesiones de kiosco vencidas: dispositivo compartido, no deben quedar abiertas.
  UPDATE kiosk_sessions
     SET ended_at = NOW(3), ended_reason = 'timeout'
   WHERE ended_at IS NULL AND expires_at < NOW(3);

  DELETE FROM kiosk_sessions
   WHERE ended_at IS NOT NULL AND ended_at < DATE_SUB(NOW(3), INTERVAL 30 DAY);

  -- Tokens de un solo uso ya vencidos o gastados.
  DELETE FROM auth_tokens
   WHERE expires_at < NOW(3) OR used_at IS NOT NULL;

  -- Refresh tokens caducados o revocados hace tiempo.
  DELETE FROM user_sessions
   WHERE expires_at < DATE_SUB(NOW(3), INTERVAL 7 DAY)
      OR (revoked_at IS NOT NULL AND revoked_at < DATE_SUB(NOW(3), INTERVAL 30 DAY));

  -- Cache de Odoo vencida.
  DELETE FROM odoo_entity_cache WHERE expires_at < NOW(3);
END //

DELIMITER ;

-- CREATE EVENT IF NOT EXISTS ev_cleanup_expired
--   ON SCHEDULE EVERY 1 DAY
--   DO CALL sp_cleanup_expired();
