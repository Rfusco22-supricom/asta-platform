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

export type Rol = 'SUPERADMIN' | 'VENDEDOR' | 'BRONCE' | 'PLATA' | 'GOLD';

export interface Seccion {
  href: string;
  titulo: string;
  /** Glifo del menú. Ver la nota de `Icono` en `NavLateral`. */
  icono: string;
  /** Marca activa también las rutas hijas: /cartera/123 resalta «Cartera». */
  prefijo?: boolean;
}

export interface GrupoNav {
  /** null = sin encabezado, para el bloque principal. */
  titulo: string | null;
  secciones: Seccion[];
}

const MI_CUENTA: GrupoNav = {
  titulo: 'Mi cuenta',
  secciones: [{ href: '/cuenta/sesiones', titulo: 'Sesiones activas', icono: 'sesiones' }],
};

const POR_ROL: Record<Rol, GrupoNav[]> = {
  SUPERADMIN: [
    {
      titulo: null,
      secciones: [
        { href: '/admin', titulo: 'Resumen', icono: 'resumen' },
        { href: '/admin/agentes', titulo: 'Vendedores', icono: 'agentes' },
        { href: '/admin/reportes', titulo: 'Reportes', icono: 'reportes' },
        { href: '/admin/asta', titulo: 'Marca ASTA', icono: 'marca' },
        { href: '/admin/usuarios', titulo: 'Usuarios', icono: 'usuarios' },
      ],
    },
    MI_CUENTA,
  ],

  VENDEDOR: [
    {
      titulo: null,
      secciones: [
        {
          href: '/cartera',
          titulo: 'Mi cartera',
          icono: 'cartera',
          prefijo: true,
        },
        { href: '/asta', titulo: 'Oportunidades ASTA', icono: 'marca' },
        { href: '/reportes', titulo: 'Reportes', icono: 'reportes' },
      ],
    },
    MI_CUENTA,
  ],

  BRONCE: [
    {
      titulo: null,
      secciones: [{ href: '/cuenta/api-keys', titulo: 'Mis API keys', icono: 'llave' }],
    },
    MI_CUENTA,
  ],
  get PLATA() {
    return this.BRONCE;
  },
  get GOLD() {
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
