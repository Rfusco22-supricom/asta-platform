-- =============================================================================
-- ASTA — Usuarios de MySQL con privilegio mínimo · issue #44
--
--   mysql -u root -p < db/mysql/004_usuarios.sql
--
-- ANTES DE APLICARLO: sustituye los tres CAMBIA_ESTA_* por contraseñas
-- generadas al azar, y NO guardes el fichero resultante en el repositorio.
-- Solo la de la aplicación va al `.env` del middleware; las otras dos viven
-- donde vivan las credenciales de operación, no en el despliegue.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Por qué existe esto
--
-- El esquema original vivía en PostgreSQL con Row Level Security. El RLS era la
-- SEGUNDA línea de defensa: aunque el middleware tuviera un fallo de scoping, la
-- base se negaba a devolver filas de otro cliente.
--
-- MySQL no tiene RLS. Esa red desapareció y no hay equivalente, así que hoy el
-- aislamiento entre clientes depende ÚNICAMENTE del `where` que arma el
-- middleware. Lo que sí se puede hacer es acotar el daño: si algún día se
-- ejecuta SQL que no debía, que el usuario con el que se ejecuta pueda hacer lo
-- menos posible.
--
-- Hoy la aplicación se conecta como `root`. Es decir: un fallo de inyección o un
-- servidor comprometido puede borrar la base entera, leer `mysql.user` y escribir
-- ficheros en el disco del servidor. Eso es lo que este fichero cierra.
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- Tres usuarios, tres trabajos
--
--   asta_app        lo que usa el middleware en marcha. Sin DDL y SIN DELETE.
--   asta_migrador   aplica migraciones. Solo en una ventana controlada.
--   asta_lectura    informes y depuración. Solo SELECT, y no sobre todo.
--
-- Ninguno recibe `GRANT ALL`, ninguno toca `*.*`. Con permisos acotados a una
-- base, MySQL deja el usuario en `USAGE ON *.*`, que es el privilegio nulo: sin
-- FILE, sin PROCESS y sin SUPER. No hay que revocarlos porque nunca se conceden
-- —comprobado: con este usuario `LOAD_FILE()` devuelve NULL y la lista de
-- procesos solo muestra la conexión propia—.
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- EL HOST HAY QUE CAMBIARLO A MANO
--
-- Todo lo de abajo dice `@'localhost'`, que es la topología de desarrollo. MySQL
-- no permite parametrizar el host de un GRANT, así que hay que buscar y
-- reemplazar antes de aplicarlo en otro sitio.
--
-- En EasyPanel los contenedores NO son localhost: será la red de Docker o el
-- nombre del servicio. Si se aplica tal cual, la aplicación no conectará — que
-- es un fallo ruidoso, y por eso preferible a poner '%' "por si acaso" y dejar
-- el usuario accesible desde cualquier sitio.
-- -----------------------------------------------------------------------------

-- =============================================================================
-- 1. asta_app — el middleware en marcha
-- =============================================================================

CREATE USER IF NOT EXISTS 'asta_app'@'localhost' IDENTIFIED BY 'CAMBIA_ESTA_APP';

-- -----------------------------------------------------------------------------
-- NO LLEVA DELETE. A propósito, y no es un descuido.
--
-- Se revisó el código entero: la aplicación NUNCA borra una fila en producción.
-- Las notas se borran en suave (`deleted_at`), las sesiones se revocan
-- (`revoked_at`) y las API keys también. Los únicos `.delete()` fuera de los
-- tests son de un `Map` en memoria y verbos de rutas de Express.
--
-- Así que conceder DELETE sería regalar la capacidad de destruir datos a cambio
-- de nada. Si algún día hace falta de verdad, que falle ruidosamente aquí y se
-- discuta, en vez de estar concedido "por si acaso" desde el día uno.
-- -----------------------------------------------------------------------------

-- Identidad y acceso.
GRANT SELECT, INSERT, UPDATE ON asta.app_users        TO 'asta_app'@'localhost';
GRANT SELECT, INSERT, UPDATE ON asta.user_credentials TO 'asta_app'@'localhost';
GRANT SELECT, INSERT, UPDATE ON asta.user_sessions    TO 'asta_app'@'localhost';
GRANT SELECT, INSERT, UPDATE ON asta.auth_tokens      TO 'asta_app'@'localhost';

-- Datos operativos del panel.
GRANT SELECT, INSERT, UPDATE ON asta.client_notes     TO 'asta_app'@'localhost';
GRANT SELECT, INSERT, UPDATE ON asta.sync_state       TO 'asta_app'@'localhost';
GRANT SELECT, INSERT, UPDATE ON asta.odoo_entity_cache TO 'asta_app'@'localhost';

-- API pública del cliente. `revocar` es un UPDATE, no un DELETE.
GRANT SELECT, INSERT, UPDATE ON asta.api_keys             TO 'asta_app'@'localhost';
GRANT SELECT, INSERT         ON asta.api_key_scopes       TO 'asta_app'@'localhost';
GRANT SELECT, INSERT         ON asta.api_key_allowed_ips  TO 'asta_app'@'localhost';

-- -----------------------------------------------------------------------------
-- Las bitácoras: se escriben y se leen. NO se modifican.
--
-- Un registro de auditoría que la aplicación puede reescribir no es un registro
-- de auditoría. Si el middleware queda comprometido, lo primero que hará quien
-- entre es borrar su rastro; sin UPDATE ni DELETE sobre estas tablas, no puede.
-- Es la mitad de "detección" del issue #44, y cuesta una palabra menos.
-- -----------------------------------------------------------------------------
GRANT SELECT, INSERT ON asta.audit_logs           TO 'asta_app'@'localhost';
GRANT SELECT, INSERT ON asta.api_request_logs     TO 'asta_app'@'localhost';
GRANT SELECT, INSERT ON asta.recommendation_events TO 'asta_app'@'localhost';

-- -----------------------------------------------------------------------------
-- Configuración: solo lectura.
--
-- `tier_pricelist_map` la escribe el seed, no la aplicación. Que el middleware
-- no pueda cambiar a qué nivel corresponde una tarifa es deseable: eso decide
-- qué precios ve cada cliente.
-- -----------------------------------------------------------------------------
GRANT SELECT ON asta.tier_pricelist_map TO 'asta_app'@'localhost';

-- -----------------------------------------------------------------------------
-- Kiosco (Fase 5). Concedido aunque todavía no haya código que lo use.
--
-- Va contra la regla de no conceder lo que no se usa, y se hace a sabiendas: son
-- tablas de esta misma aplicación, hoy vacías, y el coste de equivocarse al alza
-- es bajo comparado con el de un kiosco que falla en una tienda por un permiso
-- que nadie recordó dar. Revisar cuando la Fase 5 exista de verdad.
-- -----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON asta.kiosk_devices  TO 'asta_app'@'localhost';
GRANT SELECT, INSERT, UPDATE ON asta.kiosk_sessions TO 'asta_app'@'localhost';

-- -----------------------------------------------------------------------------
-- LOS TESTS NO PUEDEN CORRER CON ESTE USUARIO, y está bien así.
--
-- Se comprobó: con `asta_app` la batería entera da 206 pasando y 0 fallando, y
-- la ÚNICA operación denegada en todo el recorrido es
--
--   DELETE command denied to user 'asta_app' for table `asta`.`app_users`
--
-- que sale de la limpieza de fixtures en los `afterAll`, no de ningún camino de
-- la aplicación. Eso es justamente la prueba de que quitar DELETE es seguro: si
-- algo del producto lo necesitara, habría salido aquí.
--
-- Los tests, por tanto, corren contra una base de DESARROLLO con un usuario que
-- sí puede borrar (en local, root). No se crea un cuarto usuario para esto
-- mientras no haya CI (issue #13): sería una credencial más que mantener para
-- una máquina que todavía no existe.
-- -----------------------------------------------------------------------------

-- `_prisma_migrations` NO se concede. La aplicación no la lee en marcha —solo la
-- CLI de Prisma, que corre como asta_migrador—, y desde aquí solo serviría para
-- falsificar el historial de migraciones.

-- =============================================================================
-- 2. asta_migrador — aplica el esquema
-- =============================================================================

CREATE USER IF NOT EXISTS 'asta_migrador'@'localhost' IDENTIFIED BY 'CAMBIA_ESTA_MIGRADOR';

-- -----------------------------------------------------------------------------
-- Este sí necesita DDL, y por eso no es el de la aplicación.
--
-- Se usa a mano, en una ventana de mantenimiento, para `pnpm migrate:deploy` y
-- para aplicar 003_partitioning.sql. Su contraseña NO va en el `.env` del
-- despliegue: si estuviera ahí, tener dos usuarios no serviría de nada.
--
-- EVENT y las rutinas hacen falta para el particionado (003), que crea un evento
-- programado y procedimientos de purga.
-- -----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE,
      CREATE, ALTER, DROP, INDEX, REFERENCES,
      CREATE VIEW, SHOW VIEW,
      CREATE ROUTINE, ALTER ROUTINE, EXECUTE,
      TRIGGER, EVENT, LOCK TABLES
  ON asta.* TO 'asta_migrador'@'localhost';

-- =============================================================================
-- 3. asta_lectura — informes y depuración
-- =============================================================================

CREATE USER IF NOT EXISTS 'asta_lectura'@'localhost' IDENTIFIED BY 'CAMBIA_ESTA_LECTURA';

-- -----------------------------------------------------------------------------
-- SELECT, pero NO sobre todo.
--
-- Se conceden las tablas una a una en vez de `asta.*`, y se dejan fuera las tres
-- cuyo contenido ES material de credencial:
--
--   user_credentials   hashes de contraseña
--   auth_tokens        hashes de los enlaces de invitación
--   api_keys           hashes de las claves de API
--
-- Ninguno de los tres es reversible, así que el riesgo real es acotado. Pero un
-- usuario "de informes" que puede leer todos los hashes del sistema no es un
-- usuario de informes, y nadie que pida acceso para depurar necesita eso.
--
-- El precio de ir tabla a tabla es que una tabla NUEVA no será legible hasta que
-- alguien la añada aquí. Es deliberado: preferimos un informe que falla a la
-- vista —y se arregla— antes que una tabla nueva legible en silencio, incluida
-- la siguiente que guarde secretos. `pnpm check:grants` avisa de las que falten.
-- -----------------------------------------------------------------------------
GRANT SELECT ON asta.app_users             TO 'asta_lectura'@'localhost';
GRANT SELECT ON asta.user_sessions         TO 'asta_lectura'@'localhost';
GRANT SELECT ON asta.client_notes          TO 'asta_lectura'@'localhost';
GRANT SELECT ON asta.audit_logs            TO 'asta_lectura'@'localhost';
GRANT SELECT ON asta.api_request_logs      TO 'asta_lectura'@'localhost';
GRANT SELECT ON asta.api_key_scopes        TO 'asta_lectura'@'localhost';
GRANT SELECT ON asta.api_key_allowed_ips   TO 'asta_lectura'@'localhost';
GRANT SELECT ON asta.sync_state            TO 'asta_lectura'@'localhost';
GRANT SELECT ON asta.tier_pricelist_map    TO 'asta_lectura'@'localhost';
GRANT SELECT ON asta.odoo_entity_cache     TO 'asta_lectura'@'localhost';
GRANT SELECT ON asta.kiosk_devices         TO 'asta_lectura'@'localhost';
GRANT SELECT ON asta.kiosk_sessions        TO 'asta_lectura'@'localhost';
GRANT SELECT ON asta.recommendation_events TO 'asta_lectura'@'localhost';

FLUSH PRIVILEGES;

-- =============================================================================
-- Comprobación
-- =============================================================================
--
--   SHOW GRANTS FOR 'asta_app'@'localhost';
--
-- La primera línea debe decir exactamente `GRANT USAGE ON *.*`. Si dice
-- cualquier otra cosa —y sobre todo si dice ALL PRIVILEGES— alguien amplió los
-- permisos y hay que averiguar por qué.
--
-- Y desde el repositorio:
--
--   pnpm check:grants
--
-- que compara las tablas que existen contra las concedidas y avisa de las que
-- nadie ha decidido todavía.
-- =============================================================================
