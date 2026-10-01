import { readGroup, searchRead, type OdooDomain } from '../odoo/client.js';
import { logger } from '../utils/logger.js';
import { invalidarAlmacenesDeClientes } from './inventory.service.js';
import { invalidarPreciosDeProductos, invalidarPreciosDeTarifas, invalidarTarifasDeClientes } from './pricing.service.js';

/**
 * Invalidación de las caches por lo que cambia en Odoo (#34).
 *
 * ── Por qué sondeo y no webhook ──────────────────────────────────────────────
 *
 * #34 pedía una `base.automation` en Odoo que avisara al middleware. No puede:
 * el middleware no está expuesto a internet (`docs/06-DESPLIEGUE-EASYPANEL.md`),
 * y aunque lo estuviera, el webhook de Odoo 17 no manda cabeceras, así que el
 * secreto compartido tendría que ir en la URL. Además sería configuración nueva
 * en el ERP de producción.
 *
 * En su lugar el middleware pregunta cada minuto qué cambió desde la última vez,
 * por `write_date`. Son seis lecturas por minuto; medido el 2026-09-24, en 24 h
 * cambian 10 reglas de tarifa, 140 partners y 62 productos.
 *
 * ── Qué se vigila y qué se invalida ──────────────────────────────────────────
 *
 *   product.pricelist.item  → los precios de esa tarifa
 *   product.pricelist       → sus precios y su validación (archivada, compañía)
 *   res.partner             → la tarifa y el almacén de ese cliente y sus contactos
 *   product.product/template→ los precios de ese producto, y los «no encontrado»
 *
 * Una regla BORRADA no deja `write_date`. Para eso se cuentan las reglas de cada
 * tarifa en cada vuelta: si el número cambia, se invalida la tarifa.
 *
 * El stock no se vigila: las páginas de inventario caducan a los 60 s, que es
 * lo que tarda el sondeo. Invalidarlas no adelantaría nada.
 *
 * ── El reloj es el de Odoo ───────────────────────────────────────────────────
 *
 * La marca de cada modelo es el `write_date` más alto visto, nunca la hora de
 * esta máquina: son dos relojes y su desfase serían cambios perdidos. Como
 * `write_date` tiene resolución de segundo, se relee el último segundo (`>=`) y
 * se descartan los ids ya vistos en él.
 *
 * La cache sigue en memoria del proceso (decisión de #34, ver #14): esto vale
 * mientras haya una sola instancia. Con dos, cada una tendría que sondear.
 */

/** Cada cuánto se pregunta. `CACHE_SONDEO_SEGUNDOS=0` lo apaga. */
export function intervaloSondeoMs(): number {
  const v = Number(process.env.CACHE_SONDEO_SEGUNDOS ?? 60);
  return Number.isFinite(v) && v >= 0 ? v * 1000 : 60_000;
}

/** Filas por modelo y vuelta. Más que eso de golpe es una importación: se vacía todo. */
export const LOTE_SONDEO = 500;

type Categoria = 'tarifas' | 'productos' | 'clientes';

interface Vigilado {
  modelo: string;
  categoria: Categoria;
  /** Filtro extra. Los archivados también: archivar es un cambio. */
  dominio: OdooDomain;
  campos: string[];
  /** Los ids afectados por una fila. */
  afectados: (fila: Record<string, unknown>) => number[];
}

const m2o = (v: unknown): number[] => (Array.isArray(v) ? [v[0] as number] : []);
const TODOS: OdooDomain = [['active', 'in', [true, false]]];

export const VIGILADOS: Vigilado[] = [
  { modelo: 'product.pricelist.item', categoria: 'tarifas', dominio: [], campos: ['pricelist_id'], afectados: (f) => m2o(f.pricelist_id) },
  { modelo: 'product.pricelist', categoria: 'tarifas', dominio: TODOS, campos: [], afectados: (f) => [f.id as number] },
  { modelo: 'res.partner', categoria: 'clientes', dominio: TODOS, campos: [], afectados: (f) => [f.id as number] },
  { modelo: 'product.product', categoria: 'productos', dominio: TODOS, campos: [], afectados: (f) => [f.id as number] },
  {
    modelo: 'product.template',
    categoria: 'productos',
    dominio: TODOS,
    campos: ['product_variant_ids'],
    afectados: (f) => (f.product_variant_ids as number[] | undefined) ?? [],
  },
];

export interface Invalidadores {
  tarifas: (ids: ReadonlySet<number>) => number;
  productos: (ids: ReadonlySet<number>) => number;
  clientes: (ids: ReadonlySet<number>) => number;
  /** Más de `LOTE_SONDEO` cambios de golpe: no se sabe qué, se vacía la categoría. */
  todo: (categoria: Categoria) => number;
}

export const INVALIDADORES: Invalidadores = {
  tarifas: invalidarPreciosDeTarifas,
  productos: invalidarPreciosDeProductos,
  clientes: (ids) => invalidarTarifasDeClientes(ids) + invalidarAlmacenesDeClientes(ids),
  // Sin ids concretos, un predicado que acepta todo es un vaciado.
  todo: (categoria) => {
    const todos = { has: () => true } as unknown as ReadonlySet<number>;
    return categoria === 'clientes' ? INVALIDADORES.clientes(todos) : INVALIDADORES[categoria](todos);
  },
};

export interface Lecturas {
  searchRead: typeof searchRead;
  readGroup: typeof readGroup;
}

export interface ResumenVuelta {
  /** Filas con cambios, por modelo. */
  cambios: Record<string, number>;
  /** Tarifas con reglas borradas o añadidas según el recuento. */
  tarifasRecontadas: number[];
  entradasInvalidadas: number;
  /** Modelos cuya lectura falló: se reintentan en la siguiente vuelta. */
  fallidos: string[];
}

interface Marca {
  writeDate: string;
  /** Ids ya procesados con ese mismo `writeDate`. */
  vistos: Set<number>;
}

export class VigilanteCambios {
  private readonly marcas = new Map<string, Marca>();
  private recuento: Map<number, number> | null = null;
  private temporizador: NodeJS.Timeout | null = null;
  private enCurso: Promise<ResumenVuelta> | null = null;

  constructor(
    private readonly lecturas: Lecturas = { searchRead, readGroup },
    private readonly invalidar: Invalidadores = INVALIDADORES,
  ) {}

  /**
   * Fija las marcas en el último `write_date` de cada modelo y cuenta las reglas.
   * Lo anterior al arranque no se procesa: la cache arranca vacía.
   */
  async iniciar(): Promise<void> {
    for (const v of VIGILADOS) {
      const [ultima] = await this.lecturas.searchRead<{ id: number; write_date: string }>(v.modelo, v.dominio, ['write_date'], {
        order: 'write_date desc, id desc',
        limit: 1,
      });
      this.marcas.set(v.modelo, { writeDate: ultima?.write_date ?? '1970-01-01 00:00:00', vistos: new Set(ultima ? [ultima.id] : []) });
    }
    this.recuento = await this.contarReglas();
  }

  /** Una vuelta. Si ya hay una en curso, devuelve esa: nunca dos a la vez. */
  vuelta(): Promise<ResumenVuelta> {
    this.enCurso ??= this.hacerVuelta().finally(() => {
      this.enCurso = null;
    });
    return this.enCurso;
  }

  private async hacerVuelta(): Promise<ResumenVuelta> {
    const resumen: ResumenVuelta = { cambios: {}, tarifasRecontadas: [], entradasInvalidadas: 0, fallidos: [] };
    const porCategoria: Record<Categoria, Set<number>> = { tarifas: new Set(), productos: new Set(), clientes: new Set() };
    const vaciar = new Set<Categoria>();

    for (const v of VIGILADOS) {
      const marca = this.marcas.get(v.modelo);
      if (!marca) continue;
      try {
        const filas = await this.lecturas.searchRead<Record<string, unknown> & { id: number; write_date: string }>(
          v.modelo,
          [['write_date', '>=', marca.writeDate], ...v.dominio],
          [...v.campos, 'write_date'],
          { order: 'write_date asc, id asc', limit: LOTE_SONDEO },
        );
        const nuevas = filas.filter((f) => !(f.write_date === marca.writeDate && marca.vistos.has(f.id)));
        if (nuevas.length === 0) continue;

        resumen.cambios[v.modelo] = nuevas.length;
        if (filas.length >= LOTE_SONDEO) vaciar.add(v.categoria);
        for (const f of nuevas) for (const id of v.afectados(f)) porCategoria[v.categoria].add(id);

        const ultima = filas[filas.length - 1].write_date;
        const vistos = ultima === marca.writeDate ? marca.vistos : new Set<number>();
        for (const f of filas) if (f.write_date === ultima) vistos.add(f.id);
        this.marcas.set(v.modelo, { writeDate: ultima, vistos });
      } catch (error) {
        // La marca no se mueve: la siguiente vuelta vuelve a pedir lo mismo.
        resumen.fallidos.push(v.modelo);
        logger.warn({ modelo: v.modelo, err: error instanceof Error ? error.message : String(error) }, 'vigilante: no se pudo leer');
      }
    }

    try {
      const recuento = await this.contarReglas();
      if (this.recuento) {
        for (const id of new Set([...recuento.keys(), ...this.recuento.keys()])) {
          if (recuento.get(id) !== this.recuento.get(id)) {
            resumen.tarifasRecontadas.push(id);
            porCategoria.tarifas.add(id);
          }
        }
      }
      this.recuento = recuento;
    } catch (error) {
      resumen.fallidos.push('product.pricelist.item#recuento');
      logger.warn({ err: error instanceof Error ? error.message : String(error) }, 'vigilante: no se pudieron contar las reglas');
    }

    for (const categoria of ['tarifas', 'productos', 'clientes'] as const) {
      if (vaciar.has(categoria)) resumen.entradasInvalidadas += this.invalidar.todo(categoria);
      else if (porCategoria[categoria].size > 0) resumen.entradasInvalidadas += this.invalidar[categoria](porCategoria[categoria]);
    }

    if (Object.keys(resumen.cambios).length || resumen.tarifasRecontadas.length) {
      logger.info(resumen, 'vigilante: cambios en Odoo, cache invalidada');
    }
    return resumen;
  }

  /** Reglas por tarifa. Delata las borradas, que no dejan `write_date`. */
  private async contarReglas(): Promise<Map<number, number>> {
    const grupos = await this.lecturas.readGroup<{ pricelist_id: [number, string] | false; __count: number }>(
      'product.pricelist.item',
      [],
      ['pricelist_id'],
      ['pricelist_id'],
    );
    return new Map(grupos.filter((g) => g.pricelist_id).map((g) => [(g.pricelist_id as [number, string])[0], g.__count]));
  }

  /** Arranca el sondeo periódico. Un fallo al iniciar se reintenta en la siguiente vuelta. */
  arrancar(intervaloMs = intervaloSondeoMs()): void {
    if (intervaloMs === 0 || this.temporizador) return;
    const tic = async () => {
      try {
        if (!this.recuento) await this.iniciar();
        else await this.vuelta();
      } catch (error) {
        logger.warn({ err: error instanceof Error ? error.message : String(error) }, 'vigilante: vuelta fallida');
      }
    };
    void tic();
    this.temporizador = setInterval(() => void tic(), intervaloMs);
    // No retiene el proceso: el cierre ordenado de `server.ts` no lo espera.
    this.temporizador.unref();
  }

  detener(): void {
    if (this.temporizador) clearInterval(this.temporizador);
    this.temporizador = null;
  }
}
