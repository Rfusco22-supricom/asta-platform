-- =============================================================================
-- ASTA — Usuarios de MySQL con privilegio mínimo · issue #44
--
--   mysql -u root -p < db/mysql/004_usuarios.sql
--
-- ANTES DE APLICARLO: sustituye cada <CAMBIA_ESTA_*> por una contraseña
-- generada al azar ENTRE COMILLAS, y NO guardes el fichero resultante en el
-- repositorio. Solo la de la aplicación va al `.env` del middleware; las otras
-- dos viven donde vivan las credenciales de operación, no en el despliegue.
--
--     IDENTIFIED BY <CAMBIA_ESTA_XXX>      ->  IDENTIFIED BY 'x7Kq...'
--
-- (El ejemplo usa XXX, que no es ningún usuario, para que un `sed` sobre los tres
-- marcadores reales no escriba la contraseña también en este comentario.)
--
-- Cada contraseña aparece DOS veces (en el CREATE y en el ALTER de su usuario):
-- pon la misma en los dos sitios. Para comprobar que no queda ninguno sin
-- sustituir, ignorando los comentarios:
--
--     grep -v '^--' db/mysql/004_usuarios.sql | grep -c '<CAMBIA_ESTA_'
--
-- tiene que dar 0.
--
-- -----------------------------------------------------------------------------
-- Por qué los marcadores van SIN comillas
--
-- A propósito: sin comillas no son una cadena, son un error de sintaxis. Si se
-- ejecuta el fichero sin sustituirlos, MySQL se detiene en el primer CREATE USER
-- y no crea NADA. Es un fallo ruidoso y seguro.
--
-- Antes iban entre comillas —'CAMBIA_ESTA_APP'— y eso era una contraseña válida.
-- Aplicar el fichero sin editarlo creaba los tres usuarios con una clave que
-- está publicada en este mismo repositorio, sin ningún error.
--
-- -----------------------------------------------------------------------------
-- Por qué hay un ALTER USER tras cada CREATE USER
--
-- `CREATE USER IF NOT EXISTS` NO toca a un usuario que ya existe. Así que si la
-- primera aplicación salió mal y se corrige el fichero, reaplicarlo no cambiaba
-- la contraseña: se saltaba el CREATE en silencio y la clave vieja seguía
-- entrando. Comprobado contra MySQL real.
--
-- El ALTER fija la contraseña siempre, exista o no el usuario. Eso solo es
-- seguro porque los marcadores ya no son ejecutables: el fichero no puede
-- correr hasta tener contraseñas reales, así que el ALTER nunca puede devolver
-- a un usuario de producción a una clave de ejemplo.
--
-- Si se sustituye solo UNO de los dos sitios de un usuario, el otro sigue
-- siendo un error de sintaxis y el script se detiene ahí. Lo que haya quedado
-- aplicado hasta ese punto lleva contraseñas reales: incompleto y ruidoso, pero
-- nunca inseguro.
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

CREATE USER IF NOT EXISTS 'asta_app'@'localhost' IDENTIFIED BY <CAMBIA_ESTA_APP>;
ALTER USER 'asta_app'@'localhost' IDENTIFIED BY <CAMBIA_ESTA_APP>;

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
-- Compatibilidad impresora <-> tóner (#101). Tampoco lleva DELETE.
--
-- Lino pidió DELETE para estas seis. No se concede, y no es por rigidez: estas
-- tablas ya tienen su forma de retirar una fila sin borrarla —`estado`
-- RECHAZADA en las dos de compatibilidad, `is_active` en los alias—, así que
-- DELETE no habilita nada que el producto necesite.
--
-- Y el descarte ES el dato: una compatibilidad marcada RECHAZADA dice qué
-- inferencia falla el importador. Borrarla tira justo lo que hace falta para
-- arreglarlo, y además dejaría que dos personas propongan una y otra vez la
-- misma fila mala sin que conste que ya se rechazó.
-- -----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON asta.printer_brands           TO 'asta_app'@'localhost';
GRANT SELECT, INSERT, UPDATE ON asta.printer_models           TO 'asta_app'@'localhost';
GRANT SELECT, INSERT, UPDATE ON asta.printer_model_aliases    TO 'asta_app'@'localhost';
GRANT SELECT, INSERT, UPDATE ON asta.cartridges               TO 'asta_app'@'localhost';
GRANT SELECT, INSERT, UPDATE ON asta.cartridge_printer_models TO 'asta_app'@'localhost';
GRANT SELECT, INSERT, UPDATE ON asta.product_cartridges       TO 'asta_app'@'localhost';

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

-- Consumo mensual agregado (#47). La aplicación solo LEE: lo escribe el
-- procedimiento de rotación, que corre como asta_migrador en el mantenimiento.
-- Que el middleware no pueda tocar estas cifras importa — es lo que se factura.
GRANT SELECT ON asta.api_usage_monthly TO 'asta_app'@'localhost';

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
-- Se comprobó: con `asta_app` la batería entera da 209 pasando y 0 fallando, y
-- las ÚNICAS operaciones denegadas en todo el recorrido son
--
--   DELETE ... for table `asta`.`app_users`
--   DELETE ... for table `asta`.`api_request_logs`
--
-- que salen de la limpieza de fixtures en los `afterAll`, no de ningún camino de
-- la aplicación. Eso es justamente la prueba de que quitar DELETE es seguro: si
-- algo del producto lo necesitara, habría salido aquí.
--
-- (Eran 206 y un solo DELETE cuando se escribió esto. Subieron al añadir los
-- tests de alertas (#46), que también limpian lo que siembran. Lo que no cambia
-- es lo que importa: ninguna de las dos sale de código de producción.)
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

CREATE USER IF NOT EXISTS 'asta_migrador'@'localhost' IDENTIFIED BY <CAMBIA_ESTA_MIGRADOR>;
ALTER USER 'asta_migrador'@'localhost' IDENTIFIED BY <CAMBIA_ESTA_MIGRADOR>;

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

CREATE USER IF NOT EXISTS 'asta_lectura'@'localhost' IDENTIFIED BY <CAMBIA_ESTA_LECTURA>;
ALTER USER 'asta_lectura'@'localhost' IDENTIFIED BY <CAMBIA_ESTA_LECTURA>;

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
GRANT SELECT ON asta.api_usage_monthly     TO 'asta_lectura'@'localhost';
GRANT SELECT ON asta.printer_brands           TO 'asta_lectura'@'localhost';
GRANT SELECT ON asta.printer_models           TO 'asta_lectura'@'localhost';
GRANT SELECT ON asta.printer_model_aliases    TO 'asta_lectura'@'localhost';
GRANT SELECT ON asta.cartridges               TO 'asta_lectura'@'localhost';
GRANT SELECT ON asta.cartridge_printer_models TO 'asta_lectura'@'localhost';
GRANT SELECT ON asta.product_cartridges       TO 'asta_lectura'@'localhost';

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
