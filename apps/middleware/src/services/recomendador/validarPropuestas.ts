import type { CompatibilityStatus } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import type { FilaCsv } from '../../utils/csv.js';
import { normalizarCodigoCartucho } from './normalizar.js';
import { relacionConCartucho, tipoDeCartucho, type ProductoOdoo } from './importarPropuestas.js';
import type { MarcaCartucho } from './extraerCartuchos.js';

/**
 * Validación de propuestas "producto → cartucho" desde un CSV revisado (#56).
 *
 * Una persona abre en Excel el CSV de `pnpm cartuchos:proponer`, rellena la
 * columna `decision` y lo devuelve. Esto lo lleva a `product_cartridges`.
 *
 * Es el paso que convierte una inferencia en algo que el kiosco le enseña a un
 * cliente, así que está hecho para equivocarse poco:
 *
 *   · **Primero se planifica, sin escribir.** `planificarValidacion` dice qué
 *     haría con cada fila. Solo `aplicarValidacion` escribe, y el script no la
 *     llama sin `--aplicar`.
 *   · **Todo o nada.** Si una sola fila es inválida, el plan tiene errores y no
 *     se aplica ninguna. Un CSV a medio aplicar obliga a averiguar qué entró.
 *   · **Una decisión tomada no se cambia en silencio.** Si una fila dice
 *     RECHAZADA sobre algo ya VALIDADO, es un error salvo con
 *     `permitirCambios`. Un CSV viejo reutilizado por error no deshace la
 *     revisión de otro.
 *   · **Queda quién y cuándo.** `reviewed_by` es el revisor; tiene que ser un
 *     SUPERADMIN activo.
 *
 * Las filas sin propuesta previa con `decision = VALIDADA` son CAPTURA MANUAL:
 * los productos para los que el extractor no encontró cartucho y alguien lo
 * escribió a mano. Se crean con `source = MANUAL` y ya validadas, y el producto
 * tiene que existir en Odoo.
 */

export type Decision = Exclude<CompatibilityStatus, 'PROPUESTA'>;

export const MARCAS_CONOCIDAS: MarcaCartucho[] = ['HP', 'Canon', 'Epson', 'Brother', 'Samsung'];

const COLUMNAS_OBLIGATORIAS = ['odoo_product_tmpl_id', 'marca', 'codigo', 'decision'];

interface Clave {
  linea: number;
  tmplId: number;
  marca: string;
  codigo: string;
  codigoNormalizado: string;
  decision: Decision;
  nota: string;
}

export type Accion =
  | (Clave & { tipo: 'DECIDIR'; cartridgeId: number; de: CompatibilityStatus; evidenciaActual: string | null })
  | (Clave & { tipo: 'CREAR_MANUAL'; producto: ProductoOdoo })
  | (Clave & { tipo: 'SIN_CAMBIO' });

export interface Plan {
  acciones: Accion[];
  errores: Array<{ linea: number; mensaje: string }>;
  avisos: Array<{ linea: number; mensaje: string }>;
  /** Filas con `decision` vacía: no revisadas todavía. */
  sinDecidir: number;
}

export interface OpcionesPlan {
  permitirCambios?: boolean;
  /** Lee plantillas de Odoo por id. Inyectado para poder probarlo sin Odoo. */
  buscarProductos: (ids: number[]) => Promise<ProductoOdoo[]>;
}

function leerDecision(valor: string): Decision | null | 'invalida' {
  const v = valor.trim().toUpperCase();
  if (v === '') return null;
  if (v === 'VALIDADA' || v === 'RECHAZADA') return v;
  return 'invalida';
}

export async function planificarValidacion(filas: FilaCsv[], opciones: OpcionesPlan): Promise<Plan> {
  const plan: Plan = { acciones: [], errores: [], avisos: [], sinDecidir: 0 };

  if (filas.length > 0) {
    const faltan = COLUMNAS_OBLIGATORIAS.filter((c) => !(c in filas[0].campos));
    if (faltan.length > 0) {
      plan.errores.push({ linea: 1, mensaje: `faltan columnas: ${faltan.join(', ')}` });
      return plan;
    }
  }

  const marcasEnBase = await prisma.printerBrand.findMany();
  const marcaCanonica = new Map(
    [...MARCAS_CONOCIDAS, ...marcasEnBase.map((m) => m.name)].map((m) => [m.toLowerCase(), m]),
  );

  // ── 1. Validar cada fila por separado ──────────────────────────────────────
  const claves: Clave[] = [];
  for (const { linea, campos } of filas) {
    const decision = leerDecision(campos.decision ?? '');
    if (decision === null) {
      plan.sinDecidir++;
      continue;
    }
    if (decision === 'invalida') {
      plan.errores.push({ linea, mensaje: `decision "${campos.decision}" no es VALIDADA ni RECHAZADA` });
      continue;
    }
    const tmplId = Number(campos.odoo_product_tmpl_id);
    if (!Number.isInteger(tmplId) || tmplId <= 0) {
      plan.errores.push({ linea, mensaje: `odoo_product_tmpl_id "${campos.odoo_product_tmpl_id}" no es un id válido` });
      continue;
    }
    const marca = marcaCanonica.get((campos.marca ?? '').trim().toLowerCase());
    if (!marca) {
      plan.errores.push({ linea, mensaje: `marca "${campos.marca}" desconocida (conocidas: ${[...new Set(marcaCanonica.values())].join(', ')})` });
      continue;
    }
    const codigo = (campos.codigo ?? '').trim();
    const codigoNormalizado = normalizarCodigoCartucho(codigo);
    if (!codigoNormalizado) {
      plan.errores.push({ linea, mensaje: 'falta el código de cartucho' });
      continue;
    }
    claves.push({ linea, tmplId, marca, codigo, codigoNormalizado, decision, nota: (campos.nota ?? '').trim() });
  }

  // ── 2. La misma propuesta dos veces en el archivo ─────────────────────────
  const vistas = new Map<string, Clave>();
  const unicas: Clave[] = [];
  for (const c of claves) {
    const k = `${c.tmplId}:${c.marca}:${c.codigoNormalizado}`;
    const previa = vistas.get(k);
    if (!previa) {
      vistas.set(k, c);
      unicas.push(c);
    } else if (previa.decision !== c.decision) {
      plan.errores.push({ linea: c.linea, mensaje: `contradice la línea ${previa.linea}: ${previa.decision} y ${c.decision} para el mismo producto y cartucho` });
    }
  }

  // ── 3. Contra lo que hay en la base ───────────────────────────────────────
  const marcaId = new Map(marcasEnBase.map((m) => [m.name, m.id]));
  const cartuchos = unicas.length
    ? await prisma.cartridge.findMany({
        where: {
          OR: unicas
            .filter((c) => marcaId.has(c.marca))
            .map((c) => ({ brandId: marcaId.get(c.marca)!, codeNormalized: c.codigoNormalizado })),
        },
      })
    : [];
  const cartuchoDe = (c: Clave) => cartuchos.find((x) => x.brandId === marcaId.get(c.marca) && x.codeNormalized === c.codigoNormalizado);

  const existentes = await prisma.productCartridge.findMany({
    where: { OR: unicas.flatMap((c) => (cartuchoDe(c) ? [{ odooProductTmplId: c.tmplId, cartridgeId: cartuchoDe(c)!.id }] : [])).concat([{ odooProductTmplId: -1, cartridgeId: -1 }]) },
  });

  const manuales: Clave[] = [];
  for (const c of unicas) {
    const cartucho = cartuchoDe(c);
    const fila = cartucho && existentes.find((e) => e.odooProductTmplId === c.tmplId && e.cartridgeId === cartucho.id);

    if (!fila) {
      if (c.decision === 'RECHAZADA') {
        plan.avisos.push({ linea: c.linea, mensaje: 'RECHAZADA sobre algo que no estaba propuesto: no hay nada que rechazar, se ignora' });
      } else {
        manuales.push(c);
      }
      continue;
    }
    if (fila.status === c.decision) {
      plan.acciones.push({ ...c, tipo: 'SIN_CAMBIO' });
      continue;
    }
    if (fila.status !== 'PROPUESTA' && !opciones.permitirCambios) {
      plan.errores.push({ linea: c.linea, mensaje: `ya estaba ${fila.status}; cambiarla a ${c.decision} exige --permitir-cambios` });
      continue;
    }
    plan.acciones.push({ ...c, tipo: 'DECIDIR', cartridgeId: cartucho!.id, de: fila.status, evidenciaActual: fila.evidence });
  }

  // ── 4. Captura manual: el producto tiene que existir en Odoo ──────────────
  if (manuales.length > 0) {
    const productos = await opciones.buscarProductos([...new Set(manuales.map((m) => m.tmplId))]);
    const porId = new Map(productos.map((p) => [p.id, p]));
    for (const m of manuales) {
      const producto = porId.get(m.tmplId);
      if (!producto) {
        plan.errores.push({ linea: m.linea, mensaje: `el producto ${m.tmplId} no existe en Odoo (o no es visible): no se puede crear la compatibilidad` });
        continue;
      }
      plan.acciones.push({ ...m, tipo: 'CREAR_MANUAL', producto });
    }
  }

  plan.acciones.sort((a, b) => a.linea - b.linea);
  return plan;
}

export interface Revisor {
  id: string;
  email: string;
}

/** El revisor tiene que ser un SUPERADMIN activo. */
export async function resolverRevisor(email: string): Promise<Revisor> {
  const u = await prisma.appUser.findFirst({ where: { email: email.trim().toLowerCase() } });
  if (!u) throw new Error(`No existe un usuario con email ${email}`);
  if (!u.isActive) throw new Error(`El usuario ${email} está desactivado`);
  if (u.role !== 'SUPERADMIN') throw new Error(`El usuario ${email} es ${u.role}: validar compatibilidades exige SUPERADMIN`);
  return { id: u.id, email: u.email };
}

function conNota(evidencia: string | null, nota: string): string | null {
  if (!nota) return evidencia;
  return `${evidencia ? `${evidencia} · ` : ''}Revisión: ${nota}`.slice(0, 255);
}

export interface ResultadoAplicacion {
  decididas: number;
  creadasManuales: number;
  sinCambio: number;
}

/**
 * Aplica un plan SIN errores, en una transacción: o entra todo o no entra nada.
 * Lanza si el plan trae errores; no es algo que se deba poder saltar.
 */
export async function aplicarValidacion(plan: Plan, revisor: Revisor, ahora = new Date()): Promise<ResultadoAplicacion> {
  if (plan.errores.length > 0) {
    throw new Error(`El plan tiene ${plan.errores.length} errores: no se aplica nada`);
  }

  return prisma.$transaction(async (tx) => {
    const r: ResultadoAplicacion = { decididas: 0, creadasManuales: 0, sinCambio: 0 };

    for (const a of plan.acciones) {
      if (a.tipo === 'SIN_CAMBIO') {
        r.sinCambio++;
      } else if (a.tipo === 'DECIDIR') {
        // `status` en el where: si otro revisor la cambió entre planificar y
        // aplicar, no se pisa, y la transacción entera se deshace.
        const { count } = await tx.productCartridge.updateMany({
          where: { odooProductTmplId: a.tmplId, cartridgeId: a.cartridgeId, status: a.de },
          data: { status: a.decision, reviewedBy: revisor.id, reviewedAt: ahora, evidence: conNota(a.evidenciaActual, a.nota) },
        });
        if (count !== 1) {
          throw new Error(`Línea ${a.linea}: la propuesta cambió desde que se planificó. No se ha aplicado nada; vuelve a planificar.`);
        }
        r.decididas++;
      } else {
        const brand = await tx.printerBrand.upsert({ where: { name: a.marca }, update: {}, create: { name: a.marca } });
        const cartucho = await tx.cartridge.upsert({
          where: { brandId_codeNormalized: { brandId: brand.id, codeNormalized: a.codigoNormalizado } },
          update: {},
          create: { brandId: brand.id, code: a.codigo, codeNormalized: a.codigoNormalizado, kind: tipoDeCartucho(a.producto.name) },
        });
        await tx.productCartridge.create({
          data: {
            odooProductTmplId: a.tmplId,
            cartridgeId: cartucho.id,
            relation: relacionConCartucho(a.producto, { marca: a.marca as MarcaCartucho, codigo: a.codigo, codigoNormalizado: a.codigoNormalizado, evidencia: '' }),
            source: 'MANUAL',
            evidence: (a.nota || 'Captura manual').slice(0, 255),
            status: 'VALIDADA',
            reviewedBy: revisor.id,
            reviewedAt: ahora,
          },
        });
        r.creadasManuales++;
      }
    }
    return r;
  });
}
