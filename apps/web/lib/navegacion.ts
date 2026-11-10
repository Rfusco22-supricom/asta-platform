/**
 * Qué secciones ve cada rol, y en qué orden.
 *
 * ── Un solo sitio ────────────────────────────────────────────────────────────
 *
 * El enrutado por rol ya estuvo duplicado una vez —en la raíz y en el login, con
 * el comentario «mismo criterio que la raíz» al lado de la copia— y el resultado
 * fue que un cliente aterrizaba en un 403 al entrar. Por eso `destinoPara()` sale
 * de AQUÍ: es la primera sección de su menú, no una lista aparte que hay que
 * acordarse de actualizar.
 *
 * ── No se listan secciones que no existen ────────────────────────────────────
 *
 * Tentación evidente al montar un menú: dejar puestos «Agentes», «Reportes» y
 * demás en gris, para que se vea a dónde va la cosa. No. Un menú con la mitad de
 * las entradas muertas enseña a no fiarse del menú, y el primer clic en una que
 * no hace nada ya gastó la confianza. Entran cuando existen.
 */

export type Rol = 'SUPERADMIN' | 'VENDEDOR' | 'BRONCE' | 'PLATA' | 'GOLD' | 'DIAMANTE' | 'GENERAL';

export interface Seccion {
  href: string;
  titulo: string;
  /** Glifo del menú. Ver la nota de `Icono` en `NavLateral`. */
  icono: string;
  /** Marca activa también las rutas hijas: /cartera/123 resalta «Cartera». */
  prefijo?: boolean;
  /**
   * Otras páginas de la misma sección, que se abren con pestañas: «ASTA» son
   * /admin/asta y /admin/categorias. Encienden esta entrada del menú.
   */
  tambien?: string[];
  /**
   * El nombre en la barra de pestañas de abajo, en pantallas estrechas
   * (`NavInferior`): allí caben unos diez caracteres por pestaña. Sin él, el
   * título.
   */
  corto?: string;
}

export interface GrupoNav {
  /** null = sin encabezado, para el bloque principal. */
  titulo: string | null;
  secciones: Seccion[];
  /** Se pliega y despliega con su título; abierto si una de sus secciones está activa. */
  desplegable?: boolean;
}

const POR_ROL: Record<Rol, GrupoNav[]> = {
  // Reorganizado el 2026-11-10: una entrada por tarea, sin pantallas que se
  // repitan. Pendientes pasó al Inicio («Necesita tu atención»), Reportes es
  // Ventas, y el panel de un cliente se abre desde su ficha («Ver su panel»).
  SUPERADMIN: [
    {
      titulo: null,
      secciones: [
        { href: '/admin', titulo: 'Inicio', icono: 'resumen' },
        { href: '/admin/reportes', titulo: 'Ventas', icono: 'reportes' },
        { href: '/admin/asta', titulo: 'Clientes', icono: 'cartera', tambien: ['/cuenta/metricas', '/cuenta/sellout', '/cuenta/pedido', '/cuenta/facturas', '/cuenta/flyers', '/cuenta/calculadora'] },
        { href: '/admin/agentes', titulo: 'Vendedores', icono: 'agentes', prefijo: true },
        { href: '/admin/cotizaciones', titulo: 'Cotizaciones y pedidos', icono: 'cotizaciones', corto: 'Cotiza', prefijo: true },
      ],
    },
    {
      titulo: 'Programa ASTA',
      secciones: [
        { href: '/admin/categorias', titulo: 'Niveles y trimestre', icono: 'categorias', corto: 'Niveles' },
        { href: '/admin/sellout', titulo: 'Sell-out', icono: 'facturas' },
      ],
    },
    {
      titulo: 'Catálogo y aplicación',
      secciones: [
        { href: '/admin/compatibilidades', titulo: 'Compatibilidades', icono: 'compatibilidades', prefijo: true, corto: 'Compatibles' },
        { href: '/admin/recomendador', titulo: 'Búsquedas y demanda', icono: 'recomendador', corto: 'Búsquedas', tambien: ['/admin/demanda'] },
        { href: '/admin/kioscos', titulo: 'Tablets', icono: 'tablet' },
      ],
    },
    {
      titulo: 'Configuración',
      secciones: [
        { href: '/admin/accesos', titulo: 'Personas y accesos', icono: 'usuarios', corto: 'Personas', tambien: ['/admin/usuarios'] },
        { href: '/admin/calidad', titulo: 'Datos de Odoo', icono: 'calidad', corto: 'Odoo', tambien: ['/admin/duplicados'] },
      ],
    },
  ],

  VENDEDOR: [
    {
      titulo: null,
      secciones: [
        // Reorganizado el 2026-11-10. «Hoy» junta el Inicio con Impulsa
        // (sigue abierto desde sus tareas); «Mis ventas», los reportes y sus
        // clientes en ASTA; «Programa ASTA», los niveles de su cartera.
        { href: '/inicio', titulo: 'Hoy', icono: 'resumen', tambien: ['/impulsa'] },
        { href: '/cartera', titulo: 'Mi cartera', icono: 'cartera', prefijo: true, corto: 'Cartera' },
        { href: '/cotizaciones', titulo: 'Cotizaciones y pedidos', icono: 'cotizaciones', corto: 'Cotiza', prefijo: true },
        { href: '/reportes', titulo: 'Mis ventas', icono: 'reportes', prefijo: true, corto: 'Ventas', tambien: ['/asta'] },
        { href: '/categorias', titulo: 'Programa ASTA', icono: 'categorias', corto: 'Programa' },
      ],
    },
    {
      titulo: 'Más',
      secciones: [{ href: '/compatibilidades', titulo: 'Proponer compatibilidad', icono: 'compatibilidades', corto: 'Compatibles' }],
    },
  ],

  BRONCE: [
    {
      titulo: null,
      secciones: [
        // Lo primero que ve un cliente al entrar.
        { href: '/cuenta/metricas', titulo: 'Mis métricas', icono: 'resumen', corto: 'Métricas' },
        { href: '/cuenta/sellout', titulo: 'Mi sell-out', icono: 'reportes', corto: 'Sell-out' },
        { href: '/cuenta/pedido', titulo: 'Pedido sugerido', icono: 'cotizaciones', corto: 'Pedido' },
        { href: '/cuenta/facturas', titulo: 'Mis facturas', icono: 'facturas', corto: 'Facturas' },
        { href: '/cuenta/flyers', titulo: 'Mis flyers', icono: 'flyers', corto: 'Flyers' },
        { href: '/cuenta/calculadora', titulo: 'Calculadora', icono: 'calculadora', corto: 'Calcula' },
        { href: '/cuenta/tablets', titulo: 'Mis tablets', icono: 'tablet', corto: 'Tablets' },
        { href: '/cuenta/api-keys', titulo: 'Mis API keys', icono: 'llave', corto: 'API keys' },
      ],
    },
  ],
  get PLATA() {
    return this.BRONCE;
  },
  get GOLD() {
    return this.BRONCE;
  },
  get DIAMANTE() {
    return this.BRONCE;
  },
  get GENERAL() {
    return this.BRONCE;
  },
};

export function navegacionDe(rol: string): GrupoNav[] {
  return POR_ROL[rol as Rol] ?? POR_ROL.BRONCE;
}

/**
 * A dónde pertenece cada rol: la primera sección de su menú.
 *
 * Derivado en vez de escrito aparte, para que no puedan discrepar. Si un rol
 * pierde su primera sección, lo que falla es esto y no una pantalla al azar.
 */
export function destinoPara(rol: string): string {
  return navegacionDe(rol)[0]?.secciones[0]?.href ?? '/login';
}

/** Cómo se llama el sitio donde está, para la cabecera. */
export function ambitoDe(rol: string): string {
  if (rol === 'SUPERADMIN') return 'Administración';
  if (rol === 'VENDEDOR') return 'Ventas';
  return 'Mi cuenta';
}

/**
 * Las pantallas del cliente que el administrador recorre al mirar su panel
 * («Ver su panel» en la ficha): salen como pestañas en el aviso de arriba
 * (`BannerVista`). Tablets y API keys no: son de la cuenta, no del negocio.
 */
export const PANTALLAS_VISTA_CLIENTE: Array<{ href: string; titulo: string }> = [
  { href: '/cuenta/metricas', titulo: 'Métricas' },
  { href: '/cuenta/sellout', titulo: 'Sell-out' },
  { href: '/cuenta/pedido', titulo: 'Pedido sugerido' },
  { href: '/cuenta/facturas', titulo: 'Facturas' },
  { href: '/cuenta/flyers', titulo: 'Flyers' },
  { href: '/cuenta/calculadora', titulo: 'Calculadora' },
];
