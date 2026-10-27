import { afterAll, describe, expect, it } from 'vitest';
import { bajar, mesesDelTrimestre, subir, trimestreAnterior, trimestreDe, type ClientePrograma } from '@asta/shared-types';
import { prisma } from '../config/prisma.js';
import { CierreNoPermitido, cerrarTrimestre, evaluar, evaluarTrimestre, limiteSellout, nivelesActuales, type EntradaEvaluacion } from '../services/programaAsta.service.js';

/**
 * El programa de ASTA por trimestres.
 *
 *   · las reglas, solas: los tres obligatorios mueven el nivel de uno en uno,
 *     los extras dan tokens y no lo mueven, y lo pendiente es `null`;
 *   · el cierre, contra MySQL: solo cuando es definitivo, una vez, y el
 *     trimestre siguiente empieza donde acabó este.
 *
 * Los cierres de prueba son de trimestres lejanos (2099) y de clientes
 * inventados («ZZPROG…»), y se borran al final.
 */

const TERMINADO: EntradaEvaluacion['mesesTerminados'] = [true, true, true];
const REPORTADO: EntradaEvaluacion['sellout'] = [true, true, true];

const entrada = (e: Partial<EntradaEvaluacion>): EntradaEvaluacion => ({
  trimestre: '2026-Q4',
  nivel: 'PLATA',
  compras: [700, 650, 600],
  mesesTerminados: TERMINADO,
  sellout: REPORTADO,
  referenciasCompradas: 10,
  referenciasTotal: 166,
  anteriorSinFallos: false,
  ...e,
});

describe('Trimestres', () => {
  it('de calendario', () => {
    expect(trimestreDe('2026-11-03')).toBe('2026-Q4');
    expect(trimestreDe('2027-01-01')).toBe('2027-Q1');
    expect(mesesDelTrimestre('2027-Q1')).toEqual(['2027-01', '2027-02', '2027-03']);
    expect(trimestreAnterior('2027-Q1')).toBe('2026-Q4');
  });

  it('de uno en uno, sin pasarse de los extremos', () => {
    expect([subir('BRONCE'), subir('DIAMANTE'), bajar('ORO'), bajar('GENERAL')]).toEqual(['PLATA', 'DIAMANTE', 'PLATA', 'GENERAL']);
  });

  it('el sell-out de diciembre vale hasta el 10 de enero, hora de Caracas', () => {
    expect(limiteSellout('2026-12').toISOString()).toBe('2027-01-11T04:00:00.000Z');
  });
});

describe('Las reglas', () => {
  it('cumple los tres obligatorios: sube uno y gana 12 tokens', () => {
    const e = evaluar(entrada({}));
    expect(e).toMatchObject({ cuotaMensual: 600, cuotaTrimestral: 1800, compraTrimestre: 1950, nivelFinal: 'ORO', tokens: 12, definitiva: true });
    expect(e.obligatorios).toEqual({ mensual: true, trimestral: true, sellout: true });
  });

  it('cumple la trimestral pero falla un mes: baja, y solo gana la trimestral', () => {
    const e = evaluar(entrada({ compras: [2000, 100, 100] }));
    expect(e.obligatorios).toEqual({ mensual: false, trimestral: true, sellout: true });
    expect(e.meses.map((m) => m.cumpleMinimo)).toEqual([true, false, false]);
    expect(e).toMatchObject({ nivelFinal: 'BRONCE', tokens: 8 });
  });

  it('sin sell-out de un mes, baja aunque compre de sobra', () => {
    const e = evaluar(entrada({ sellout: [true, false, true] }));
    expect(e.obligatorios.sellout).toBe(false);
    expect(e).toMatchObject({ nivelFinal: 'BRONCE', tokens: 8 });
  });

  it('un Cliente general se mide con Bronce, y sube a Bronce; sin cumplir, se queda', () => {
    expect(evaluar(entrada({ nivel: 'GENERAL', compras: [250, 260, 300] }))).toMatchObject({ cuotaMensual: 250, nivelFinal: 'BRONCE', tokens: 12 });
    expect(evaluar(entrada({ nivel: 'GENERAL', compras: [0, 0, 0] }))).toMatchObject({ nivelFinal: 'GENERAL', tokens: 4 });
  });

  it('Diamante que cumple se queda; el excedente de cada nivel', () => {
    const diamante = evaluar(entrada({ nivel: 'DIAMANTE', compras: [3600, 3600, 3600] }));
    expect(diamante).toMatchObject({ nivelFinal: 'DIAMANTE', tokens: 13 });
    expect(diamante.extras.excedente).toBe(true);
    // Bronce necesita el 150 %: 375 de media.
    expect(evaluar(entrada({ nivel: 'BRONCE', compras: [375, 375, 375] })).extras.excedente).toBe(true);
    expect(evaluar(entrada({ nivel: 'BRONCE', compras: [374, 374, 374] })).extras.excedente).toBe(false);
    // Plata, el 140 %: 840.
    expect(evaluar(entrada({ compras: [840, 840, 840] })).extras.excedente).toBe(true);
  });

  it('la racha pide este trimestre y el anterior sin fallos; la variedad, el 20 % de las referencias', () => {
    expect(evaluar(entrada({ anteriorSinFallos: true })).extras.racha).toBe(true);
    expect(evaluar(entrada({ anteriorSinFallos: true, compras: [2000, 100, 100] })).extras.racha).toBe(false);
    expect(evaluar(entrada({ referenciasCompradas: 34 })).extras.variedad).toBe(true);
    expect(evaluar(entrada({ referenciasCompradas: 33 })).extras.variedad).toBe(false);
    expect(evaluar(entrada({ anteriorSinFallos: true, referenciasCompradas: 34, compras: [900, 900, 900] }))).toMatchObject({ tokens: 15 });
  });

  it('a mitad de trimestre: lo pendiente es null, lo logrado ya cuenta, y si cerrara hoy bajaría', () => {
    const e = evaluar(entrada({ mesesTerminados: [true, false, false], compras: [700, 650, 0], sellout: [true, null, null] }));
    expect(e.meses.map((m) => m.cumpleMinimo)).toEqual([true, true, null]);
    expect(e.obligatorios).toEqual({ mensual: null, trimestral: null, sellout: null });
    expect(e).toMatchObject({ definitiva: false, nivelFinal: 'BRONCE', tokens: 0 });
  });
});

describe('El cierre, contra MySQL', () => {
  const T = '2099-Q1';
  const DESPUES = new Date('2099-04-11T05:00:00Z');
  const cliente = (clave: string, nivel: 'PLATA' | 'ORO', nivelFinal: 'ORO' | 'BRONCE' | 'PLATA', tokens: number, definitiva = true): ClientePrograma => ({
    clave,
    partnerId: 3_990_000_001,
    nombre: clave,
    saldoTokens: 0,
    evaluacion: {
      ...evaluar(entrada({ trimestre: T })),
      nivel,
      nivelFinal,
      tokens,
      definitiva,
    },
  });
  const evaluarCon = async () => [cliente('ZZPROG1', 'PLATA', 'ORO', 12), cliente('ZZPROG2', 'ORO', 'PLATA', 4)];

  afterAll(async () => {
    await prisma.programaTrimestre.deleteMany({ where: { clave: { startsWith: 'ZZPROG' } } });
    await prisma.$disconnect();
  });

  it('no antes de que venza el plazo del sell-out de su último mes', async () => {
    await expect(cerrarTrimestre(T, { aplicar: true, hoy: new Date('2099-04-10T12:00:00Z'), evaluarCon })).rejects.toThrow(/desde el 2099-04-11/);
  });

  it('no con una evaluación que todavía puede cambiar', async () => {
    await expect(cerrarTrimestre(T, { aplicar: true, hoy: DESPUES, evaluarCon: async () => [cliente('ZZPROG9', 'ORO', 'PLATA', 0, false)] })).rejects.toThrow(
      CierreNoPermitido,
    );
    expect(await prisma.programaTrimestre.count({ where: { trimestre: T } })).toBe(0);
  });

  it('el simulacro no escribe; el cierre guarda una fila por cliente, y una sola vez', async () => {
    const simulacro = await cerrarTrimestre(T, { aplicar: false, hoy: DESPUES, evaluarCon });
    expect(simulacro).toMatchObject({ clientes: 2, suben: 1, bajan: 1, tokens: 16 });
    expect(await prisma.programaTrimestre.count({ where: { trimestre: T } })).toBe(0);

    await cerrarTrimestre(T, { aplicar: true, hoy: DESPUES, evaluarCon });
    const filas = await prisma.programaTrimestre.findMany({ where: { trimestre: T }, orderBy: { clave: 'asc' } });
    expect(filas.map((f) => [f.clave, f.nivelInicio, f.nivelFin, f.tokens])).toEqual([
      ['ZZPROG1', 'PLATA', 'ORO', 12],
      ['ZZPROG2', 'ORO', 'PLATA', 4],
    ]);
    await expect(cerrarTrimestre(T, { aplicar: true, hoy: DESPUES, evaluarCon })).rejects.toThrow(/ya está cerrado/);
  });

  it('el nivel de hoy es el del último cierre, y el trimestre siguiente empieza ahí con el saldo de tokens', async () => {
    const niveles = await nivelesActuales();
    expect([niveles.get('ZZPROG1'), niveles.get('ZZPROG2')]).toEqual(['ORO', 'PLATA']);

    // 2099-Q2: sin compras en Odoo, los dos están en el programa por su nivel, y bajarían.
    const siguiente = await evaluarTrimestre('2099-Q2', new Date('2099-05-15T12:00:00Z'));
    const de = (clave: string) => siguiente.find((c) => c.clave === clave)!;
    expect(de('ZZPROG1')).toMatchObject({ saldoTokens: 12, evaluacion: { nivel: 'ORO', nivelFinal: 'PLATA', definitiva: false } });
    expect(de('ZZPROG2')).toMatchObject({ saldoTokens: 4, evaluacion: { nivel: 'PLATA' } });
  }, 120_000);
});
