-- =============================================================================
-- ASTA — Datos iniciales · MySQL 8.0+
--
-- Aplicar DESPUÉS de 001_schema.sql:
--   mysql -u USUARIO -p asta < db/mysql/002_seed.sql
--
-- Es idempotente: se puede volver a correr sin duplicar nada.
-- =============================================================================

SET NAMES utf8mb4;


-- -----------------------------------------------------------------------------
-- Mapeo tarifa -> nivel
--
-- Verificado contra supricom-prod1-25424683 el 2026-09-11 (issues #3 y #5).
--
-- ESTADO REAL: los 2942 clientes de Odoo apuntan HOY a la misma tarifa, la
-- [15866] "Lista de Precios". Es decir, todos caen en el mismo nivel y la
-- diferenciación de precios está al 0%.
--
-- Las otras dos filas están comentadas porque todavía no existen las tarifas
-- Bronce/Plata/Gold en Odoo. En cuanto el área comercial las cree y defina los
-- descuentos (issue #5), se descomentan con los IDs reales y el nivel de cada
-- cliente empieza a resolverse solo, sin tocar código.
-- -----------------------------------------------------------------------------
INSERT INTO tier_pricelist_map (odoo_pricelist_id, pricelist_name, tier, notes)
VALUES
  (15866, 'Lista de Precios (USD)', 'BRONCE',
   'Tarifa unica en uso al 2026-09-11: los 2942 clientes apuntan aqui. Ver issue #5.')
ON DUPLICATE KEY UPDATE
  pricelist_name = VALUES(pricelist_name),
  notes          = VALUES(notes);

-- Pendientes de crear en Odoo (issue #5):
-- INSERT INTO tier_pricelist_map (odoo_pricelist_id, pricelist_name, tier) VALUES
--   (NULL, 'ASTA - Nivel Plata', 'PLATA'),
--   (NULL, 'ASTA - Nivel Gold',  'GOLD');


-- -----------------------------------------------------------------------------
-- SuperAdmin inicial
--
-- IMPORTANTE: este bloque NO crea contraseña. Deliberadamente.
--
-- Poner un hash de ejemplo en un archivo versionado es como dejar la llave bajo
-- el felpudo: acaba en producción porque nadie se acordó de cambiarla. La
-- contraseña se establece con el CLI, que genera el hash Argon2id y lo guarda:
--
--     pnpm --filter @asta/middleware exec tsx src/cli/set-password.ts \
--          admin@supricom.com.ve
--
-- Ajusta el email y el odoo_partner_id a los reales antes de aplicar.
-- El odoo_partner_id debe existir en res.partner: es la llave que une ambos
-- mundos y el sync lo va a verificar.
-- -----------------------------------------------------------------------------
INSERT INTO app_users (email, full_name, role, odoo_partner_id, odoo_user_id, is_active, sync_status)
VALUES
  ('webmaster02@supricom.com.ve', 'Administrador ASTA', 'SUPERADMIN', 1, 388, TRUE, 'PENDING')
ON DUPLICATE KEY UPDATE
  full_name = VALUES(full_name),
  role      = VALUES(role);


-- -----------------------------------------------------------------------------
-- Comprobación
-- -----------------------------------------------------------------------------
SELECT 'tier_pricelist_map' AS tabla, COUNT(*) AS filas FROM tier_pricelist_map
UNION ALL
SELECT 'app_users', COUNT(*) FROM app_users;
