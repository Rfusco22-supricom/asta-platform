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
}

const MI_CUENTA: GrupoNav = {
  titulo: 'Mi cuenta',
  secciones: [{ href: '/cuenta/sesiones', titulo: 'Sesiones activas', icono: 'sesiones', corto: 'Sesiones' }],
};

const POR_ROL: Record<Rol, GrupoNav[]> = {
  SUPERADMIN: [
    {
      titulo: null,
      secciones: [
        { href: '/admin', titulo: 'Inicio', icono: 'resumen' },
        { href: '/admin/pendientes', titulo: 'Pendientes', icono: 'pendientes' },
        { href: '/admin/agentes', titulo: 'Vendedores', icono: 'agentes' },
        // Reportes no está en el menú: el Inicio ya lo resume, y su «Ver el
        // reporte completo» lleva al detalle.
        { href: '/admin/asta', titulo: 'ASTA', icono: 'marca', tambien: ['/admin/categorias'] },
      ],
    },
    {
      titulo: 'Aplicación ASTA',
      secciones: [
        { href: '/admin/compatibilidades', titulo: 'Compatibilidades', icono: 'compatibilidades', prefijo: true },
        { href: '/admin/recomendador', titulo: 'Recomendador', icono: 'recomendador' },
        { href: '/admin/kioscos', titulo: 'Tablets', icono: 'tablet' },
      ],
    },
    {
      titulo: 'Administración',
      secciones: [
        { href: '/admin/calidad', titulo: 'Datos de Odoo', icono: 'calidad', corto: 'Odoo', tambien: ['/admin/duplicados'] },
        { href: '/admin/accesos', titulo: 'Personas', icono: 'usuarios', tambien: ['/admin/usuarios'] },
      ],
    },
    MI_CUENTA,
  ],

  VENDEDOR: [
    {
      titulo: null,
      secciones: [
        // Lo primero que abre el vendedor: cómo va su cartera y qué hacer hoy.
        { href: '/inicio', titulo: 'Inicio', icono: 'resumen' },
        { href: '/impulsa', titulo: 'Impulsa a tus clientes', icono: 'impulsa', corto: 'Impulsa' },
        {
          href: '/cartera',
          titulo: 'Mi cartera',
          icono: 'cartera',
          prefijo: true,
          corto: 'Cartera',
        },
        { href: '/asta', titulo: 'ASTA', icono: 'marca', tambien: ['/categorias'] },
        // Reportes, como en administración: se llega desde el Inicio.
        { href: '/compatibilidades', titulo: 'Compatibilidades', icono: 'compatibilidades', corto: 'Compatibles' },
      ],
    },
    MI_CUENTA,
  ],

  BRONCE: [
    {
      titulo: null,
      secciones: [
        { href: '/cuenta/api-keys', titulo: 'Mis API keys', icono: 'llave', corto: 'API keys' },
        { href: '/cuenta/tablets', titulo: 'Mis tablets', icono: 'tablet', corto: 'Tablets' },
      ],
    },
    MI_CUENTA,
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
  return navegacionDe(rol)[0]?.secciones[0]?.href ?? '/cuenta/sesiones';
}

/** Cómo se llama el sitio donde está, para la cabecera. */
export function ambitoDe(rol: string): string {
  if (rol === 'SUPERADMIN') return 'Administración';
  if (rol === 'VENDEDOR') return 'Ventas';
  return 'Mi cuenta';
}
