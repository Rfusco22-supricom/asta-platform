import { describe, expect, it } from 'vitest';
import {
  CACHE_MAX_ENTRADAS,
  CACHE_PREFIJO,
  CACHE_VIGENCIA_MS,
  CacheLocal,
  claveBusqueda,
  encabezadoDeCodigos,
  haceCuanto,
  normalizarCodigo,
  queEnsenar,
  recomendado,
  titulo,
  type Almacen,
  type ProductoCompatible,
} from '../apps/web/app/aplicacion/dominio';

/**
 * Las reglas de la aplicación ASTA web (`apps/web/app/aplicacion/dominio.ts`).
 * Son las mismas que las de las apps nativas: estos casos repiten los de
 * `ProductoTest.kt` y `ActivacionTest.kt`, para que las tres digan lo mismo.
 */

const impresora = { id: 1, marca: 'HP', nombre: 'LaserJet P1606dn' };
const toner = (codigo: string, extra: Partial<ProductoCompatible['cartuchos'][number]> = {}) => ({ marca: 'HP', codigo, tipo: 'toner', ...extra });
const producto = (id: number, nombre: string, p: Partial<ProductoCompatible> = {}): ProductoCompatible => ({
  id,
  templateId: id,
  nombre,
  tipo: 'compatible',
  stock: 'disponible',
  cartuchos: [toner('CE278A')],
  ...p,
});

describe('el código de la tablet', () => {
  it('acepta 6 o 12 dígitos, con espacios o guiones, y el QR del panel', () => {
    expect(normalizarCodigo('482 913')).toBe('482913');
    expect(normalizarCodigo('482-913')).toBe('482913');
    expect(normalizarCodigo('asta-tablet:482913')).toBe('482913');
    expect(normalizarCodigo('123456789012')).toBe('123456789012');
  });

  it('rechaza lo demás, también otro QR', () => {
    expect(normalizarCodigo('48291')).toBeNull();
    expect(normalizarCodigo('48291a')).toBeNull();
    expect(normalizarCodigo('https://ejemplo.com:482913')).toBeNull();
  });
});

describe('qué se le enseña al cliente', () => {
  it('solo Asta, lo que hay en tienda primero y el cartucho antes que el polvo', () => {
    const r = queEnsenar([
      producto(1, 'TONER HP CE278A ORIGINAL', { tipo: 'original' }),
      producto(2, 'ASTA TONER CE278A', { stock: 'agotado' }),
      producto(3, 'ASTA POLVO CE278A'),
      producto(4, 'ASTA TONER CE278A/CB435A', { stock: 'bajo' }),
    ]);
    expect(r.tipo).toBe('asta');
    if (r.tipo !== 'asta') return;
    expect(r.productos.map((p) => p.id)).toEqual([4, 3, 2]);
    expect(recomendado(r.productos)?.id).toBe(4);
  });

  it('sin Asta manda al mostrador; sin nada verificado, es un paso que falta', () => {
    expect(queEnsenar([producto(1, 'TONER HP CE278A', { tipo: 'original' })]).tipo).toBe('sinAsta');
    expect(queEnsenar([]).tipo).toBe('sinNada');
  });

  it('el polvo y lo agotado no se recomiendan', () => {
    expect(recomendado([producto(1, 'ASTA POLVO CE278A')])).toBeNull();
    expect(recomendado([producto(1, 'ASTA TONER CE278A', { stock: 'agotado' })])).toBeNull();
  });

  it('el título dice qué es: tóner, tinta en botella, cartucho de tinta, polvo', () => {
    expect(titulo(producto(1, 'ASTA TONER CE278A'), impresora)).toBe('Tóner compatible Asta');
    expect(titulo(producto(2, 'ASTA POLVO CE278A'), impresora)).toBe('Polvo de recarga Asta');
    expect(titulo(producto(3, 'ASTA TINTA T544', { cartuchos: [{ marca: 'Epson', codigo: 'T544', tipo: 'tinta', botella: true }] }), impresora)).toBe('Tinta compatible Asta');
    expect(titulo(producto(4, 'ASTA CARTUCHO 664', { cartuchos: [{ marca: 'HP', codigo: '664', tipo: 'tinta' }] }), impresora)).toBe('Cartucho de tinta compatible Asta');
  });

  it('«USA LA TINTA» solo si todo son botellas', () => {
    expect(encabezadoDeCodigos([producto(1, 'ASTA T544', { cartuchos: [{ marca: 'Epson', codigo: 'T544', tipo: 'tinta', botella: true }] })])).toBe('USA LA TINTA');
    expect(encabezadoDeCodigos([producto(1, 'ASTA TONER', { cartuchos: [toner('CE278A'), toner('CB435A')] })])).toBe('USA LOS CARTUCHOS');
  });
});

describe('la caché', () => {
  const almacen = (): Almacen & { mapa: Map<string, string> } => {
    const mapa = new Map<string, string>();
    return { mapa, leer: (k) => mapa.get(k) ?? null, guardar: (k, v) => void mapa.set(k, v), borrar: (k) => void mapa.delete(k), claves: () => [...mapa.keys()] };
  };

  it('guarda y devuelve con su fecha, y caduca a las 12 horas', () => {
    let ahora = 1_000_000;
    const c = new CacheLocal(almacen(), () => ahora);
    c.guardar(claveBusqueda('P1606 dn'), { x: 1 });
    expect(c.leer(claveBusqueda('p1606DN'))).toEqual({ datos: { x: 1 }, guardadoEn: 1_000_000 });
    ahora += CACHE_VIGENCIA_MS + 1;
    expect(c.leer(claveBusqueda('p1606dn'))).toBeNull();
  });

  it('no pasa de 200 entradas: se van las más viejas', () => {
    let ahora = 0;
    const a = almacen();
    const c = new CacheLocal(a, () => ++ahora);
    for (let i = 0; i < CACHE_MAX_ENTRADAS + 5; i++) c.guardar(`k${i}`, i);
    expect(a.claves().filter((k) => k.startsWith(CACHE_PREFIJO))).toHaveLength(CACHE_MAX_ENTRADAS);
    expect(c.leer('k0')).toBeNull();
    expect(c.leer(`k${CACHE_MAX_ENTRADAS + 4}`)?.datos).toBe(CACHE_MAX_ENTRADAS + 4);
  });

  it('dice hace cuánto', () => {
    expect(haceCuanto(0, 20_000)).toBe('hace menos de un minuto');
    expect(haceCuanto(0, 3 * 60_000)).toBe('hace 3 min');
    expect(haceCuanto(0, 2 * 3600_000)).toBe('hace 2 horas');
  });
});
