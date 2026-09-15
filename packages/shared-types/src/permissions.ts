import { z } from 'zod';
import type { AppRole } from './identity.js';

/**
 * Matriz de permisos: quién puede hacer qué.
 *
 * ── Por qué una matriz y no `if`s en cada controlador ────────────────────────
 *
 * Antes esto vivía repartido. El patrón
 *
 *     if (role !== 'SUPERADMIN') {
 *       if (role !== 'VENDEDOR') denegar();
 *       await assertSalespersonOwnsPartner(...);
 *     }
 *
 * aparecía tres veces copiado a mano. Ese es justo el sitio donde un día
 * alguien escribe la primera mitad y se olvida de la segunda, y el endpoint
 * nuevo deja ver la cartera de todos.
 *
 * ── Las DOS preguntas ────────────────────────────────────────────────────────
 *
 * Autorizar aquí son dos cosas distintas, y confundirlas es el error clásico:
 *
 *   1. ¿Puede este ROL hacer esta acción?  -> estática, la responde `roles`
 *   2. ¿Es SUYO este recurso concreto?     -> dinámica, hay que ir a Odoo
 *
 * Una matriz que solo contestara la primera invitaría a creer que con eso basta.
 * Por eso cada acción declara TAMBIÉN su `ambito`, y el middleware que la aplica
 * se encarga de las dos. Añadir un endpoint es declarar su acción; no hay forma
 * de conceder el rol y olvidar el ámbito, porque van juntos en la misma línea.
 *
 * Vive en `shared-types` para que el panel pueda ocultar lo que el usuario no
 * puede usar SIN duplicar las reglas. Ocultar un botón no es seguridad —quien
 * mande el request igual pasa por aquí— pero enseñar botones que dan 403 es una
 * forma barata de que la gente deje de confiar en la herramienta.
 */

export const accionSchema = z.enum([
  // ── Panel de vendedores ───────────────────────────────────────────────────
  'cartera.ver',
  'cliente.ver',
  'cliente.perfil.ver',
  'cliente.notas.escribir',

  // ── Administración ────────────────────────────────────────────────────────
  'admin.sync.ejecutar',
  'admin.sync.estado.ver',
  'admin.usuarios.gestionar',
  'admin.reconciliacion.ver',
  'admin.agentes.ver',

  // ── API pública del cliente ───────────────────────────────────────────────
  'apikeys.propias.gestionar',
  'catalogo.leer',
  'precios.propios.leer',
  'facturas.propias.leer',
]);

export type Accion = z.infer<typeof accionSchema>;

/**
 * Qué comprobación de pertenencia exige una acción, además del rol.
 *
 * · `ninguno`        — con el rol basta.
 * · `partner-propio` — el :partnerId debe estar en la cartera de quien pide.
 *                      SUPERADMIN se lo salta.
 * · `identidad`      — solo sobre sus propios datos (sus API keys, sus facturas).
 */
export type Ambito = 'ninguno' | 'partner-propio' | 'identidad';

export interface Regla {
  roles: readonly AppRole[];
  ambito: Ambito;
  descripcion: string;
}

const CLIENTES: readonly AppRole[] = ['BRONCE', 'PLATA', 'GOLD'];
const STAFF: readonly AppRole[] = ['SUPERADMIN', 'VENDEDOR'];

export const MATRIZ: Readonly<Record<Accion, Regla>> = {
  'cartera.ver': {
    // SUPERADMIN NO está: la cartera es "mis clientes", y un administrador no
    // tiene cartera propia. Dejarle entrar devolvería una lista vacía y
    // parecería un bug. Para verlo todo hará falta un endpoint distinto.
    roles: ['VENDEDOR'],
    ambito: 'ninguno',
    descripcion: 'Ver la cartera de clientes asignada',
  },
  'cliente.ver': {
    roles: STAFF,
    ambito: 'partner-propio',
    descripcion: 'Ver la facturación de un cliente',
  },
  'cliente.perfil.ver': {
    roles: STAFF,
    ambito: 'partner-propio',
    descripcion: 'Ver recencia y top de productos de un cliente',
  },
  'cliente.notas.escribir': {
    roles: STAFF,
    ambito: 'partner-propio',
    descripcion: 'Escribir notas sobre un cliente',
  },

  'admin.sync.ejecutar': {
    roles: ['SUPERADMIN'],
    ambito: 'ninguno',
    descripcion: 'Lanzar una sincronización con Odoo',
  },
  'admin.sync.estado.ver': {
    roles: ['SUPERADMIN'],
    ambito: 'ninguno',
    descripcion: 'Consultar el estado de la sincronización',
  },
  'admin.usuarios.gestionar': {
    roles: ['SUPERADMIN'],
    ambito: 'ninguno',
    descripcion: 'Crear, invitar y desactivar usuarios',
  },
  'admin.agentes.ver': {
    // Solo el SUPERADMIN. Un vendedor NO ve las cifras de los demás: la cartera
    // de cada uno es suya, y una tabla comparativa dentro del panel convierte
    // una herramienta de trabajo en un tablón de resultados.
    roles: ['SUPERADMIN'],
    ambito: 'ninguno',
    descripcion: 'Ver las estadísticas de los agentes de venta',
  },
  'admin.reconciliacion.ver': {
    roles: ['SUPERADMIN'],
    ambito: 'ninguno',
    descripcion: 'Ver el informe de reconciliación con Odoo',
  },

  'apikeys.propias.gestionar': {
    // Los vendedores NO: las API keys son para que un cliente integre su
    // sistema. Un vendedor que necesite datos los tiene en el panel.
    roles: CLIENTES,
    ambito: 'identidad',
    descripcion: 'Crear y revocar las propias API keys',
  },
  'catalogo.leer': {
    roles: [...CLIENTES, ...STAFF],
    ambito: 'ninguno',
    descripcion: 'Consultar catálogo y existencias',
  },
  'precios.propios.leer': {
    roles: CLIENTES,
    ambito: 'identidad',
    descripcion: 'Consultar los precios de la propia tarifa',
  },
  'facturas.propias.leer': {
    roles: CLIENTES,
    ambito: 'identidad',
    descripcion: 'Consultar las propias facturas',
  },
};

export const TODAS_LAS_ACCIONES = Object.keys(MATRIZ) as Accion[];

/** ¿Puede este rol, por sí solo, realizar esta acción? */
export function puede(role: AppRole, accion: Accion): boolean {
  return MATRIZ[accion].roles.includes(role);
}

/** Qué comprobación extra hay que hacer sobre el recurso concreto. */
export function ambitoDe(accion: Accion): Ambito {
  return MATRIZ[accion].ambito;
}

/**
 * Acciones que un rol puede realizar. Lo usa el panel para decidir qué enseñar.
 *
 * Que una acción salga aquí NO significa que el request vaya a pasar: falta la
 * comprobación de ámbito, que depende del recurso y solo puede hacerse en el
 * servidor.
 */
export function accionesDe(role: AppRole): Accion[] {
  return TODAS_LAS_ACCIONES.filter((a) => puede(role, a));
}
