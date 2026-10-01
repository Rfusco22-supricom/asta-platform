// Solo para poner el .env en process.env. No valida nada ni lanza (issue #9).
import '../config/dotenv.js';
import { prisma } from '../config/prisma.js';
import { cerrarSesionesVencidas, contarSesiones } from '../services/kiosco/sesiones.service.js';

/**
 * `pnpm kiosco:cerrar-sesiones` — cierra las sesiones de kiosco vencidas (#41).
 *
 * Pensado para un cron cada pocos minutos, como `pnpm alertas`.
 *
 * La app ya cierra la sesión a los cuatro minutos, pero lo hace en la tablet: si
 * se apaga, se queda sin red o sin batería con una sesión abierta, esa fila no
 * se cierra sola. Aquí manda `expires_at`, no el dispositivo.
 *
 * Solo lectura y UPDATE: no borra nada, y las sesiones que cerró la tablet se
 * quedan con el motivo que traían.
 */
const antes = await contarSesiones();
const cerradas = await cerrarSesionesVencidas();
const despues = await contarSesiones();

console.log(
  [
    `sesiones abiertas antes: ${antes.abiertas} (vencidas: ${antes.vencidas})`,
    `cerradas ahora:          ${cerradas}`,
    `siguen abiertas:         ${despues.abiertas} (vencidas: ${despues.vencidas})`,
  ].join('\n'),
);

await prisma.$disconnect();
// Si después de cerrar sigue habiendo vencidas, algo va mal: que el cron lo note.
process.exit(despues.vencidas > 0 ? 1 : 0);
