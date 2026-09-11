import { describe, it, expect } from 'vitest';
import { revisarEntorno, describirProblemas } from '../config/validarEntorno.js';

/**
 * Comprobación del entorno (issue #9).
 *
 * Lo que se prueba aquí no es zod —eso ya está probado— sino la promesa que le
 * hacemos a quien despliega: que si falta algo, se entera **al arrancar** y con
 * el nombre de la variable delante.
 *
 * Por eso todo pasa por `revisarEntorno(fuente)` con un entorno inyectado.
 * Probarlo contra el `process.env` real haría que el test pasara o fallara según
 * la máquina, que es justo lo que no queremos de un test.
 */

/** Un entorno completo y válido, del que las pruebas van quitando piezas. */
function entornoCompleto(): Record<string, string> {
  return {
    NODE_ENV: 'test',
    DATABASE_URL: 'mysql://root@localhost:3306/asta_test',
    API_KEY_PEPPER: 'x'.repeat(32),
    ODOO_URL: 'https://ejemplo.odoo.com',
    ODOO_DB: 'ejemplo-db',
    ODOO_USERNAME: 'servicio@ejemplo.com',
    ODOO_PASSWORD: 'clave-de-servicio',
    JWT_SECRET: 'y'.repeat(32),
  };
}

describe('#9 · Comprobación del entorno', () => {
  it('un entorno completo no da problemas', () => {
    expect(revisarEntorno(entornoCompleto())).toEqual([]);
  });

  it('detecta una variable que falta y la nombra', () => {
    const entorno = entornoCompleto();
    delete entorno.DATABASE_URL;

    const problemas = revisarEntorno(entorno);

    expect(problemas.length).toBeGreaterThan(0);
    expect(problemas.map((p) => p.variable)).toContain('DATABASE_URL');
  });

  it('detecta una variable presente pero inválida, no solo las ausentes', () => {
    const entorno = entornoCompleto();
    // Existe, pero es demasiado corto para servir de pepper. Un `undefined` no
    // es el único modo de fallo: un valor puesto a medias es peor, porque
    // parece configurado.
    entorno.API_KEY_PEPPER = 'corto';

    const problemas = revisarEntorno(entorno);

    expect(problemas.map((p) => p.variable)).toContain('API_KEY_PEPPER');
  });

  it('acumula TODOS los fallos de una vez, no solo el primero', () => {
    const entorno = entornoCompleto();
    delete entorno.DATABASE_URL;
    delete entorno.ODOO_DB;
    delete entorno.JWT_SECRET;

    const faltantes = revisarEntorno(entorno).map((p) => p.variable);

    // Esta es la razón de ser del comprobador. Si parara en el primero, quien
    // despliega arregla una variable, reinicia, descubre la siguiente, reinicia.
    // Con tres variables mal son tres ciclos en vez de uno.
    expect(faltantes).toContain('DATABASE_URL');
    expect(faltantes).toContain('ODOO_DB');
    expect(faltantes).toContain('JWT_SECRET');
  });

  it('cubre los tres bloques de configuración, no solo uno', () => {
    const entorno = entornoCompleto();
    delete entorno.API_KEY_PEPPER;
    delete entorno.ODOO_URL;
    delete entorno.JWT_SECRET;

    const grupos = new Set(revisarEntorno(entorno).map((p) => p.grupo));

    // Importa porque `odooEnv` valida al importarse: si el comprobador llegara
    // a importarlo en vez de leer su schema, la lista se cortaría en el primer
    // grupo que fallara y los otros dos no se verían nunca.
    expect(grupos).toEqual(new Set(['servidor', 'odoo', 'autenticación']));
  });

  it('el mensaje dice qué variable falta y no lleva traza de pila', () => {
    const entorno = entornoCompleto();
    delete entorno.DATABASE_URL;

    const texto = describirProblemas(revisarEntorno(entorno));

    expect(texto).toContain('DATABASE_URL');
    // Lo que el issue pide explícitamente: un mensaje, no un stack trace. Una
    // traza aquí no dice nada útil —el fallo está en el `.env`, no en el
    // código— y entierra la única línea que importa.
    expect(texto).not.toMatch(/\bat\s+\w+.*:\d+:\d+/);
    expect(texto).not.toContain('node_modules');
    expect(texto).toContain('.env.example');
  });

  it('los valores con defaults no se exigen', () => {
    const entorno = entornoCompleto();
    // Ninguno de estos está en el .env mínimo de un despliegue y todos tienen
    // default. Exigirlos convertiría el comprobador en un estorbo.
    delete entorno.NODE_ENV;

    expect(revisarEntorno(entorno)).toEqual([]);
  });
});
