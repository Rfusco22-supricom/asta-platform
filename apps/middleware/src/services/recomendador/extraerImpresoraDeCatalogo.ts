import { marcaDelNombre, type MarcaImpresora } from './extraerImpresoras.js';
import { normalizarModelo } from './normalizar.js';

/**
 * Qué impresora es un producto de la categoría IMPRESORA de Odoo (#40).
 *
 * Es el otro lado de `extraerImpresoras`. Aquel lee las impresoras que menciona
 * el nombre de un TÓNER («… LaserJet P3010/3015d»); este lee el nombre de la
 * propia impresora que Supricom vende:
 *
 *   CANON IMPRESORA IMAGECLASS MF264DW MULTIFUNCION        → Canon · imageCLASS MF264DW
 *   CANON MF465DW II - IMPRESORA LASER, MULTIFUNCIONAL     → Canon · MF465DW II
 *   HP IMPRESORA COLOR LASERJET PRO MFP 4303FDW            → HP · Color LaserJet Pro MFP 4303FDW
 *   IMPRESORA HP MULTIFUNCIONAL SMART TANK 580 W           → HP · Smart Tank 580
 *   BROTHER IMPRESORA PRINTER MONOCROMATICA 2750DW …       → Brother · HL-L2750DW (de la referencia)
 *
 * ── Qué se descarta ──────────────────────────────────────────────────────────
 *
 * La categoría no es solo de impresoras. De las 178 de hoy:
 *
 *   · accesorios: escáneres, bandejas, alimentadores, placas de red, una
 *     etiquetadora y hasta un tóner mal clasificado («BROTHER TN227 - TONER»);
 *   · SAT: impresoras térmicas y de etiquetas, que no llevan tóner. El kiosco
 *     pregunta «¿qué tóner necesita tu impresora?»; encontrarlas solo serviría
 *     para mandar al mostrador a quien busca papel;
 *   · lo que no dice la marca, o la dice y no es una que sepamos leer.
 *
 * ── El nombre que se guarda ──────────────────────────────────────────────────
 *
 * La familia, si el nombre la dice, más el modelo: «Smart Tank 580», no «580».
 * Del resto del nombre —«IMPRESORA», «MULTIFUNCIONAL», «110V», «OPEN BOX»—
 * no se guarda nada. La `clave` es lo que identifica el modelo aunque cambie la
 * familia: «PIXMA G4110» y «IMPRESORA G4110» son la misma impresora, y sin la
 * clave entrarían dos.
 */

export interface ImpresoraDeCatalogo {
  marca: MarcaImpresora;
  /** "imageCLASS MF264DW": como se guardará en `printer_models.name`. */
  nombre: string;
  nombreNormalizado: string;
  /**
   * El modelo sin la familia, normalizado: "mf264dw". Si el modelo son solo
   * cifras ("Smart Tank 580") no identifica nada por sí mismo, y la clave es el
   * nombre entero.
   */
  clave: string;
}

export type MotivoDescarte = 'no_es_impresora' | 'sin_marca' | 'sin_modelo';

/** Lo que dice el nombre que no es una impresora. `ESCANER` solo si tampoco dice IMPRESORA: «IMPRESORA Y ESCANER» sí lo es. */
function noEsImpresora(nombre: string): boolean {
  const n = nombre.toUpperCase();
  if (/\bESCANER\b|\bSCANNER\b/.test(n) && !/\bIMPRESORA\b/.test(n)) return true;
  return /\bBANDEJA\b|\bTRAY\b|\bFEEDING\b|\bLAN BOARD\b|\bETIQUETADORA\b|\s-\s*TONER\b/.test(n);
}

/**
 * La familia, como la escribe el fabricante. Solo estas palabras se conservan
 * delante del modelo; todo lo demás es descripción.
 */
const FAMILIA: Record<string, string> = {
  LASERJET: 'LaserJet',
  // Errata real del catálogo: «IMPRESORA HP LASERTJET MFP M236sdw».
  LASERTJET: 'LaserJet',
  COLOR: 'Color',
  PRO: 'Pro',
  MFP: 'MFP',
  SMART: 'Smart',
  TANK: 'Tank',
  DESKJET: 'DeskJet',
  INK: 'Ink',
  ADVANTAGE: 'Advantage',
  DESIGNJET: 'DesignJet',
  ECOTANK: 'EcoTank',
  // Errata real: «IMPRESORA EPSON ECOTAND L3210».
  ECOTAND: 'EcoTank',
  WORKFORCE: 'WorkForce',
  SURECOLOR: 'SureColor',
  PIXMA: 'PIXMA',
  MAXIFY: 'MAXIFY',
  IMAGECLASS: 'imageCLASS',
  IMAGERUNNER: 'imageRUNNER',
  IPROGRAF: 'imagePROGRAF',
  SELPHY: 'SELPHY',
};

/** Las palabras que nombran la marca, para saltarlas al buscar el modelo. */
const PALABRAS_DE_MARCA = new Set(['HP', 'HEWLETT', 'PACKARD', 'CANON', 'CANO', 'EPSON', 'BROTHER', 'SAMSUNG', 'XEROX']);

/** Lo que lleva cifras y no es el modelo: voltajes, pulgadas, conectores. */
const NO_ES_MODELO = /^(\d+(-\d+)?V|\d+(IN|MM|PP|"|´´)|RJ\d+|A\d)$/;

/**
 * Un código que puede ser un modelo: letras y cifras, con algún guion dentro.
 * Las cifras solas también («2875», «580»): HP numera así sus Smart Tank.
 */
const PARECE_MODELO = /^[A-Z]{0,4}-?[A-Z]?\d{2,5}[A-Z]{0,5}$|^[A-Z]{1,3}-\d{2,4}[A-Z]?$/;

/** Familias de Brother, que se escriben pegadas al modelo con guion: «HL-L2350DW». */
const BROTHER = /^(HL|MFC|DCP)-?([A-Z]?\d{3,4}[A-Z]{0,3})$/;

function limpiarPalabra(p: string): string {
  return p.replace(/^[("'/]+|[.,;:)"'/]+$/g, '');
}

/**
 * @param referencia `default_code` del producto. Solo se usa con Brother, cuyos
 *   nombres se comen la familia («2750DW» por «HL-L2750DW») pero cuya referencia
 *   suele traerla entera.
 */
export function extraerImpresoraDeCatalogo(
  nombreProducto: string,
  referencia: string | null,
): { ok: true; impresora: ImpresoraDeCatalogo } | { ok: false; motivo: MotivoDescarte } {
  if (noEsImpresora(nombreProducto)) return { ok: false, motivo: 'no_es_impresora' };
  const marca = marcaDelNombre(nombreProducto);
  if (!marca) return { ok: false, motivo: 'sin_marca' };

  // Lo que va antes de la descripción: «CANON MF465DW II - IMPRESORA LASER…».
  // El guion tiene que tocar un espacio: el de «DCP-T530DW» es del modelo.
  const cabeza = nombreProducto.toUpperCase().split(/\s+-\s*|\s*-\s+|,/)[0] ?? '';
  const palabras = cabeza.split(/\s+/).map(limpiarPalabra).filter(Boolean);

  const familia: string[] = [];
  let modelo: string | null = null;
  for (let i = 0; i < palabras.length; i++) {
    const p = palabras[i]!;
    if (PALABRAS_DE_MARCA.has(p)) continue;
    // «IMAGE CLASS», separado, es la misma familia.
    if (p === 'IMAGE' && palabras[i + 1] === 'CLASS') {
      familia.push('imageCLASS');
      i++;
      continue;
    }
    // La X de «imageCLASS X MF1238» es parte de la familia.
    if (p === 'X' && familia.at(-1) === 'imageCLASS') {
      familia.push('X');
      continue;
    }
    if (FAMILIA[p]) {
      if (!familia.includes(FAMILIA[p]!)) familia.push(FAMILIA[p]!);
      continue;
    }
    if (!/\d/.test(p) || NO_ES_MODELO.test(p) || !PARECE_MODELO.test(p)) continue;

    // Un prefijo corto suelto delante: «DX 529IF», «IR 1643IF».
    const anterior = palabras[i - 1];
    const prefijo = anterior && /^[A-Z]{2,3}$/.test(anterior) && !PALABRAS_DE_MARCA.has(anterior) && !FAMILIA[anterior] ? `${anterior} ` : '';
    // «MF465DW II», «1643I II»: la generación es parte del modelo.
    const sufijo = palabras[i + 1] === 'II' ? ' II' : '';
    modelo = `${prefijo}${p}${sufijo}`;
    break;
  }

  if (marca === 'Brother') {
    const deReferencia = referencia?.toUpperCase().replace(/-(EX|OB|CL|\d)$/, '').replace(/-/g, '');
    const candidato = deReferencia && BROTHER.test(deReferencia) ? deReferencia : modelo?.replace(/-/g, '');
    const m = candidato?.match(BROTHER);
    if (m) {
      modelo = `${m[1]}-${m[2]}`;
      familia.length = 0;
    }
  }

  if (!modelo) return { ok: false, motivo: 'sin_modelo' };

  const nombre = [...familia, modelo].join(' ');
  const soloCifras = /^\d+( II)?$/.test(modelo);
  return {
    ok: true,
    impresora: {
      marca,
      nombre,
      nombreNormalizado: normalizarModelo(nombre),
      clave: normalizarModelo(soloCifras ? nombre : modelo),
    },
  };
}
