import { describe, expect, it } from 'vitest';
import { beneficiosDe, beneficiosNuevos } from '@asta/shared-types';

/**
 * Los beneficios por nivel del programa ASTA (`beneficiosAsta.ts`): cada nivel
 * conserva los de abajo, el de arriba sustituye al de abajo con la misma clave,
 * y Diamante, bloqueado, no da nada nuevo.
 */

const titulos = (l: readonly { titulo: string }[]) => l.map((b) => b.titulo);

describe('beneficios por nivel', () => {
  it('Cliente general no tiene; Bronce, los suyos', () => {
    expect(beneficiosDe('GENERAL')).toEqual([]);
    expect(titulos(beneficiosDe('BRONCE'))).toEqual(['Crédito a 7 días', 'Kit de bienvenida', 'Aplicación ASTA y panel']);
  });

  it('cada nivel conserva los de abajo, y el crédito se sustituye, no se suma', () => {
    const plata = titulos(beneficiosDe('PLATA'));
    expect(plata).toEqual(['Crédito a 15 días', 'Kit de bienvenida', 'Aplicación ASTA y panel', 'Cliente destacado en la web', 'Promociones flash']);
    const oro = titulos(beneficiosDe('ORO'));
    expect(oro.filter((t) => t.startsWith('Crédito'))).toEqual(['Crédito a 30 días']);
    expect(oro).toEqual(expect.arrayContaining(['Kit de bienvenida', 'Promociones flash', 'Envío gratis', 'Fondo del 2 %']));
  });

  it('Diamante, bloqueado: nada nuevo, y los mismos que Oro', () => {
    expect(beneficiosNuevos('DIAMANTE')).toEqual([]);
    expect(beneficiosDe('DIAMANTE')).toEqual(beneficiosDe('ORO'));
  });
});
