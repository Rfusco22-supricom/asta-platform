import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import ExcelJS from 'exceljs';
import {
  porMarcarRespuestaSchema,
  resumenSellOutRespuestaSchema,
  sellOutEmpresaRespuestaSchema,
  validacionSellOutRespuestaSchema,
  type PorMarcar,
  type ReporteSellOut,
  type ResumenSellOut,
  type SellOutEmpresa,
  type ValidacionSellOut,
} from '@asta/shared-types';
import { createApp } from '../server.js';
import { prisma } from '../config/prisma.js';
import { emitirAccessToken } from '../auth/jwt.js';
import { caducaEnDias, hashSecreto } from '../auth/tokens.js';
import { cantidadDe, catalogoAsta, leerArchivo, mesDe, normalizarCodigo, sumarMeses } from '../services/sellOut.service.js';
import { esperarBitacora } from './soportes/esperarBitacora.js';

/**
 * Sell-out de los clientes (fase 2).
 *
 *   · el archivo se lee en Excel y en CSV, con la cabecera donde esté
 *   · un código que no es ASTA o una cantidad mala: no se guarda NADA
 *   · otro reporte del mismo mes sustituye al anterior, que queda de historial
 *   · con el inventario de dos meses, lo vendido se calcula
 *   · solo el cliente sube y ve lo suyo; el administrador ve a todos
 *
 * Partner inventado (3_850_000_001): en Odoo no compra nada, así que lo
 * comprado es 0 y lo vendido sale del inventario tal cual.
 */

let server: Server;
let base = '';
const usuarios: string[] = [];
const tokens = { cliente: '', vendedor: '', admin: '' };
const PARTNER = 3_850_000_001;
const INICIO = new Date();
const AGENTE = 'asta-test-sellout';
const MES = sumarMeses(mesDe(new Date()), -1);
const ANTES = sumarMeses(MES, -1);
let codigos: [string, string];
let ids: [number, number];

async function pedir<B>(metodo: 'GET' | 'POST', ruta: string, quien: keyof typeof tokens, cuerpo?: unknown) {
  const res = await fetch(`${base}${ruta}`, {
    method: metodo,
    headers: { 'User-Agent': AGENTE, Authorization: `Bearer ${tokens[quien]}`, ...(cuerpo !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
  });
  const tipo = res.headers.get('content-type') ?? '';
  return { status: res.status, tipo, body: (tipo.includes('json') ? await res.json() : await res.arrayBuffer()) as B };
}

const csv = (filas: string[][]) => Buffer.from(filas.map((f) => f.join(';')).join('\n')).toString('base64');

async function usuarioConToken(rol: 'SUPERADMIN' | 'VENDEDOR' | 'BRONCE', sufijo: string, partner: number) {
  const u = await prisma.appUser.create({
    data: { email: `test.sellout.${sufijo}@sellout.local`, fullName: `Sell-out ${sufijo}`, role: rol, odooPartnerId: partner, isActive: true },
  });
  usuarios.push(u.id);
  const sesion = await prisma.userSession.create({
    data: { userId: u.id, refreshTokenHash: hashSecreto(`so-${sufijo}-${Date.now()}-${Math.random()}`), expiresAt: caducaEnDias(1) },
    select: { id: true },
  });
  return emitirAccessToken({ sub: u.id, role: rol, odooPartnerId: partner, odooUserId: null, sid: sesion.id });
}

beforeAll(async () => {
  if (await prisma.appUser.count({ where: { email: { endsWith: '@sellout.local' } } })) throw new Error('Restos de @sellout.local: límpialos a mano.');
  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const dir = server.address();
  if (!dir || typeof dir === 'string') throw new Error('no se pudo abrir el puerto');
  base = `http://127.0.0.1:${dir.port}`;
  tokens.cliente = await usuarioConToken('BRONCE', 'cliente', PARTNER);
  tokens.vendedor = await usuarioConToken('VENDEDOR', 'vendedor', 3_850_000_002);
  tokens.admin = await usuarioConToken('SUPERADMIN', 'admin', 3_850_000_003);
  // Dos productos ASTA de verdad del catálogo de Odoo.
  const { porCodigo } = await catalogoAsta();
  const dos = [...porCodigo.values()].filter((p) => p.sku).slice(0, 2);
  if (dos.length < 2) throw new Error('El catálogo ASTA de Odoo no trae dos productos con código');
  codigos = [dos[0]!.sku!, dos[1]!.sku!];
  ids = [dos[0]!.id, dos[1]!.id];
}, 120_000);

afterAll(async () => {
  await esperarBitacora(INICIO);
  await prisma.apiRequestLog.deleteMany({ where: { createdAt: { gte: INICIO }, userAgent: AGENTE } });
  await prisma.sellOutReporte.deleteMany({ where: { odooPartnerId: PARTNER } });
  if (usuarios.length) {
    await prisma.auditLog.deleteMany({ where: { actorId: { in: usuarios } } });
    await prisma.appUser.deleteMany({ where: { id: { in: usuarios } } });
  }
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  await prisma.$disconnect();
});

describe('Leer el archivo', () => {
  it('cantidades con coma o punto, y códigos sin espacios ni mayúsculas', () => {
    expect([cantidadDe('1.234,5'), cantidadDe('12'), cantidadDe(7), cantidadDe('abc'), cantidadDe('')]).toEqual([1234.5, 12, 7, null, null]);
    expect(normalizarCodigo(' a-w1105a ')).toBe('A-W1105A');
  });

  it('CSV con «;» y la cabecera debajo de un título', async () => {
    const filas = await leerArchivo('ventas.csv', csv([['Mis ventas'], ['Código', 'Producto', 'Cantidad'], ['A-1', 'x', '3'], ['', '', ''], ['A-2', 'y', '4,5']]));
    expect(filas).toEqual([
      { fila: 3, codigo: 'A-1', cantidad: '3' },
      { fila: 5, codigo: 'A-2', cantidad: '4,5' },
    ]);
  });

  it('Excel', async () => {
    const libro = new ExcelJS.Workbook();
    const hoja = libro.addWorksheet('x');
    hoja.addRow(['Código', 'Cantidad']);
    hoja.addRow(['A-1', 10]);
    const b64 = Buffer.from(await libro.xlsx.writeBuffer()).toString('base64');
    expect(await leerArchivo('ventas.xlsx', b64)).toEqual([{ fila: 2, codigo: 'A-1', cantidad: 10 }]);
  });

  it('sin cabecera, o con otro formato: error claro', async () => {
    await expect(leerArchivo('x.csv', csv([['a', 'b'], ['1', '2']]))).rejects.toThrow(/cabecera/);
    await expect(leerArchivo('x.pdf', 'AAAA')).rejects.toThrow(/Excel/);
  });
});

describe('Subir el sell-out', () => {
  const subir = (ruta: string, mes: string, tipo: 'VENTAS' | 'INVENTARIO', filas: string[][]) =>
    pedir<{ data: ValidacionSellOut | ReporteSellOut }>('POST', ruta, 'cliente', { mes, tipo, nombre: 'ventas.csv', archivo: csv([['Código', 'Cantidad'], ...filas]) });

  it('la plantilla es un Excel con la cabecera', async () => {
    const r = await pedir<ArrayBuffer>('GET', '/api/v1/account/sellout/plantilla', 'cliente');
    expect(r.status).toBe(200);
    expect(r.tipo).toContain('spreadsheetml');
    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load(r.body);
    expect(libro.worksheets[0]!.getRow(1).values).toEqual([undefined, 'Código', 'Producto', 'Cantidad']);
  }, 60_000);

  it('comprobar no guarda; un código que no es ASTA es un error con su fila', async () => {
    const r = await subir('/api/v1/account/sellout/comprobar', MES, 'VENTAS', [[codigos[0], '5'], ['NO-EXISTE-ZZ', '2'], [codigos[0], '1']]);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(validacionSellOutRespuestaSchema.safeParse(r.body).success).toBe(true);
    const v = r.body.data as ValidacionSellOut;
    expect(v.errores).toEqual([{ fila: 3, codigo: 'NO-EXISTE-ZZ', motivo: 'No es un código de un producto ASTA' }]);
    expect(v.avisos.map((a) => a.fila)).toEqual([4]);
    expect(await prisma.sellOutReporte.count({ where: { odooPartnerId: PARTNER } })).toBe(0);
  }, 60_000);

  it('con errores no se guarda nada: 422', async () => {
    const r = await subir('/api/v1/account/sellout', MES, 'VENTAS', [[codigos[0], '-1']]);
    expect(r.status).toBe(422);
    expect(await prisma.sellOutReporte.count({ where: { odooPartnerId: PARTNER } })).toBe(0);
  }, 60_000);

  it('un mes que no ha llegado: 400', async () => {
    const r = await subir('/api/v1/account/sellout', sumarMeses(mesDe(new Date()), 1), 'VENTAS', [[codigos[0], '1']]);
    expect(r.status).toBe(400);
  });

  it('se guarda, y otro del mismo mes lo sustituye', async () => {
    const uno = await subir('/api/v1/account/sellout', MES, 'VENTAS', [[codigos[0], '5'], [codigos[1], '2']]);
    expect(uno.status, JSON.stringify(uno.body)).toBe(201);
    const dos = await subir('/api/v1/account/sellout', MES, 'VENTAS', [[codigos[0], '7']]);
    expect(dos.status).toBe(201);

    const r = await pedir<{ data: ResumenSellOut }>('GET', '/api/v1/account/sellout', 'cliente');
    expect(resumenSellOutRespuestaSchema.safeParse(r.body).success).toBe(true);
    expect(r.body.data.reportes.map((x) => x.vigente)).toEqual([true, false]);
    const mes = r.body.data.meses.find((m) => m.mes === MES)!;
    expect(mes).toMatchObject({ vendidas: 7, fuente: 'VENTAS' });
  }, 60_000);

  it('con el inventario de dos meses seguidos, lo vendido se calcula', async () => {
    // Otro mes: el de antes, sin ventas reportadas.
    expect((await subir('/api/v1/account/sellout', sumarMeses(ANTES, -1), 'INVENTARIO', [[codigos[0], '20']])).status).toBe(201);
    expect((await subir('/api/v1/account/sellout', ANTES, 'INVENTARIO', [[codigos[0], '12'], [codigos[1], '4']])).status).toBe(201);
    const r = await pedir<{ data: ResumenSellOut }>('GET', '/api/v1/account/sellout', 'cliente');
    // 20 de antes + 0 comprados − 12 que quedan = 8; el segundo no estaba antes: 0.
    expect(r.body.data.meses.find((m) => m.mes === ANTES)).toMatchObject({ vendidas: 8, existencia: 16, fuente: 'INVENTARIO' });
  }, 60_000);

  it('el personal no sube sell-out; el administrador ve a todos', async () => {
    expect((await pedir('GET', '/api/v1/account/sellout', 'vendedor')).status).toBe(403);
    expect((await pedir('GET', '/api/v1/admin/sellout', 'vendedor')).status).toBe(403);
    expect((await pedir('GET', '/api/v1/admin/sellout', 'cliente')).status).toBe(403);
    const r = await pedir<{ data: SellOutEmpresa }>('GET', `/api/v1/admin/sellout?mes=${MES}`, 'admin');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(sellOutEmpresaRespuestaSchema.safeParse(r.body).success).toBe(true);
    expect(r.body.data.clientes.find((c) => c.partnerId === PARTNER)).toMatchObject({ vendidas: 7, fuente: 'VENTAS' });
  }, 120_000);
});

describe('Marcar lo vendido («Lo que te vendimos»)', () => {
  const ACTUAL = mesDe(new Date());
  const marcar = (mes: string, productId: number, cantidad: number, quien: keyof typeof tokens = 'cliente') =>
    pedir<{ data: PorMarcar }>('POST', '/api/v1/account/sellout/marcar', quien, { mes, productId, cantidad });
  const de = (r: { body: { data: PorMarcar } }, id: number) => r.body.data.productos.find((p) => p.productId === id)!;

  it('parte del último conteo de inventario: lo que tenía menos lo vendido', async () => {
    // Del test de arriba: inventario de ANTES (12 y 4) y ventas de MES (7 del primero).
    const r = await pedir<{ data: PorMarcar }>('GET', '/api/v1/account/sellout/marcar', 'cliente');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(porMarcarRespuestaSchema.safeParse(r.body).success).toBe(true);
    expect(r.body.data).toMatchObject({ mes: ACTUAL, inventario: ANTES, desde: MES });
    expect(de(r, ids[0])).toMatchObject({ base: 12, vendidas: 7, quedan: 5, vendidasMes: 0 });
    expect(de(r, ids[1])).toMatchObject({ base: 4, vendidas: 0, quedan: 4 });
  }, 60_000);

  it('marcar es el total del mes: repetirlo no suma, y no llena el historial', async () => {
    expect(de(await marcar(ACTUAL, ids[0], 2), ids[0])).toMatchObject({ vendidasMes: 2, quedan: 3 });
    const otra = await marcar(ACTUAL, ids[0], 3);
    expect(de(otra, ids[0])).toMatchObject({ vendidasMes: 3, vendidas: 10, quedan: 2 });
    const vivos = await prisma.sellOutReporte.findMany({ where: { odooPartnerId: PARTNER, mes: ACTUAL, tipo: 'VENTAS' } });
    expect(vivos).toHaveLength(1);
    expect(vivos[0]).toMatchObject({ archivo: 'Marcado en el panel', filas: 1, reemplazadoEn: null });
  }, 60_000);

  it('marcar el mes pasado sobre un Excel: el Excel queda de historial y sus líneas se conservan', async () => {
    const r = await marcar(MES, ids[1], 1);
    expect(de(r, ids[1])).toMatchObject({ vendidasMes: 1, quedan: 3 });
    expect(de(r, ids[0])).toMatchObject({ quedan: 2 });
    const del = await prisma.sellOutReporte.findMany({ where: { odooPartnerId: PARTNER, mes: MES, tipo: 'VENTAS' }, include: { lineas: true }, orderBy: { createdAt: 'asc' } });
    expect(del.map((x) => [x.archivo, x.reemplazadoEn === null])).toEqual([
      ['ventas.csv', false],
      ['ventas.csv', false],
      ['Marcado en el panel', true],
    ]);
    expect(del[2]!.lineas.map((l) => [l.odooProductId, Number(l.cantidad)]).sort()).toEqual([[ids[0], 7], [ids[1], 1]].sort());
  }, 60_000);

  it('solo este mes o el anterior, solo productos ASTA, y solo el cliente', async () => {
    expect((await marcar(ANTES, ids[0], 1)).status).toBe(400);
    expect((await marcar(ACTUAL, 1, 1)).status).toBe(400);
    expect((await marcar(ACTUAL, ids[0], -1)).status).toBe(400);
    expect((await marcar(ACTUAL, ids[0], 1, 'vendedor')).status).toBe(403);
    expect((await pedir('GET', `/api/v1/account/sellout/marcar?mes=${ANTES}`, 'cliente')).status).toBe(400);
  }, 60_000);
});
