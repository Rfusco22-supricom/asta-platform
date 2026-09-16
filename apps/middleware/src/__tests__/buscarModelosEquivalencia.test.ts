import { describe, expect, it } from 'vitest';
import { buscarModelos, distanciaEdicion, type ModeloBuscable } from '../services/recomendador/buscarModelos.js';
import * as referencia from './soportes/buscarModelosReferencia.js';

/**
 * La búsqueda optimizada da EXACTAMENTE lo mismo que la de #38.
 *
 * La optimización (ver "Coste" en `buscarModelos.ts`) no debe cambiar ni una
 * coincidencia, ni una sugerencia, ni una puntuación, ni el orden: los tests de
 * #38 fijan el comportamiento en 21 modelos, y aquí se contrasta contra la
 * versión anterior, copiada tal cual en `soportes/`, sobre un catálogo de
 * cientos de vecinos y un millar de consultas: nombres, alias, typos (borrar,
 * cambiar, transponer), con y sin marca, fragmentos y basura.
 *
 * Aleatorio con semilla fija: si un día falla, falla siempre igual.
 */

function generador(semilla: number) {
  let s = semilla >>> 0;
  return () => {
    // mulberry32
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const azar = generador(20260916);
const elegir = <T,>(xs: T[]): T => xs[Math.floor(azar() * xs.length)];

const FAMILIAS: Array<[string, string]> = [
  ['HP', 'LaserJet Pro M'],
  ['HP', 'LaserJet Pro MFP M'],
  ['HP', 'DeskJet Ink Advantage '],
  ['Brother', 'HL-L'],
  ['Brother', 'DCP-L'],
  ['Brother', 'MFC-L'],
  ['Epson', 'EcoTank L'],
  ['Epson', 'WorkForce WF-C'],
  ['Canon', 'PIXMA G'],
  ['Canon', 'imageCLASS MF'],
  ['Samsung', 'Xpress M'],
];
const SUFIJOS = ['', 'dn', 'dw', 'n', 'fdw', 'cdw', 'w'];

function catalogo(n: number): ModeloBuscable[] {
  const vistos = new Set<string>();
  const modelos: ModeloBuscable[] = [];
  while (modelos.length < n) {
    const [marca, familia] = elegir(FAMILIAS);
    // Números cercanos a propósito: 2350, 2370, 2355… es donde una búsqueda se equivoca.
    const nombre = `${familia}${2300 + Math.floor(azar() * 120)}${elegir(SUFIJOS)}`;
    if (vistos.has(nombre)) continue;
    vistos.add(nombre);
    const aliases = azar() < 0.3 ? [nombre.replace(/[^0-9a-z]/gi, '').slice(-6)] : [];
    modelos.push({ id: modelos.length + 1, marca, nombre, aliases });
  }
  return modelos;
}

function typo(texto: string): string {
  if (texto.length < 2) return texto;
  const i = Math.floor(azar() * (texto.length - 1));
  switch (Math.floor(azar() * 4)) {
    case 0:
      return texto.slice(0, i) + texto.slice(i + 1);
    case 1:
      return texto.slice(0, i) + elegir([...'0123456789abcdlmnw']) + texto.slice(i + 1);
    case 2:
      return texto.slice(0, i) + texto[i + 1] + texto[i] + texto.slice(i + 2);
    default:
      return texto.slice(0, i) + elegir([...'0123456789-  ']) + texto.slice(i);
  }
}

function consultas(modelos: ModeloBuscable[], n: number): string[] {
  const qs: string[] = ['', 'x', 'hp', 'brother', 'BROTHER HL', 'ñ', '----', 'l', '2350', 'm4', 'zzzzzzzz', 'a'.repeat(80)];
  while (qs.length < n) {
    const m = elegir(modelos);
    const base = elegir([m.nombre, ...m.aliases, m.nombre.split(' ').pop() ?? m.nombre]);
    const forma = Math.floor(azar() * 7);
    if (forma === 0) qs.push(base);
    else if (forma === 1) qs.push(typo(base));
    else if (forma === 2) qs.push(typo(typo(base)));
    else if (forma === 3) qs.push(`${m.marca} ${base}`);
    else if (forma === 4) qs.push(`${m.marca}${typo(base)}`.toLowerCase());
    else if (forma === 5) {
      const i = Math.floor(azar() * base.length);
      qs.push(base.slice(i, i + 2 + Math.floor(azar() * 6)));
    } else qs.push(Array.from({ length: 2 + Math.floor(azar() * 12) }, () => elegir([...'abcdefghijklmnopqrstuvwxyz0123456789 -'])).join(''));
  }
  return qs;
}

describe('buscarModelos optimizada ≡ la de #38', () => {
  it('mismas coincidencias, sugerencias, puntuaciones y orden en 1.000 consultas sobre 250 modelos', () => {
    const modelos = catalogo(250);
    let conCoincidencias = 0;
    let conSugerencias = 0;
    for (const q of consultas(modelos, 1000)) {
      const esperado = referencia.buscarModelos(q, modelos);
      expect(buscarModelos(q, modelos), JSON.stringify(q)).toEqual(esperado);
      if (esperado.coincidencias.length) conCoincidencias++;
      if (esperado.sugerencias.length) conSugerencias++;
    }
    // Si el generador solo produjera consultas sin resultado, el test no probaría nada.
    expect(conCoincidencias).toBeGreaterThan(300);
    expect(conSugerencias).toBeGreaterThan(60);
  });

  it('un catálogo nuevo no reutiliza la preparación del anterior', () => {
    const a = catalogo(50);
    const b = a.map((m) => ({ ...m, nombre: `${m.nombre}x9` }));
    for (const q of consultas(a, 200)) {
      buscarModelos(q, a);
      expect(buscarModelos(q, b), JSON.stringify(q)).toEqual(referencia.buscarModelos(q, b));
    }
  });

  it('distanciaEdicion da lo mismo, también con cadenas más largas que el búfer inicial', () => {
    const textos = ['', 'a', 'ab', 'ba', '2350', '2530', 'hll2350dw', 'laserjetprom404dn', 'x'.repeat(70), `${'ab'.repeat(40)}c`];
    for (const a of textos) for (const b of textos) expect(distanciaEdicion(a, b), `${a}|${b}`).toBe(referencia.distanciaEdicion(a, b));
    for (let i = 0; i < 2000; i++) {
      const a = Array.from({ length: Math.floor(azar() * 15) }, () => elegir([...'abc12'])).join('');
      const b = Array.from({ length: Math.floor(azar() * 15) }, () => elegir([...'abc12'])).join('');
      expect(distanciaEdicion(a, b), `${a}|${b}`).toBe(referencia.distanciaEdicion(a, b));
    }
  });
});
