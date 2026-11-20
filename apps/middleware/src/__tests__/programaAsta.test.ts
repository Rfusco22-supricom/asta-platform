import { afterAll, describe, expect, it } from 'vitest';
import { bajar, mesesAntesDe, mesesDelTrimestre, nivelBloqueado, nivelDeEntrada, plazoSellout, subir, topar, trimestreAnterior, trimestreDe, type ClientePrograma } from '@asta/shared-types';
import { prisma } from '../config/prisma.js';
import { CierreNoPermitido, cerrarTrimestre, conNivelesDelPrograma, evaluar, evaluarTrimestre, limiteSellout, nivelesActuales, type EntradaEvaluacion } from '../services/programaAsta.service.js';

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
  compras: [1100, 1050, 1000],
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

  it('Diamante está bloqueado: de Oro no se sube, y nadie empieza por encima de Oro', () => {
    expect([subir('PLATA'), subir('ORO')]).toEqual(['ORO', 'ORO']);
    expect([nivelBloqueado('DIAMANTE'), nivelBloqueado('ORO'), topar('DIAMANTE'), topar('PLATA')]).toEqual([true, false, 'ORO', 'PLATA']);
  });

  it('el sell-out de diciembre vale hasta el 31 de diciembre, hora de Caracas', () => {
    expect(limiteSellout('2026-12').toISOString()).toBe('2027-01-01T04:00:00.000Z');
  });

  it('el plazo del mes en curso cuenta hoy y cambia de mes a medianoche de Caracas', () => {
    expect(plazoSellout(new Date('2026-11-26T12:00:00Z'))).toEqual({ mes: '2026-11', ultimoDia: 30, dias: 5 });
    expect(plazoSellout(new Date('2026-12-01T03:59:00Z'))).toEqual({ mes: '2026-11', ultimoDia: 30, dias: 1 });
    expect(plazoSellout(new Date('2026-12-01T04:00:00Z'))).toEqual({ mes: '2026-12', ultimoDia: 31, dias: 31 });
    expect(plazoSellout(new Date('2028-02-28T12:00:00Z'))).toEqual({ mes: '2028-02', ultimoDia: 29, dias: 2 });
  });
});

describe('Las reglas', () => {
  it('cumple los tres obligatorios: sube uno y gana 12 tokens', () => {
    const e = evaluar(entrada({}));
    expect(e).toMatchObject({ cuotaMensual: 1000, cuotaTrimestral: 3000, compraTrimestre: 3150, nivelFinal: 'ORO', tokens: 12, definitiva: true });
    expect(e.obligatorios).toEqual({ mensual: true, trimestral: true, sellout: true });
  });

  it('cumple la trimestral pero falla un mes: baja, y solo gana la trimestral', () => {
    const e = evaluar(entrada({ compras: [3000, 100, 100] }));
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
    expect(evaluar(entrada({ nivel: 'GENERAL', compras: [500, 520, 600] }))).toMatchObject({ cuotaMensual: 500, nivelFinal: 'BRONCE', tokens: 12 });
    expect(evaluar(entrada({ nivel: 'GENERAL', compras: [0, 0, 0] }))).toMatchObject({ nivelFinal: 'GENERAL', tokens: 4 });
  });

  it('Oro que cumple se queda; el excedente de cada nivel', () => {
    // Oro necesita el 130 %: 2.600 de media.
    const oro = evaluar(entrada({ nivel: 'ORO', compras: [2600, 2600, 2600] }));
    expect(oro).toMatchObject({ nivelFinal: 'ORO', tokens: 13 });
    expect(oro.extras.excedente).toBe(true);
    // Bronce necesita el 150 %: 750 de media.
    expect(evaluar(entrada({ nivel: 'BRONCE', compras: [750, 750, 750] })).extras.excedente).toBe(true);
    expect(evaluar(entrada({ nivel: 'BRONCE', compras: [749, 749, 749] })).extras.excedente).toBe(false);
    // Plata, el 140 %: 1.400.
    expect(evaluar(entrada({ compras: [1400, 1400, 1400] })).extras.excedente).toBe(true);
    expect(evaluar(entrada({ compras: [1399, 1399, 1399] })).extras.excedente).toBe(false);
  });

  it('la racha pide este trimestre y el anterior sin fallos; la variedad, el 20 % de las referencias', () => {
    expect(evaluar(entrada({ anteriorSinFallos: true })).extras.racha).toBe(true);
    expect(evaluar(entrada({ anteriorSinFallos: true, compras: [3000, 100, 100] })).extras.racha).toBe(false);
    expect(evaluar(entrada({ referenciasCompradas: 34 })).extras.variedad).toBe(true);
    expect(evaluar(entrada({ referenciasCompradas: 33 })).extras.variedad).toBe(false);
    expect(evaluar(entrada({ anteriorSinFallos: true, referenciasCompradas: 34, compras: [1400, 1400, 1400] }))).toMatchObject({ tokens: 15 });
  });

  it('a mitad de trimestre: lo pendiente es null, lo logrado ya cuenta, y si cerrara hoy bajaría', () => {
    const e = evaluar(entrada({ mesesTerminados: [true, false, false], compras: [1100, 1050, 0], sellout: [true, null, null] }));
    expect(e.meses.map((m) => m.cumpleMinimo)).toEqual([true, true, null]);
    expect(e.obligatorios).toEqual({ mensual: null, trimestral: null, sellout: null });
    expect(e).toMatchObject({ definitiva: false, nivelFinal: 'BRONCE', tokens: 0 });
  });
});

describe('El nivel con el que entra al programa', () => {
  it('el más alto cuya cuota supera en un 50 % con su media: Bronce desde 750, Plata desde 1.500, Oro desde 3.000', () => {
    expect([0, 749.99, 750, 1499, 1500, 2999, 3000].map(nivelDeEntrada)).toEqual(['GENERAL', 'GENERAL', 'BRONCE', 'BRONCE', 'PLATA', 'PLATA', 'ORO']);
  });

  it('nunca en Diamante mientras esté bloqueado', () => {
    expect(nivelDeEntrada(50_000)).toBe('ORO');
  });

  it('la media es de los tres meses completos antes del mes de su primer acceso', () => {
    expect(mesesAntesDe('2026-11', 3)).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(mesesAntesDe('2027-02', 3)).toEqual(['2026-11', '2026-12', '2027-01']);
  });
});

describe('Entra al programa a mitad de trimestre (primer acceso al panel)', () => {
  const general = (e: Partial<EntradaEvaluacion>) => evaluar(entrada({ nivel: 'GENERAL', anteriorSinFallos: false, ...e }));

  it('los meses de antes no cuentan: compra 0, ni cumplen ni fallan, y la cuota trimestral es la de los meses que quedan', () => {
    const e = general({ desde: 1, compras: [5000, 600, 550], sellout: [false, true, true] });
    expect(e.meses.map((m) => [m.enPrograma, m.compra, m.cumpleMinimo, m.sellout])).toEqual([
      [false, 0, null, null],
      [true, 600, true, true],
      [true, 550, true, true],
    ]);
    expect([e.cuotaMensual, e.cuotaTrimestral, e.compraTrimestre]).toEqual([500, 1000, 1150]);
    // Sin el sell-out de octubre, que no se le pedía, sube igual.
    expect(e).toMatchObject({ obligatorios: { mensual: true, trimestral: true, sellout: true }, nivelFinal: 'BRONCE', definitiva: true });
  });

  it('el excedente se mide con la media de sus meses; sin trimestre anterior no hay racha', () => {
    expect(general({ desde: 2, compras: [0, 0, 760] }).extras).toMatchObject({ excedente: true, racha: false });
    expect(general({ desde: 2, compras: [0, 0, 740] }).extras.excedente).toBe(false);
  });

  it('con un mes pendiente de los suyos, todavía no es definitiva', () => {
    const e = general({ desde: 2, mesesTerminados: [true, true, false], sellout: [false, false, null], compras: [0, 0, 100] });
    expect(e).toMatchObject({ definitiva: false, obligatorios: { mensual: null, sellout: null } });
  });

  it('sin `desde`, todo el trimestre cuenta, como antes', () => {
    expect(evaluar(entrada({})).meses.every((m) => m.enPrograma)).toBe(true);
  });
});

describe('El cierre, contra MySQL', () => {
  const T = '2099-Q1';
  const DESPUES = new Date('2099-04-01T05:00:00Z');
  const cliente = (clave: string, nivel: 'PLATA' | 'ORO', nivelFinal: 'ORO' | 'BRONCE' | 'PLATA', tokens: number, definitiva = true): ClientePrograma => ({
    clave,
    partnerId: 3_990_000_001,
    nombre: clave,
    vendedor: null,
    vendedorOdooUserId: null,
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
    await expect(cerrarTrimestre(T, { aplicar: true, hoy: new Date('2099-04-01T03:00:00Z'), evaluarCon })).rejects.toThrow(/desde el 2099-04-01/);
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

  it('el trimestre siguiente empieza donde acabó este, con el saldo de tokens; y ese es el nivel de hoy', async () => {
    // 2099-Q2: sin compras en Odoo, los dos (con acceso desde enero) siguen en su nivel, y bajarían.
    // ZZPROG3 entra en mayo: Cliente general desde mayo. ZZPROG4 no ha entrado: no está.
    const miembros = new Map([
      ['ZZPROG1', { desde: '2099-01', partnerId: 3_990_000_001 }],
      ['ZZPROG2', { desde: '2099-01', partnerId: 3_990_000_002 }],
      ['ZZPROG3', { desde: '2099-05', partnerId: 3_990_000_003 }],
    ]);
    const siguiente = await evaluarTrimestre('2099-Q2', new Date('2099-05-15T12:00:00Z'), { miembros });
    const de = (clave: string) => siguiente.find((c) => c.clave === clave)!;
    expect(siguiente.map((c) => c.clave).sort()).toEqual(['ZZPROG1', 'ZZPROG2', 'ZZPROG3']);
    expect(de('ZZPROG1')).toMatchObject({ saldoTokens: 12, evaluacion: { nivel: 'ORO', nivelFinal: 'PLATA', definitiva: false } });
    expect(de('ZZPROG2')).toMatchObject({ saldoTokens: 4, evaluacion: { nivel: 'PLATA' } });
    expect(de('ZZPROG3').evaluacion).toMatchObject({ nivel: 'GENERAL', cuotaTrimestral: 1000 });
    expect(de('ZZPROG3').evaluacion.meses.map((m) => m.enPrograma)).toEqual([false, true, true]);

    // El nivel de hoy, para las cuentas y la pirámide: con el que está en el trimestre. Cliente general no sale.
    const niveles = await nivelesActuales(siguiente);
    expect([niveles.get('ZZPROG1'), niveles.get('ZZPROG2'), niveles.get('ZZPROG3')]).toEqual(['ORO', 'PLATA', undefined]);
  }, 120_000);

  it('la meta y la pirámide cuentan a cada cliente en su nivel del programa, no en su categoría de compra', async () => {
    const base = { porMes: [0, 0, 0, 0], mesesConCompra: 4, rif: null, vendedor: null, vendedorOdooUserId: null, siguiente: null };
    const programa = [cliente('ZZPROG1', 'ORO', 'ORO', 0), cliente('ZZPROG2', 'PLATA', 'PLATA', 0)];
    const r = await conNivelesDelPrograma({
      meses: ['2099-01', '2099-02', '2099-03', '2099-04'],
      compraMensual: 3000,
      meta: 100000,
      porCategoria: ['DIAMANTE', 'ORO', 'PLATA', 'BRONCE', 'GENERAL'].map((categoria) => ({
        categoria: categoria as 'ORO',
        clientes: 0,
        compraMensual: 0,
        metaClientes: null,
        metaCompraMensual: 0,
      })),
      clientes: [
        { ...base, clave: 'ZZPROG1', partnerId: 1, nombre: 'uno', compraMensual: 2000, categoria: 'DIAMANTE' },
        { ...base, clave: 'ZZPROG2', partnerId: 2, nombre: 'dos', compraMensual: 700, categoria: 'PLATA' },
        { ...base, clave: 'ZZPROG3', partnerId: 3, nombre: 'tres', compraMensual: 300, categoria: 'BRONCE' },
      ],
    }, programa);
    expect(r.clientes.map((c) => c.categoria)).toEqual(['ORO', 'PLATA', 'GENERAL']);
    const de = (k: string) => r.porCategoria.find((p) => p.categoria === k)!;
    expect([de('ORO').clientes, de('ORO').compraMensual, de('DIAMANTE').clientes, de('GENERAL').clientes]).toEqual([1, 2000, 0, 1]);
    // En el programa están todos los que tienen acceso, con nivel o sin él.
    expect(r.enPrograma).toBe(2);
  });
});
