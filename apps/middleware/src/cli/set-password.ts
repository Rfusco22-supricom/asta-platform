/**
 * Issue #54 — establece la contraseña de un usuario.
 *
 *   pnpm --filter @asta/middleware exec tsx src/cli/set-password.ts <email>
 *
 * Existe porque `002_seed.sql` crea el SuperAdmin SIN contraseña, a propósito:
 * poner un hash de ejemplo en un archivo versionado es dejar la llave bajo el
 * felpudo — acaba en producción porque nadie se acordó de cambiarla.
 *
 * DOS COSAS QUE NO HACE, y son deliberadas:
 *
 *   · No acepta la contraseña como argumento. Quedaría en el historial del
 *     shell y, mientras corre, en la lista de procesos: cualquiera con acceso
 *     a la máquina puede verla con `ps`.
 *   · No la imprime nunca, ni al confirmar.
 */
import { createInterface } from 'node:readline';
import { stdin, stdout } from 'node:process';
import { prisma } from '../config/prisma.js';
import { esperarAuditoriaPendiente, installAuditSinks } from '../services/audit.service.js';
import { normalizarEmail } from '../auth/email.js';
import { evaluarFortaleza, hashPassword } from '../auth/password.js';
import { cerrarTodasLasSesiones } from '../services/auth.service.js';

/** Lee sin eco: nada de lo tecleado aparece en pantalla. */
function preguntarOculto(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: stdin, output: stdout, terminal: true });
    const orig = (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput;

    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = function (s) {
      if (s.includes(prompt)) orig.call(this, s);
      // El resto se descarta: ni asteriscos, que revelan la longitud.
    };

    stdout.write(prompt);
    rl.question('', (valor) => {
      rl.close();
      stdout.write('\n');
      resolve(valor);
    });
  });
}

async function main(): Promise<void> {
  // Sin esto, `recordAudit` escribe en el vacio: los sinks viven en
  // `createApp()`, que un CLI no llama. Ver `esperarAuditoriaPendiente`.
  installAuditSinks();
  const emailArg = process.argv[2];
  if (!emailArg) {
    /*
     * El mensaje se adapta a desde dónde se llama.
     *
     * En el contenedor no existe `tsx` ni `src/`: solo el bundle. Decirle a
     * quien está desplegando que ejecute algo que ahí no existe es mandarlo a
     * dar vueltas justo en el momento en que intenta poner la primera
     * contraseña y todavía no puede entrar nadie al panel.
     */
    const empaquetado = process.argv[1]?.includes('dist') ?? false;
    console.error(
      empaquetado
        ? '\n  Uso: node dist/cli/set-password.js <email>\n'
        : '\n  Uso: tsx src/cli/set-password.ts <email>\n',
    );
    process.exit(1);
  }

  if (process.argv[3]) {
    console.error(
      '\n  La contraseña NO se pasa como argumento: quedaría en el historial del\n' +
        '  shell y en la lista de procesos. Se pide por teclado.\n',
    );
    process.exit(1);
  }

  const email = normalizarEmail(emailArg);
  const usuario = await prisma.appUser.findUnique({
    where: { email },
    select: { id: true, email: true, fullName: true, role: true, isActive: true },
  });

  if (!usuario) {
    console.error(`\n  No existe ningún usuario con el correo ${email}.\n`);
    process.exit(1);
  }

  console.log(`\n  Usuario : ${usuario.fullName} <${usuario.email}>`);
  console.log(`  Rol     : ${usuario.role}${usuario.isActive ? '' : '  (CUENTA DESACTIVADA)'}\n`);

  const clave = await preguntarOculto('  Contraseña nueva: ');
  const repetir = await preguntarOculto('  Repítela        : ');

  if (clave !== repetir) {
    console.error('\n  No coinciden. No se ha cambiado nada.\n');
    process.exit(1);
  }

  const fortaleza = evaluarFortaleza(clave, [usuario.email, usuario.fullName]);
  if (!fortaleza.ok) {
    console.error('\n  Contraseña rechazada:');
    for (const m of fortaleza.motivos) console.error(`    · ${m}`);
    console.error('');
    process.exit(1);
  }

  const hash = await hashPassword(clave);

  await prisma.userCredential.upsert({
    where: { userId: usuario.id },
    create: { userId: usuario.id, passwordHash: hash, mustChange: false },
    update: {
      passwordHash: hash,
      passwordChangedAt: new Date(),
      mustChange: false,
      failedAttempts: 0,
      lockedUntil: null,
    },
  });

  // Cambiar la contraseña cierra las sesiones abiertas. Si se cambia porque se
  // sospecha un robo, dejar vivas las del ladrón haría el cambio inútil.
  const cerradas = await cerrarTodasLasSesiones(usuario.id, 'password_changed');

  await prisma.auditLog.create({
    data: {
      actorId: usuario.id,
      actorEmail: usuario.email,
      action: 'user.password_set',
      targetType: 'AppUser',
      targetId: usuario.id,
      metadata: { via: 'cli', sesionesCerradas: cerradas },
    },
  });

  console.log(`\n  Contraseña establecida.`);
  if (cerradas > 0)
    console.log(`  ${cerradas} ${cerradas === 1 ? 'sesión cerrada' : 'sesiones cerradas'}.`);
  console.log('');
  await esperarAuditoriaPendiente();
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('\n ', e instanceof Error ? e.message : e, '\n');
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
