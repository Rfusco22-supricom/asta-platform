import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Qué build es el que está corriendo.
 *
 * ── Por qué existe ───────────────────────────────────────────────────────────
 *
 * El panel enseñaba «No existe la ruta GET /api/v1/admin/agentes». La ruta
 * estaba en `main` y los tests la cubrían: lo que pasaba es que el contenedor
 * del middleware era de una imagen más vieja que la del panel. La web sabía de
 * la sección y el API todavía no.
 *
 * Averiguarlo costó fechar rutas una a una con `git log -S` hasta acotar el
 * build entre dos días. No había ninguna forma de preguntárselo al servidor:
 * `/health` decía si Odoo y MySQL respondían, pero no QUÉ código respondía.
 *
 * Con esto, la misma pregunta se contesta mirando `/health`.
 *
 * ── Dos datos, y el segundo es el que no se puede olvidar ────────────────────
 *
 * `sha` identifica el commit exacto, pero depende de que el build reciba
 * `VERSION_SHA`. Si alguien despliega sin pasarlo —que es exactamente el tipo
 * de paso que se olvida— sale `null` y volveríamos a adivinar.
 *
 * Por eso `construido` no se configura: sale de la fecha del propio fichero que
 * se está ejecutando. `COPY --from=build` conserva la fecha de la etapa de
 * compilación, así que en la imagen es el momento en que corrió el build. No
 * dice qué commit, pero dice de cuándo es el código, y eso solo ya habría
 * resuelto el caso de arriba en cinco segundos.
 */

export interface Version {
  /** Commit exacto. `null` si el build no recibió `VERSION_SHA`. */
  sha: string | null;
  /** Fecha del fichero en ejecución, en ISO. `null` si no se pudo leer. */
  construido: string | null;
}

function fechaDelFicheroEnEjecucion(): string | null {
  try {
    return statSync(fileURLToPath(import.meta.url)).mtime.toISOString();
  } catch {
    // No merece tumbar `/health`: el health existe para informar, y quedarse
    // sin el dato de la versión es peor que no responder solo si se calla.
    return null;
  }
}

/*
 * `VERSION_SHA` se lee de `process.env` directamente y no pasa por `envSchema`,
 * que es la excepción en este proyecto. Es a propósito: el resto de variables
 * son configuración sin la cual el servidor no debe arrancar, y esta es una
 * etiqueta. Meterla en el esquema ataría el dato de la versión a que el entorno
 * entero valide, y el momento en que más falta hace saber qué build corre es
 * justo cuando algo no cuadra.
 */
export function version(): Version {
  const sha = process.env.VERSION_SHA?.trim();
  return {
    sha: sha ? sha : null,
    construido: fechaDelFicheroEnEjecucion(),
  };
}
