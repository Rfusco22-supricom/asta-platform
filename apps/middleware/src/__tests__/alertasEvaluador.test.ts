import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ejecutarReglas, evaluarTodo, type EstadoSalud } from '../services/alerts.service.js';

/**
 * Issue #46 — que las reglas se EJECUTEN, y que su runbook exista.
 *
 * ── Qué faltaba ──────────────────────────────────────────────────────────────
 *
 * Las doce reglas estaban escritas y probadas con 37 tests, y no las llamaba
 * nadie: fuera de `alerts.test.ts` no aparecían en ninguna parte del código. Una
 * alerta que no se evalúa nunca no protege de nada, y encima da sensación de
 * cobertura — que es peor que no tenerla.
 *
 * `alerts.test.ts` prueba cada regla por separado. Esto prueba las dos cosas que
 * se le escapan por estar un nivel más arriba: que la pasada COMBINA lo que debe,
 * y que el enlace que lleva cada alerta apunta a algo que existe.
 */

const RUNBOOKS = fileURLToPath(new URL('../../../../docs/05-RUNBOOKS.md', import.meta.url));

const SANO: EstadoSalud = {
  alcanzable: true,
  status: 'ok',
  latencia: { muestras: 200, p95: 100 },
};

describe('#46 · la pasada completa', () => {
  it('con todo sano no inventa alertas', async () => {
    const r = await evaluarTodo(SANO);
    // Puede haber alertas reales de la base de desarrollo (sync atrasado, por
    // ejemplo). Lo que se comprueba es que NINGUNA venga del estado de salud.
    expect(r.alertas.map((a) => a.id)).not.toContain('middleware-caido');
    expect(r.alertas.map((a) => a.id)).not.toContain('middleware-degradado');
    expect(r.alertas.map((a) => a.id)).not.toContain('odoo-lento');
  });

  it('el middleware caído sale PRIMERO, por delante de todo lo demás', async () => {
    /*
     * El orden no es estético. Si el middleware está caído, esa es la alerta que
     * importa y las demás son consecuencia suya; enterrarla entre avisos de
     * latencia hace perder los primeros minutos, que son los que cuentan.
     */
    const r = await evaluarTodo({ alcanzable: false, detalle: 'ECONNREFUSED' });
    expect(r.alertas[0]?.id).toBe('middleware-caido');
    expect(r.alertas[0]?.severidad).toBe('critica');
  });

  it('una dependencia caída da middleware-degradado', async () => {
    const r = await evaluarTodo({ alcanzable: true, status: 'degraded', detalle: 'Caídas: mysql.' });
    expect(r.alertas[0]?.id).toBe('middleware-degradado');
  });

  it('sin ventana de latencia no se inventa odoo-lento', async () => {
    // Un middleware recién arrancado no tiene muestras. "No hay datos" no es
    // "todo bien", pero tampoco es una alerta.
    const r = await evaluarTodo({ alcanzable: true, status: 'ok' });
    expect(r.alertas.map((a) => a.id)).not.toContain('odoo-lento');
  });

  it('con latencia alta sí avisa', async () => {
    const r = await evaluarTodo({
      alcanzable: true,
      status: 'ok',
      latencia: { muestras: 200, p95: 999_999 },
    });
    expect(r.alertas.map((a) => a.id)).toContain('odoo-lento');
  });

  it('una regla que revienta NO tumba la pasada: se anota y las demás siguen', async () => {
    /*
     * Es la propiedad que hace que esto sirva de algo. Un comprobador que se cae
     * entero por una tabla que falta deja de avisar de TODO, y sin hacer ruido:
     * la pasada saldría «nada que contar».
     *
     * Se prueba sobre `ejecutarReglas` con una lista propia. Espiar la regla real
     * no vale: `evaluarReglasDeBase` la llama por referencia interna, así que el
     * espía no intercepta nada y el test pasaba sin probar el try/catch.
     */
    const buena = async () => null;
    const mala = async () => {
      throw new Error('tabla ausente');
    };

    const r = await ejecutarReglas([
      ['mala', mala],
      ['buena', buena],
      ['otra-mala', mala],
    ]);

    expect(r.fallos).toHaveLength(2);
    expect(r.fallos[0]).toContain('mala: tabla ausente');
    // Y la buena se evaluó igualmente: no se corta en la primera que falla.
    expect(r.fallos[1]).toContain('otra-mala');
  });
});

describe('#46 · el runbook de cada alerta existe', () => {
  /*
   * El criterio de aceptación del issue dice «con un runbook enlazado en cada
   * una». Enlazar es barato; que el enlace lleve a algo, no.
   *
   * Sin este test, renombrar una sección de `05-RUNBOOKS.md` —o añadir una regla
   * nueva sin escribir la suya— deja un enlace muerto que solo se descubre a las
   * tres de la mañana, que es exactamente cuando no se puede descubrir.
   */
  const texto = readFileSync(RUNBOOKS, 'utf8');
  const anclas = new Set(
    [...texto.matchAll(/^## `([a-z0-9-]+)`/gm)].map((m) => m[1]),
  );

  /** Los ids que el código puede emitir, sacados del propio fuente. */
  const fuente = readFileSync(
    fileURLToPath(new URL('../services/alerts.service.ts', import.meta.url)),
    'utf8',
  );
  const ids = [...new Set([...fuente.matchAll(/return alerta\(\s*\n?\s*'([a-z0-9-]+)'/g)].map((m) => m[1]))];

  it('el fuente declara los doce ids que se esperan', () => {
    // Si esto falla es que cambió la forma de construir las alertas y el barrido
    // de abajo ya no ve nada: sin esta comprobación, el test pasaría en vacío.
    expect(ids.length).toBeGreaterThanOrEqual(12);
  });

  for (const id of ids) {
    it(`\`${id}\` tiene su sección en 05-RUNBOOKS.md`, () => {
      expect(anclas.has(id), `falta "## \`${id}\`" en docs/05-RUNBOOKS.md`).toBe(true);
    });
  }
});
