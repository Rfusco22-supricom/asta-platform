import type { CoberturaTop, EstadoCobertura } from '@asta/shared-types';
import { prisma } from '../../config/prisma.js';
import { plantillas, ventasPorPlantilla } from './revision.service.js';

/**
 * Cuánto del top de ventas puede recomendar ya el kiosco (#56, Fase 4).
 *
 * Es la cifra que DECIDE si la Fase 5 sale, y el umbral no lo inventa esto: está
 * en #7 y lo repite #56, medido sobre el top 20 de ventas y no sobre el catálogo
 * entero, porque la cola larga importa menos.
 *
 *   > 85 %    la Fase 5 procede como estaba planeada
 *   60–85 %   procede con flujo de respaldo («no encontramos tu modelo…»)
 *   < 60 %    sigue pospuesta
 *
 * ── Qué cuenta como cubierto ─────────────────────────────────────────────────
 *
 * La cadena ENTERA validada, que es lo que el cliente necesita para que el
 * kiosco le diga algo: su impresora → un cartucho → un producto que vendemos.
 * Con solo la mitad, el recomendador no devuelve nada, así que contarlo como
 * cubierto daría un número bonito y falso.
 *
 * Por eso cada producto que falta dice QUÉ le falta: sin esa distinción, la
 * lista no dice por dónde seguir revisando.
 */

/** Los 20 más vendidos, como fija #56. */
const TAMANO_TOP = 20;

export async function coberturaDelTop(): Promise<CoberturaTop> {
  const ventas = await ventasPorPlantilla();
  const top = [...ventas.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TAMANO_TOP)
    .map(([templateId, importe]) => ({ templateId, importe }));

  if (top.length === 0) {
    return { productos: [], totales: { top: 0, completos: 0, porcentaje: 0, tramo: 'pospuesta', importeTop: 0, importeCubierto: 0 } };
  }

  const ids = top.map((t) => t.templateId);

  // Producto → cartucho, validado.
  const validadas = await prisma.productCartridge.findMany({
    where: { odooProductTmplId: { in: ids }, status: 'VALIDADA' },
    select: { odooProductTmplId: true, cartridgeId: true, cartridge: { select: { code: true } } },
  });
  const cartuchosDe = new Map<number, Array<{ id: number; code: string }>>();
  for (const v of validadas) {
    cartuchosDe.set(v.odooProductTmplId, [...(cartuchosDe.get(v.odooProductTmplId) ?? []), { id: v.cartridgeId, code: v.cartridge.code }]);
  }

  // Cartucho → impresora, validado y con la impresora activa: si está retirada,
  // el kiosco tampoco la ofrece.
  const conImpresora = new Set(
    (
      await prisma.cartridgePrinterModel.findMany({
        where: { cartridgeId: { in: validadas.map((v) => v.cartridgeId) }, status: 'VALIDADA', printerModel: { isActive: true } },
        select: { cartridgeId: true },
        distinct: ['cartridgeId'],
      })
    ).map((f) => f.cartridgeId),
  );

  const odoo = await plantillas(ids);

  const productos = top.map(({ templateId, importe }) => {
    const cartuchos = cartuchosDe.get(templateId) ?? [];
    const estado: EstadoCobertura = cartuchos.length === 0 ? 'sin_cartucho' : cartuchos.some((c) => conImpresora.has(c.id)) ? 'completo' : 'sin_impresora';
    const p = odoo.get(templateId);
    return {
      templateId,
      nombre: p?.nombre ?? null,
      sku: p?.sku ?? null,
      ventas12m: Math.round(importe * 100) / 100,
      estado,
      cartuchos: cartuchos.map((c) => c.code),
    };
  });

  const completos = productos.filter((p) => p.estado === 'completo').length;
  const porcentaje = Math.round((completos / productos.length) * 100);
  const importeTop = productos.reduce((s, p) => s + p.ventas12m, 0);
  const importeCubierto = productos.filter((p) => p.estado === 'completo').reduce((s, p) => s + p.ventas12m, 0);

  return {
    productos,
    totales: {
      top: productos.length,
      completos,
      porcentaje,
      // El umbral de #7, aplicado aquí para que la pantalla no lo reinterprete.
      tramo: porcentaje > 85 ? 'procede' : porcentaje >= 60 ? 'con_respaldo' : 'pospuesta',
      importeTop: Math.round(importeTop * 100) / 100,
      importeCubierto: Math.round(importeCubierto * 100) / 100,
    },
  };
}
