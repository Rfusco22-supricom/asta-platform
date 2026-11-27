import { z } from 'zod';

/**
 * El catálogo de productos ASTA para el personal (sección «Catálogo»): las
 * mismas fichas que el PDF que los vendedores mandan a sus clientes, con foto,
 * códigos y el precio de la «Lista de Precios» de Valencia, en USD sin IVA.
 *
 * Las fichas son una foto fija (salen de la misma generación que el PDF); los
 * precios se leen de Odoo al pedirlas, y el PDF con precios se arma con esos
 * mismos al descargarlo. En el repositorio no hay ni un precio.
 */

export const TIPOS_CATALOGO = ['toner', 'tinta', 'tambor', 'polvo', 'chip'] as const;
export type TipoCatalogo = (typeof TIPOS_CATALOGO)[number];

export const TITULOS_CATALOGO: Record<TipoCatalogo, string> = {
  toner: 'Tóner láser',
  tinta: 'Tintas',
  tambor: 'Tambores',
  polvo: 'Polvo para recarga',
  chip: 'Chips',
};

export const colorCatalogoSchema = z.enum(['Negro', 'Cian', 'Magenta', 'Amarillo']);

export const fichaCatalogoSchema = z.object({
  id: z.string(),
  tipo: z.enum(TIPOS_CATALOGO),
  marca: z.string(),
  titulo: z.string(),
  /** Nombre del archivo en `apps/web/public/catalogo/`; null si no tiene foto. */
  foto: z.string().nullable(),
  colores: z.array(colorCatalogoSchema),
  /** Los cartuchos originales que reemplaza (CF226A, CRG-055…). */
  cartuchos: z.array(z.string()),
  /** Impresoras compatibles, con su marca delante: para buscar por modelo. */
  impresoras: z.array(z.string()),
  variantes: z.array(
    z.object({
      codigo: z.string(),
      color: colorCatalogoSchema.nullable(),
      /** «con chip», «70 ml»… */
      detalle: z.string().nullable(),
      /** USD sin IVA, de Odoo al pedirlo; null si la tarifa no lo tiene. */
      precio: z.number().nullable().default(null),
    }),
  ),
});
export type FichaCatalogo = z.infer<typeof fichaCatalogoSchema>;

export const catalogoAstaSchema = z.object({
  /** Fecha (AAAA-MM-DD) de las fichas: productos, fotos y compatibilidades. */
  actualizado: z.string(),
  /** Cuándo se leyeron los precios de Odoo (ISO); null si no se pudieron leer. */
  preciosLeidos: z.string().nullable().default(null),
  fichas: z.array(fichaCatalogoSchema),
});
export type CatalogoAsta = z.infer<typeof catalogoAstaSchema>;
