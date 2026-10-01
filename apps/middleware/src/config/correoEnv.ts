import { z } from 'zod';

/**
 * Configuración del correo saliente (#53). Perezosa, como `authEnv`.
 *
 * Sin `SMTP_HOST` no se envía nada y no es un error: el panel funciona igual, y
 * las invitaciones se entregan copiando el enlace (#16). En cuanto se rellenan
 * las variables, salen por correo.
 *
 * El dominio `supricom.com.ve` está en Google Workspace (MX en
 * `aspmx.l.google.com`, SPF con `_spf.google.com`). Lo natural es una cuenta
 * `no-reply@supricom.com.ve` con contraseña de aplicación:
 *
 *   SMTP_HOST=smtp.gmail.com  SMTP_PORT=587  SMTP_USER=no-reply@…  SMTP_PASSWORD=<contraseña de aplicación>
 *
 * Así el correo sale firmado por Google y no cae en spam.
 */

/** `SMTP_HOST=` en el `.env` llega como cadena vacía: eso es «sin configurar», no un host. */
const opcional = z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.string().trim().optional());

export const correoEnvSchema = z.object({
  SMTP_HOST: opcional,
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: opcional,
  SMTP_PASSWORD: opcional,
  SMTP_FROM: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.email().default('no-reply@supricom.com.ve')),
});

export type CorreoEnv = z.infer<typeof correoEnvSchema>;

let cache: CorreoEnv | null = null;

export function correoEnv(): CorreoEnv {
  if (cache) return cache;
  const parsed = correoEnvSchema.safeParse(process.env);
  if (!parsed.success) throw new Error('Configuración de correo inválida:\n' + z.prettifyError(parsed.error));
  cache = parsed.data;
  return cache;
}

/** Solo para tests: fuerza releer el entorno. */
export function resetCorreoEnvCache(): void {
  cache = null;
}
