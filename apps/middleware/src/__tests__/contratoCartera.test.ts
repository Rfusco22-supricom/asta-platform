import { describe, expect, it } from 'vitest';
import { portfolioRowSchema } from '@asta/shared-types';

/**
 * Un dato feo en Odoo no puede apagar la pantalla.
 *
 * ── El fallo que fija este test ──────────────────────────────────────────────
 *
 * `portfolioRowSchema.email` era `z.email()`. El cliente ASG-Z SECURITY LANTECH
 * tiene literalmente `"A"` en el campo de correo de Odoo, y con eso el vendedor
 * 428 no veía NINGUNO de sus 161 clientes: el panel valida la respuesta entera
 * contra el contrato, así que una fila mala tira las 161.
 *
 * Y no era un caso aislado esperando a aparecer: la instancia tiene ocho correos
 * así —`"AL"`, `"00000000"`, `janscar10.gmail.com`— cada uno capaz de dejar sin
 * cartera a quien lo tenga asignado.
 *
 * La regla que queda escrita: un campo que se PINTA se tipa por lo que Odoo
 * puede contener, no por lo que nos gustaría que contuviera. Validar en la
 * frontera de lectura convierte un problema de calidad de dato en una caída.
 */

const fila = (email: unknown) => ({
  id: 131881,
  nombre: 'ASG-Z SECURITY LANTECH, C.A',
  email,
  telefono: null,
  tier: 'Lista de Precios (USD)',
  tierDerivado: 'BRONCE',
  totalFacturado: 1200,
  porCobrar: 0,
  numeroFacturas: 3,
  esCliente: true,
});

describe('la cartera aguanta los correos rotos de Odoo', () => {
  // Los ocho de la instancia, tal cual están escritos allí.
  const reales = ['A', 'AL', '00000000', 'janscar10.gmail.com', 'electrosystemss@gmailcom'];

  for (const email of reales) {
    it(`acepta ${JSON.stringify(email)}`, () => {
      expect(portfolioRowSchema.safeParse(fila(email)).success).toBe(true);
    });
  }

  it('acepta null: hay 512 clientes sin correo en Odoo', () => {
    expect(portfolioRowSchema.safeParse(fila(null)).success).toBe(true);
  });

  it('un correo bien escrito sigue valiendo, claro', () => {
    expect(portfolioRowSchema.safeParse(fila('alguien@empresa.com')).success).toBe(true);
  });

  it('pero no se cuela cualquier cosa: un número no es un correo', () => {
    // Relajar no es quitar el tipo. Si el middleware empieza a mandar otra cosa
    // que no sea texto, eso sí es un fallo de programación y debe verse.
    expect(portfolioRowSchema.safeParse(fila(42)).success).toBe(false);
  });
});
