import type { AppRole } from '@asta/shared-types';
import { prisma } from '../config/prisma.js';
import { searchRead } from '../odoo/client.js';
import { recordAudit } from './audit.service.js';

/**
 * Propagar las bajas de Odoo al panel (issue #89).
 *
 * ── El agujero que cierra ────────────────────────────────────────────────────
 *
 * `isActive` se comprueba en las seis puertas del sistema —login, renovación de
 * sesión, cada petición del panel, cada llamada con API key, los enlaces
 * firmados de #32 y las invitaciones— y no lo ponía a `false` NADIE. La palanca
 * estaba bien puesta en todas partes y no la accionaba nada.
 *
 * Consecuencia: a quien se iba de la empresa y desactivaban en Odoo, su cuenta
 * del panel le seguía funcionando indefinidamente. Y su cartera se lee en vivo
 * del ERP —`getPartnersBySalesperson` filtra por el partner activo, no por el
 * usuario— así que seguía viendo todo lo que continuara asignado a él. Cuando se
 * escribió esto había tres personas inactivas en Odoo con 124 clientes todavía
 * asignados.
 *
 * ── Qué señal desactiva, y cuál NO ───────────────────────────────────────────
 *
 * Esto parece contradecir la decisión de `vendedores.service.ts`, que se niega a
 * retirar accesos. No la contradice: lo que cambia es la CLASE de señal.
 *
 *   · «Su cartera no tiene facturación» es una condición DERIVADA. Un cierre
 *     contable, una cartera reasignada por una tarde o un fallo de Odoo la
 *     vuelven falsa, y el equipo comercial entero se queda fuera sin que nadie
 *     haya decidido nada. Por eso aquel sync informa y no toca.
 *
 *   · «Su usuario está inactivo en Odoo» es un ACTO HUMANO explícito: alguien
 *     entró al ERP y lo desactivó. Propagarlo no inventa una decisión, ejecuta
 *     la que ya se tomó.
 *
 * ── La regla que no se puede saltar ──────────────────────────────────────────
 *
 * **Se desactiva solo cuando se ha LEÍDO `active = false`. Nunca por ausencia en
 * un resultado.**
 *
 * Si un lote viene corto, si cambia un dominio o si la llamada falla a medias,
 * «no apareció en la respuesta» se parece muchísimo a «está de baja» — y esa
 * confusión deja fuera a todo el mundo a la vez. Lo que no viene se apunta en
 * `sinRespuesta` y no se toca.
 *
 * Es justo el fallo que tiene `marcarHuerfanos`, que deduce por ausencia: por
 * eso sigue marcando `ORPHANED` —informativo, para la reconciliación— y no
 * desactiva nada.
 */

export interface CuentaViva {
  id: string;
  email: string;
  fullName: string;
  role: AppRole;
  odooPartnerId: number;
  odooUserId: number | null;
}

export type MotivoBaja = 'USUARIO_INACTIVO_EN_ODOO' | 'PARTNER_ARCHIVADO_EN_ODOO';

export interface Baja {
  id: string;
  email: string;
  nombre: string;
  role: AppRole;
  motivo: MotivoBaja;
  detalle: string;
}

export interface SinRespuesta {
  email: string;
  nombre: string;
  detalle: string;
}

export interface DecisionBajas {
  bajas: Baja[];
  sinRespuesta: SinRespuesta[];
  /** Protegidos por regla, no por los datos: hoy solo los SUPERADMIN. */
  protegidos: Baja[];
  /** Si no es null, NO se aplica nada: la pasada se pasó del tope. */
  abortado: string | null;
}

/**
 * Cuántas bajas de golpe dejan de parecer bajas y empiezan a parecer un fallo.
 *
 * Un 2 % con suelo de 10: en una instalación de 2.300 cuentas son 46, más que
 * cualquier salida real de personal, y en una de 20 sigue permitiendo vaciar
 * media plantilla si de verdad se fue.
 *
 * Que el tope PARE la pasada entera y no solo recorte la lista es deliberado:
 * si la señal está mal, desactivar «solo los primeros 46» es igual de malo y
 * además deja el trabajo a medias.
 */
export function topeDeBajas(revisadas: number): number {
  return Math.max(10, Math.ceil(revisadas * 0.02));
}

/**
 * Decide a quién se desactiva.
 *
 * PURA a propósito: es la función que puede dejar sin acceso al equipo entero,
 * y eso tiene que poder probarse sin Odoo ni base de datos delante.
 *
 * Los mapas llevan SOLO lo que Odoo devolvió de verdad. Que a un id le falte la
 * entrada significa «no lo sé», nunca «está de baja».
 */
export function decidirBajas(
  cuentas: CuentaViva[],
  usuariosOdoo: Map<number, boolean>,
  partnersOdoo: Map<number, boolean>,
): DecisionBajas {
  const bajas: Baja[] = [];
  const sinRespuesta: SinRespuesta[] = [];
  const protegidos: Baja[] = [];

  for (const c of cuentas) {
    const base = { id: c.id, email: c.email, nombre: c.fullName, role: c.role };

    let baja: Baja | null = null;

    // El usuario de Odoo manda sobre el partner: para el personal, la baja se
    // hace desactivando SU USUARIO, y ese es el acto que hay que propagar.
    if (c.odooUserId !== null) {
      const activo = usuariosOdoo.get(c.odooUserId);
      if (activo === false) {
        baja = {
          ...base,
          motivo: 'USUARIO_INACTIVO_EN_ODOO',
          detalle: `res.users ${c.odooUserId} está inactivo`,
        };
      } else if (activo === undefined) {
        sinRespuesta.push({
          email: c.email,
          nombre: c.fullName,
          detalle: `Odoo no devolvió res.users ${c.odooUserId}`,
        });
        continue;
      }
    }

    if (!baja) {
      const activo = partnersOdoo.get(c.odooPartnerId);
      if (activo === false) {
        baja = {
          ...base,
          motivo: 'PARTNER_ARCHIVADO_EN_ODOO',
          detalle: `res.partner ${c.odooPartnerId} está archivado`,
        };
      } else if (activo === undefined) {
        sinRespuesta.push({
          email: c.email,
          nombre: c.fullName,
          detalle: `Odoo no devolvió res.partner ${c.odooPartnerId}`,
        });
        continue;
      }
    }

    if (!baja) continue;

    /*
     * Un SUPERADMIN no se desactiva solo.
     *
     * Es la cuenta con la que se arregla todo lo demás —incluido reactivar a
     * quien esta pasada desactive por error—. Dejar que un cambio en Odoo la
     * apague significa que el día que salga mal no queda por dónde entrar a
     * arreglarlo. Se informa y lo hace una persona.
     */
    if (c.role === 'SUPERADMIN') {
      protegidos.push(baja);
      continue;
    }

    bajas.push(baja);
  }

  const tope = topeDeBajas(cuentas.length);
  const abortado =
    bajas.length > tope
      ? `${bajas.length} bajas de ${cuentas.length} cuentas superan el tope de ${tope}: no se aplica nada.`
      : null;

  return { bajas, sinRespuesta, protegidos, abortado };
}

export interface ResumenBajas extends DecisionBajas {
  revisadas: number;
  desactivadas: number;
  simulacro: boolean;
  duracionMs: number;
}

/** Lee de Odoo el `active` de una lista de ids, por lotes. */
async function leerActivos(modelo: string, ids: number[]): Promise<Map<number, boolean>> {
  const mapa = new Map<number, boolean>();
  const LOTE = 500;

  for (let i = 0; i < ids.length; i += LOTE) {
    /*
     * El `|` sobre `active` no sobra: Odoo añade `active = true` por su cuenta a
     * todo dominio que no mencione ese campo. Sin esto, los inactivos —que son
     * justo los que se buscan— no vendrían nunca, y todos caerían en
     * `sinRespuesta`.
     */
    const filas = await searchRead<{ id: number; active: boolean }>(
      modelo,
      ['|', ['active', '=', true], ['active', '=', false], ['id', 'in', ids.slice(i, i + LOTE)]],
      ['id', 'active'],
    );
    for (const f of filas) mapa.set(f.id, f.active);
  }

  return mapa;
}

/**
 * Propaga al panel las bajas hechas en Odoo.
 *
 * Por defecto es un SIMULACRO: dice a quién desactivaría y no toca nada. Hay que
 * pedir `aplicar: true`, igual que el alta de vendedores — y por lo mismo, que
 * aquí el error tampoco se ve: la cuenta simplemente deja de entrar, y quien la
 * usaba cree que se le olvidó la contraseña.
 *
 * NO reactiva a nadie. Volver a dar acceso sigue siendo un acto humano.
 */
export async function desactivarBajas(
  opciones: { aplicar?: boolean } = {},
): Promise<ResumenBajas> {
  const t0 = Date.now();
  const aplicar = opciones.aplicar === true;

  const cuentas = await prisma.appUser.findMany({
    where: { isActive: true },
    select: {
      id: true,
      email: true,
      fullName: true,
      role: true,
      odooPartnerId: true,
      odooUserId: true,
    },
  });

  const vacio: ResumenBajas = {
    revisadas: cuentas.length,
    bajas: [],
    sinRespuesta: [],
    protegidos: [],
    abortado: null,
    desactivadas: 0,
    simulacro: !aplicar,
    duracionMs: Date.now() - t0,
  };
  if (cuentas.length === 0) return vacio;

  const usuariosOdoo = await leerActivos(
    'res.users',
    [...new Set(cuentas.map((c) => c.odooUserId).filter((x): x is number => x !== null))],
  );
  const partnersOdoo = await leerActivos(
    'res.partner',
    [...new Set(cuentas.map((c) => c.odooPartnerId))],
  );

  const decision = decidirBajas(cuentas, usuariosOdoo, partnersOdoo);

  const resumen: ResumenBajas = {
    ...decision,
    revisadas: cuentas.length,
    desactivadas: 0,
    simulacro: !aplicar,
    duracionMs: 0,
  };

  if (aplicar && decision.abortado === null) {
    for (const b of decision.bajas) {
      await prisma.appUser.update({
        where: { id: b.id },
        data: {
          isActive: false,
          syncError: `Desactivada por #89: ${b.detalle}`,
          syncedAt: new Date(),
        },
      });

      // Quitar un acceso es tan auditable como concederlo. Queda con el motivo
      // y con el dato de Odoo que lo justificó, para poder rehacerlo al revés
      // si un día se desactiva a quien no tocaba.
      recordAudit({
        action: 'user.desactivado',
        actorId: null,
        actorOdooUserId: null,
        targetType: 'AppUser',
        targetId: b.id,
        ip: null,
        metadata: { email: b.email, role: b.role, motivo: b.motivo, detalle: b.detalle },
      });

      resumen.desactivadas++;
    }
  }

  resumen.duracionMs = Date.now() - t0;
  return resumen;
}
