import { describe, expect, it } from 'vitest';
import {
  agrupar,
  gruposParaCubrir,
  normalizarNombre,
  normalizarRif,
  resumir,
  rifUtilizable,
  type Registro,
} from '../services/duplicados.js';

/**
 * Detección de clientes duplicados (#50).
 *
 * Lo que se prueba aquí decide qué sale en el informe que alguien va a usar para
 * fusionar registros en Odoo — una operación que no se deshace. Los dos errores
 * cuestan caro y en direcciones opuestas:
 *
 *   · Marcar como duplicados dos clientes distintos lleva a fusionar entidades
 *     legales separadas.
 *   · No detectar uno real deja al vendedor viendo media relación comercial sin
 *     saberlo.
 *
 * Por eso cada caso comprueba las dos direcciones.
 */

let siguienteId = 1;

function reg(p: Partial<Registro> = {}): Registro {
  return {
    id: p.id ?? siguienteId++,
    nombre: p.nombre ?? 'CLIENTE EJEMPLO, C.A.',
    rif: p.rif ?? null,
    vendedorId: p.vendedorId ?? null,
    vendedor: p.vendedor ?? null,
    facturas: p.facturas ?? 0,
    monto: p.monto ?? 0,
  };
}

describe('#50 · Normalización del RIF', () => {
  it('el mismo RIF con y sin guiones es el mismo', () => {
    expect(normalizarRif('J-40872674-2')).toBe('J408726742');
    expect(normalizarRif('j408726742')).toBe('J408726742');
    expect(normalizarRif(' J-40872674-2 ')).toBe('J408726742');
  });

  it('un RIF vacío o ausente no es un RIF', () => {
    expect(normalizarRif(null)).toBeNull();
    expect(normalizarRif('')).toBeNull();
    expect(normalizarRif('   ')).toBeNull();
    expect(normalizarRif('---')).toBeNull();
  });
});

describe('#50 · RIF que no sirve para agrupar', () => {
  /*
   * Los campos fiscales se rellenan a mano y acaban llenos de marcadores.
   * Agrupar por esos junta clientes que no tienen nada que ver, y un informe con
   * ruido deja de leerse — que es la forma en que estos informes mueren.
   */
  it.each([
    ['000000000', 'todo ceros'],
    ['111111111', 'todo unos'],
    ['J0', 'demasiado corto'],
    ['ABCDEFGH', 'sin dígitos suficientes'],
    ['', 'vacío'],
  ])('descarta %s (%s)', (rif) => {
    expect(rifUtilizable(normalizarRif(rif))).toBe(false);
  });

  it('acepta un RIF venezolano de verdad', () => {
    expect(rifUtilizable(normalizarRif('J-40872674-2'))).toBe(true);
    expect(rifUtilizable(normalizarRif('V-12345678-9'))).toBe(true);
  });

  it('dos clientes con el RIF a cero NO forman grupo', () => {
    const grupos = agrupar([
      reg({ id: 1, nombre: 'UNO', rif: '000000000' }),
      reg({ id: 2, nombre: 'DOS', rif: '000000000' }),
    ]);

    // Ni por RIF ni por nombre: se llaman distinto.
    expect(grupos).toEqual([]);
  });
});

describe('#50 · Normalización del nombre', () => {
  it('la puntuación y los espacios de más no cuentan', () => {
    expect(normalizarNombre('SUPRICOM CCS 21, C.A.')).toBe(normalizarNombre('supricom ccs 21 ca'));
    expect(normalizarNombre('  PC  SHOP   C.A. ')).toBe('PC SHOP CA');
  });

  it('NO junta C.A. con S.A.', () => {
    /*
     * Deliberado. Son formas societarias distintas: "INVERSIONES PULSAR, C.A." y
     * "INVERSIONES PULSAR, S.A." son dos entidades legales separadas. Quitarlas
     * para "normalizar mejor" inventaría un duplicado, y fusionar dos empresas
     * distintas es un error que no se deshace.
     */
    expect(normalizarNombre('INVERSIONES PULSAR, C.A.')).not.toBe(
      normalizarNombre('INVERSIONES PULSAR, S.A.'),
    );
  });
});

describe('#50 · Clasificación de los grupos', () => {
  it('sin facturas en ninguno: no afecta al panel', () => {
    const g = agrupar([
      reg({ id: 1, rif: 'J408726742' }),
      reg({ id: 2, rif: 'J-40872674-2' }),
    ]);

    expect(g).toHaveLength(1);
    expect(g[0].clase).toBe('sin-facturas');
  });

  it('facturas en UN registro: duplicado inocuo', () => {
    const g = agrupar([
      reg({ id: 1, rif: 'J408726742', facturas: 10, monto: 5000 }),
      reg({ id: 2, rif: 'J408726742' }),
    ]);

    // El panel muestra la cifra correcta: toda la facturación está junta.
    expect(g[0].clase).toBe('inocuo');
    expect(g[0].montoFuera).toBe(0);
  });

  it('facturas REPARTIDAS: aquí se rompe el panel', () => {
    const g = agrupar([
      reg({ id: 1, rif: 'J408726742', facturas: 258, monto: 1_500_000 }),
      reg({ id: 2, rif: 'J408726742', facturas: 18, monto: 200_000 }),
      reg({ id: 3, rif: 'J408726742', facturas: 17, monto: 74_260 }),
    ]);

    expect(g[0].clase).toBe('partido');
    expect(g[0].conFacturas).toBe(3);
    expect(g[0].montoTotal).toBe(1_774_260);
    // Lo que hay que mover al fusionar.
    expect(g[0].montoFuera).toBe(274_260);
    // El destino natural: el que más facturación tiene.
    expect(g[0].principal).toBe(1);
  });

  it('con empate de monto, el principal es el id más bajo', () => {
    // El más antiguo suele arrastrar más referencias, así que mover lo demás
    // hacia él es menos trabajo y menos riesgo.
    const g = agrupar([
      reg({ id: 77, rif: 'J408726742', facturas: 1, monto: 100 }),
      reg({ id: 12, rif: 'J408726742', facturas: 1, monto: 100 }),
    ]);

    expect(g[0].principal).toBe(12);
  });
});

describe('#50 · Un registro cae en un solo grupo', () => {
  it('el RIF manda sobre el nombre', () => {
    /*
     * Si un registro pudiera salir en un grupo por RIF y en otro por nombre, el
     * mismo cliente aparecería dos veces y quien leyera el informe tendría que
     * deduplicar el informe de duplicados.
     */
    const grupos = agrupar([
      reg({ id: 1, nombre: 'ACME CA', rif: 'J408726742', monto: 100, facturas: 1 }),
      reg({ id: 2, nombre: 'ACME CA', rif: 'J408726742', monto: 50, facturas: 1 }),
      reg({ id: 3, nombre: 'ACME CA', rif: 'V123456789' }),
    ]);

    expect(grupos).toHaveLength(1);
    expect(grupos[0].motivo).toBe('rif');
    // El tercero comparte nombre pero tiene OTRO RIF: es otra entidad legal y no
    // se arrastra al grupo.
    expect(grupos[0].registros.map((r) => r.id).sort()).toEqual([1, 2]);
  });

  it('sin RIF utilizable, se agrupa por nombre y se marca como tal', () => {
    const grupos = agrupar([
      reg({ id: 1, nombre: 'SIN RIF, C.A.', rif: null, monto: 10, facturas: 1 }),
      reg({ id: 2, nombre: 'sin rif ca', rif: '', monto: 20, facturas: 1 }),
    ]);

    expect(grupos).toHaveLength(1);
    // El motivo importa: por RIF se fusiona con confianza, por nombre hay que
    // mirarlo antes.
    expect(grupos[0].motivo).toBe('nombre');
    expect(grupos[0].clase).toBe('partido');
  });

  it('un registro solo no forma grupo', () => {
    expect(agrupar([reg({ rif: 'J408726742' })])).toEqual([]);
  });
});

describe('#50 · Vendedores distintos dentro de un grupo', () => {
  it('se listan, porque fusionar mueve facturación entre carteras', () => {
    /*
     * La consecuencia que nadie ve venir. Si los registros de un mismo cliente
     * están repartidos entre dos vendedores, fusionarlos mueve facturación —y
     * comisión— de una cartera a otra. Es una conversación que hay que tener
     * ANTES, no descubrirla después.
     */
    const g = agrupar([
      reg({ id: 1, rif: 'J408726742', facturas: 5, monto: 900, vendedor: 'ANDREA MARQUEZ' }),
      reg({ id: 2, rif: 'J408726742', facturas: 3, monto: 400, vendedor: 'ONEYDA MATAMOROS' }),
    ]);

    expect(g[0].vendedores.sort()).toEqual(['ANDREA MARQUEZ', 'ONEYDA MATAMOROS']);
  });

  it('un cliente sin vendedor no cuenta como vendedor distinto', () => {
    const g = agrupar([
      reg({ id: 1, rif: 'J408726742', facturas: 5, monto: 900, vendedor: 'ANDREA MARQUEZ' }),
      reg({ id: 2, rif: 'J408726742', facturas: 3, monto: 400, vendedor: null }),
    ]);

    // Si contara, medio informe saldría marcado como conflicto de carteras y la
    // señal dejaría de significar nada.
    expect(g[0].vendedores).toEqual(['ANDREA MARQUEZ']);
  });
});

describe('#50 · Orden y resumen', () => {
  const datos = (): Registro[] => [
    reg({ id: 1, rif: 'J111111112', facturas: 2, monto: 1000 }),
    reg({ id: 2, rif: 'J111111112', facturas: 2, monto: 1000 }),
    reg({ id: 3, rif: 'J222222223', facturas: 2, monto: 100 }),
    reg({ id: 4, rif: 'J222222223', facturas: 2, monto: 100 }),
    reg({ id: 5, rif: 'J333333334', facturas: 4, monto: 50 }),
    reg({ id: 6, rif: 'J333333334' }),
    reg({ id: 7, rif: 'J444444445' }),
    reg({ id: 8, rif: 'J444444445' }),
  ];

  it('ordena por dinero en juego, no por número de registros', () => {
    const g = agrupar(datos());
    expect(g[0].montoTotal).toBe(2000);
    expect(g[1].montoTotal).toBe(200);
  });

  it('el resumen separa el ruido de lo que importa', () => {
    const registros = datos();
    const r = resumir(agrupar(registros), registros);

    expect(r.grupos).toBe(4);
    expect(r.partidos).toBe(2);
    expect(r.inocuos).toBe(1);
    expect(r.sinFacturas).toBe(1);
    expect(r.montoPartido).toBe(2200);
  });

  it('dice cuántos grupos cubren un porcentaje del dinero', () => {
    /*
     * El número que convierte el issue en algo accionable: no "hay 85 grupos
     * rotos" sino "con los N primeros se arregla el 90%".
     */
    const g = agrupar(datos());

    // El primero solo ya es 2000 de 2200 = 90,9%.
    expect(gruposParaCubrir(g, 90)).toBe(1);
    expect(gruposParaCubrir(g, 100)).toBe(2);
  });

  it('sin grupos partidos no hace falta fusionar nada', () => {
    expect(gruposParaCubrir([], 90)).toBe(0);
  });
});
