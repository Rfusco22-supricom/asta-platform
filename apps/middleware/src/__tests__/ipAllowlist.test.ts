import { describe, expect, it } from 'vitest';
import { ipCoincide, normalizarIp, origenPermitido } from '../services/ipAllowlist.js';

/**
 * Issue #27 — comparacion de origen contra la lista blanca de una API key.
 *
 * Es un control de seguridad y no toca la base de datos, asi que se prueba
 * aparte y a fondo. El fallo que motivo este modulo tenia dos mitades:
 *
 *   · fallaba ABIERTA: sin IP conocida, la lista se ignoraba entera
 *   · fallaba CERRADA: los rangos CIDR se comparaban como cadenas, asi que
 *     "200.44.1.0/24" no coincidia con ninguna IP del rango
 */

describe('#27 · normalizarIp', () => {
  it('desenvuelve una IPv4 mapeada en IPv6', () => {
    expect(normalizarIp('::ffff:200.44.1.10')).toBe('200.44.1.10');
  });

  it('quita los corchetes de una IPv6', () => {
    expect(normalizarIp('[2001:db8::1]')).toBe('2001:db8::1');
  });

  it('quita el identificador de zona', () => {
    expect(normalizarIp('fe80::1%en0')).toBe('fe80::1');
  });

  it('normaliza mayusculas y espacios', () => {
    expect(normalizarIp('  2001:DB8::1  ')).toBe('2001:db8::1');
  });

  it('deja intacta una IPv4 normal', () => {
    expect(normalizarIp('200.44.1.10')).toBe('200.44.1.10');
  });
});

describe('#27 · ipCoincide · direcciones exactas', () => {
  it('coincide consigo misma', () => {
    expect(ipCoincide('200.44.1.10', '200.44.1.10')).toBe(true);
  });

  it('no coincide con otra', () => {
    expect(ipCoincide('200.44.1.10', '200.44.1.11')).toBe(false);
  });

  it('una IPv6 exacta si funciona', () => {
    expect(ipCoincide('2001:db8::1', '2001:DB8::1')).toBe(true);
  });

  it('casa una IPv4 exacta contra su forma mapeada', () => {
    expect(ipCoincide('200.44.1.10', '::ffff:200.44.1.10')).toBe(true);
  });
});

describe('#27 · ipCoincide · rangos CIDR', () => {
  it('acepta una IP dentro de un /24', () => {
    expect(ipCoincide('200.44.1.0/24', '200.44.1.77')).toBe(true);
  });

  it('rechaza una IP fuera del /24', () => {
    expect(ipCoincide('200.44.1.0/24', '200.44.2.77')).toBe(false);
  });

  it('un /32 se comporta como direccion exacta', () => {
    expect(ipCoincide('200.44.1.10/32', '200.44.1.10')).toBe(true);
    expect(ipCoincide('200.44.1.10/32', '200.44.1.11')).toBe(false);
  });

  it('un /0 acepta cualquier IPv4', () => {
    // No es algo que convenga escribir en una lista blanca, pero si alguien lo
    // pone debe significar lo que significa, no fallar raro.
    expect(ipCoincide('0.0.0.0/0', '8.8.8.8')).toBe(true);
  });

  it('respeta un prefijo que no cae en frontera de octeto', () => {
    // /20 -> los primeros 20 bits. 10.1.0.0/20 cubre 10.1.0.0 - 10.1.15.255
    expect(ipCoincide('10.1.0.0/20', '10.1.15.255')).toBe(true);
    expect(ipCoincide('10.1.0.0/20', '10.1.16.0')).toBe(false);
  });

  it('funciona con octetos altos, que es donde fallaria el signo', () => {
    // 200.x.x.x pone a 1 el bit mas alto: sin `>>> 0` el entero sale negativo
    // y la comparacion de mascara da resultados equivocados.
    expect(ipCoincide('200.44.0.0/16', '200.44.255.254')).toBe(true);
    expect(ipCoincide('255.255.255.0/24', '255.255.255.9')).toBe(true);
  });

  it('casa la forma mapeada contra un rango IPv4', () => {
    expect(ipCoincide('200.44.1.0/24', '::ffff:200.44.1.77')).toBe(true);
  });
});

describe('#27 · ipCoincide · entradas invalidas', () => {
  it('un prefijo fuera de rango no coincide', () => {
    expect(ipCoincide('200.44.1.0/33', '200.44.1.1')).toBe(false);
    expect(ipCoincide('200.44.1.0/-1', '200.44.1.1')).toBe(false);
  });

  it('un octeto fuera de rango no coincide', () => {
    expect(ipCoincide('300.44.1.0/24', '300.44.1.1')).toBe(false);
  });

  it('un CIDR de IPv6 no coincide: no esta soportado', () => {
    // Decision consciente: escribir a mano un parser de IPv6 para un control de
    // seguridad es mas peligroso que no soportarlo. No coincidir es el lado
    // seguro del error.
    expect(ipCoincide('2001:db8::/32', '2001:db8::1')).toBe(false);
  });

  it('una cadena vacia no coincide con nada', () => {
    expect(ipCoincide('', '200.44.1.1')).toBe(false);
    expect(ipCoincide('200.44.1.1', '')).toBe(false);
  });
});

describe('#27 · origenPermitido', () => {
  it('sin lista blanca, cualquier origen vale', () => {
    expect(origenPermitido([], '8.8.8.8')).toBe(true);
    expect(origenPermitido([], undefined)).toBe(true);
  });

  it('con lista blanca y IP desconocida, DENIEGA', () => {
    // El corazon del fallo original: fallar cerrada.
    expect(origenPermitido(['200.44.1.10'], undefined)).toBe(false);
    expect(origenPermitido(['200.44.1.10'], '')).toBe(false);
  });

  it('basta con que coincida una entrada de la lista', () => {
    const lista = ['10.0.0.1', '200.44.1.0/24', '2001:db8::1'];
    expect(origenPermitido(lista, '200.44.1.77')).toBe(true);
    expect(origenPermitido(lista, '10.0.0.1')).toBe(true);
    expect(origenPermitido(lista, '2001:db8::1')).toBe(true);
  });

  it('si no coincide ninguna, deniega', () => {
    expect(origenPermitido(['10.0.0.1', '200.44.1.0/24'], '8.8.8.8')).toBe(false);
  });
});
