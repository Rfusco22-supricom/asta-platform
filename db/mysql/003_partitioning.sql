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
-- Toda clave única (incluida la primaria) de una tabla particionada DEBE incluir
-- la columna de partición. Es decir: `PRIMARY KEY (id)` pasa a ser
-- `PRIMARY KEY (id, created_at)`.
--
-- Consecuencia: `id` deja de ser único por sí solo a ojos del motor. Para una
-- bitácora de accesos da igual —nadie busca un log por id suelto, se busca por
-- key y por fecha— pero NO hagas esto con tablas donde el id sea una referencia
-- real. Por eso `audit_logs` se deja sin particionar: ahí sí se cita un id.
-- -----------------------------------------------------------------------------

ALTER TABLE api_request_logs
  DROP PRIMARY KEY,
  ADD PRIMARY KEY (id, created_at);

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
  DECLARE v_cutoff     DATE;

  -- ── 1. Crear la partición del mes que viene, si no existe ────────────────
  SET v_next_name  = DATE_FORMAT(DATE_ADD(CURDATE(), INTERVAL 2 MONTH), 'p%Y_%m');
  SET v_next_limit = DATE_FORMAT(DATE_ADD(CURDATE(), INTERVAL 2 MONTH), '%Y-%m-01');

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.PARTITIONS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'api_request_logs'
      AND PARTITION_NAME = v_next_name
  ) THEN
    SET @sql = CONCAT(
      'ALTER TABLE api_request_logs REORGANIZE PARTITION p_max INTO (',
      'PARTITION ', v_next_name, ' VALUES LESS THAN (''', v_next_limit, '''), ',
      'PARTITION p_max VALUES LESS THAN (MAXVALUE))'
    );
    PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;
  END IF;

  -- ── 2. Tirar las particiones de más de 90 días ───────────────────────────
  SET v_cutoff = DATE_SUB(CURDATE(), INTERVAL 90 DAY);

  SELECT PARTITION_NAME INTO v_old_name
  FROM information_schema.PARTITIONS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'api_request_logs'
    AND PARTITION_NAME <> 'p_max'
    AND PARTITION_DESCRIPTION < CONCAT('''', v_cutoff, '''')
  ORDER BY PARTITION_ORDINAL_POSITION
  LIMIT 1;

  IF v_old_name IS NOT NULL THEN
    -- ANTES de tirar nada: los agregados históricos por cliente deberían estar
    -- ya calculados y guardados. Perder el detalle es aceptable; perder el
    -- "cuánto consumió este cliente en marzo" no lo es.
    SET @sql = CONCAT('ALTER TABLE api_request_logs DROP PARTITION ', v_old_name);
    PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;
  END IF;
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
