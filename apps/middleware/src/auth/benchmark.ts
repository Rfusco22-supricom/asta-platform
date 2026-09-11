/**
 * Calibra los parámetros de Argon2id contra el hardware donde vaya a correr.
 *
 *   pnpm --filter @asta/middleware exec tsx src/auth/benchmark.ts
 *
 * Correrlo EN EL SERVIDOR, no en tu portátil: un VPS compartido puede ser
 * bastante más lento, y copiar los parámetros de una máquina rápida haría que
 * cada login tardase medio segundo.
 */
import { Algorithm, hash } from '@node-rs/argon2';

const COMBINACIONES: Array<[number, number, number]> = [
  [19456, 2, 1],
  [32768, 2, 1],
  [47104, 3, 1],
  [65536, 3, 1],
  [65536, 4, 1],
  [131072, 3, 1],
];

const OBJETIVO_MIN = 60;
const OBJETIVO_MAX = 250;

async function main(): Promise<void> {
  console.log('\n  Calibración de Argon2id');
  console.log('  Objetivo: entre %d y %d ms por hash.\n', OBJETIVO_MIN, OBJETIVO_MAX);
  console.log('  Por debajo es barato de atacar; por encima, molesto al entrar');
  console.log('  y caro en memoria si hay varios logins a la vez.\n');
  console.log('  memoria      t  p   media    veredicto');
  console.log('  ' + '-'.repeat(52));

  let recomendado: [number, number, number] | null = null;

  for (const [m, t, p] of COMBINACIONES) {
    const muestras: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      await hash(`calibracion-${i}`, {
        algorithm: Algorithm.Argon2id,
        memoryCost: m,
        timeCost: t,
        parallelism: p,
      });
      muestras.push(performance.now() - t0);
    }
    muestras.sort((a, b) => a - b);
    const mediana = Math.round(muestras[Math.floor(muestras.length / 2)]);

    const dentro = mediana >= OBJETIVO_MIN && mediana <= OBJETIVO_MAX;
    if (dentro && !recomendado) recomendado = [m, t, p];

    console.log(
      `  ${String(m).padStart(7)} KiB  ${t}  ${p}  ${String(mediana).padStart(5)} ms   ` +
        (dentro ? 'DENTRO DEL OBJETIVO' : mediana < OBJETIVO_MIN ? 'demasiado barato' : 'lento'),
    );
  }

  console.log('');
  if (recomendado) {
    const [m, t, p] = recomendado;
    console.log('  Para este servidor:\n');
    console.log(`    ARGON2_MEMORY_KIB=${m}`);
    console.log(`    ARGON2_ITERATIONS=${t}`);
    console.log(`    ARGON2_PARALLELISM=${p}`);
    console.log(`\n  Memoria pico con 10 logins simultáneos: ~${Math.round((m * 10) / 1024)} MiB.`);
  } else {
    console.log('  Ninguna combinación cayó en el objetivo. Ajusta a mano.');
  }
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
