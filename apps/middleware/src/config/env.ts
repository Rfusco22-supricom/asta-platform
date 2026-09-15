import { z } from 'zod';

/**
 * Configuración general del servidor.
 *
 * Está dividida en tres archivos a propósito —`odooEnv`, `authEnv` y este— y no
 * en un único bloque que lo valide todo al arrancar. La razón es práctica: el
 * módulo de Odoo no necesita saber nada de la base de datos, y atarlos obligaba
 * a tener medio sistema montado para poder ejecutar un script de diagnóstico.
 * En Fase 0 eso impidió correr el `odoo-probe`.
 *
 * Cada módulo exige solo lo que usa.
 */

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  LOG_LEVEL: z.string().default('info'),

  /**
   * MySQL 8.0.13+ o MariaDB 10.4+.
   *
   * Ojo con los caracteres especiales de la contraseña: en un DSN la `@` separa
   * las credenciales del host, así que "Clave2015@" debe ir como "Clave2015%40".
   * Sin codificar, el error que devuelve Prisma no apunta a la contraseña.
   */
  DATABASE_URL: z.string().min(1),

  /**
   * Pepper del HMAC de las API keys. Vive SOLO aquí, nunca en la base: si se
   * filtra la tabla `api_keys`, los hashes sin el pepper no permiten verificar
   * ni un token. De él se deriva también la clave de los enlaces de PDF (#32).
   *
   * Rotarlo NO invalida las keys si se hace con `API_KEY_PEPPER_ANTERIOR`: ver
   * docs/08-ROTACION-PEPPER.md (#45).
   */
  API_KEY_PEPPER: z.string().min(32),

  /**
   * El pepper que se está retirando, SOLO durante una rotación (#45).
   *
   * Mientras está puesto, una key cuyo hash se calculó con el pepper anterior se
   * sigue aceptando, y en ese mismo uso se vuelve a calcular con el actual. Las
   * keys que se usan en la ventana migran solas; al quitarla, las que no se
   * usaron dejan de funcionar.
   *
   * Los enlaces de PDF NO lo aceptan: se firman y se verifican solo con el
   * actual, así que rotar corta los que haya en vuelo. Es a propósito: si se
   * rota porque el pepper se filtró, lo que hay que cerrar de inmediato es la
   * posibilidad de firmar enlaces.
   */
  API_KEY_PEPPER_ANTERIOR: z.preprocess(
    // Vacía cuenta como no puesta: `.env.example` la trae así, y un `.env`
    // copiado de él no puede impedir que el servidor arranque.
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().min(32).optional(),
  ),

  /**
   * Origen del panel para CORS. La API pública se consume sin navegador.
   *
   * Se le quita la barra final. La cabecera `Origin` que manda un navegador
   * NUNCA la lleva, así que `https://panel.example/` no casaría jamás con
   * `https://panel.example` y el panel entero daría error de CORS.
   *
   * Es un fallo fácil de cometer —los paneles de despliegue muestran las URL
   * con barra y se copian tal cual— y dificilísimo de diagnosticar: el
   * middleware responde 200, es el navegador quien descarta la respuesta.
   */
  WEB_APP_ORIGIN: z
    .string()
    .url()
    .default('http://localhost:3000')
    .transform((u) => u.replace(/\/+$/, '')),

  /**
   * Quién puede hablar en nombre del cliente final (issue #52).
   *
   * El navegador NUNCA llama al middleware: todo pasa por el servidor de Next.
   * Eso es bueno para el token, pero tiene un efecto colateral — lo que el
   * middleware ve como IP y user-agent es el servidor de Next, no la persona.
   * La pantalla de sesiones activas quedaba inservible: todas las filas decían
   * "Dispositivo desconocido" desde la misma IP.
   *
   * Con esto, a los pares de confianza se les cree el `X-Forwarded-For` y la
   * cabecera con el user-agent real. A los demás, no: si se creyera a cualquiera,
   * quien llamara al middleware directamente podría falsificar la IP que queda
   * registrada, y una intrusión parecería venir de la oficina.
   *
   * Valores de Express: 'loopback', 'linklocal', 'uniquelocal', una lista de
   * IPs/CIDR separada por comas, o un número de saltos.
   */
  TRUSTED_PROXIES: z.string().default('loopback'),
}).superRefine((e, ctx) => {
  // Poner el mismo valor en las dos es el error típico al copiar de un sitio a
  // otro durante la rotación: parecería que se rotó y no se rotó nada.
  if (e.API_KEY_PEPPER_ANTERIOR !== undefined && e.API_KEY_PEPPER_ANTERIOR === e.API_KEY_PEPPER) {
    ctx.addIssue({
      code: 'custom',
      path: ['API_KEY_PEPPER_ANTERIOR'],
      message: 'es igual a API_KEY_PEPPER: la rotación no está cambiando nada',
    });
  }
});

export type Env = z.infer<typeof envSchema>;

let cache: Env | null = null;

/** Perezosa, igual que `authEnv`: leer al importar congela el valor demasiado pronto. */
export function env(): Env {
  if (cache) return cache;

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error('Configuración de entorno inválida:\n' + z.prettifyError(parsed.error));
  }
  cache = parsed.data;
  return cache;
}

export function resetEnvCache(): void {
  cache = null;
}
