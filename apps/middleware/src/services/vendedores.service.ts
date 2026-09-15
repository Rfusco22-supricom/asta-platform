import type { AppRole } from '@asta/shared-types';
import { prisma } from '../config/prisma.js';
import { searchRead, readGroup } from '../odoo/client.js';
import { normalizarEmail, esEmailPlausible } from '../auth/email.js';
import { recordAudit } from './audit.service.js';

/**
 * Alta de cuentas de VENDEDOR desde Odoo (issue #81).
 *
 * ── Por qué hace falta ───────────────────────────────────────────────────────
 *
 * `sync.service.ts` crea CLIENTES. Nunca creó vendedores: su función `rolDe`
 * tenía un parámetro `esStaff` que ninguna llamada ponía a `true`, así que el
 * panel de vendedores se desplegó en producción sin una sola cuenta capaz de
 * abrirlo. Los dos vendedores de desarrollo venían de `seed-dev.ts`, que ni
 * siquiera entra en la imagen.
 *
 * Va en un fichero aparte porque es otro trabajo: aquel lee `res.partner` y este
 * lee `res.users`. Mezclarlos habría hecho que una pasada de clientes pudiera
 * conceder acceso a facturación, que es justo lo que no debe poder pasar por
 * accidente.
 *
 * ── La regla, decidida con el área comercial ─────────────────────────────────
 *
 * Es vendedor quien cumple las TRES:
 *
 *   1. Aparece como `user_id` de al menos un cliente activo de primer nivel.
 *   2. Su usuario de Odoo está activo.
 *   3. Esa cartera tiene facturación real.
 *
 * Se descartó la regla que parecía más precisa —el patrón del login,
 * `ventasNN@`— porque los datos dijeron otra cosa: dejaba fuera a la persona con
 * la cartera MÁS GRANDE de la empresa (260 clientes, 2,5 M facturados) solo
 * porque su correo es `amarquez@` y no `ventas02@`. El patrón describe cómo se
 * crearon las cuentas, no quién vende.
 *
 * La condición de facturación es la que separa a un vendedor de quien tiene un
 * par de clientes pegados por arrastre de datos: `servtecnico@`, `contabilidad@`
 * y `azampetti@` tienen entre 1 y 3 clientes asignados y CERO facturas. Darles
 * el panel sería darles acceso a facturación por accidente.
 *
 * ── Lo que NO hace, a propósito ──────────────────────────────────────────────
 *
 * No retira el acceso a nadie. Si un VENDEDOR de la base deja de cumplir la
 * regla, se informa y no se toca.
 *
 * Revocar por una condición de datos es demasiado peligroso: un fallo de Odoo,
 * una cartera reasignada por una tarde o un cierre contable que deje un mes sin
 * facturas dejaría al equipo comercial entero fuera del panel sin que nadie
 * hubiera decidido nada. Quitar un acceso es una decisión humana.
 */

export interface CandidatoVendedor {
  odooUserId: number;
  nombre: string;
  login: string;
  activo: boolean;
  clientes: number;
  monto: number;
  odooPartnerId: number | null;
}

export type MotivoDescarte =
  | 'INACTIVO_EN_ODOO'
  | 'SIN_FACTURACION'
  | 'LOGIN_NO_ES_EMAIL'
  | 'SIN_PARTNER'
  | 'EMAIL_DE_OTRA_CUENTA'
  | 'PARTNER_DE_OTRA_CUENTA'
  | 'FALLIDO';

export interface Descarte {
  odooUserId: number;
  nombre: string;
  login: string;
  motivo: MotivoDescarte;
  detalle?: string;
}

export interface ResumenVendedores {
  candidatos: number;
  aprobados: number;
  /**
   * Quiénes son, con los números que justifican cada alta.
   *
   * Va en el resumen y no solo en el log porque en el simulacro ESTA es la
   * lista que alguien tiene que leer antes de conceder acceso a facturación.
   */
  lista: CandidatoVendedor[];
  /** Cuentas nuevas: el vendedor no estaba en `app_users`. */
  creados: number;
  /** Ya estaba como CLIENTE y se le sube a VENDEDOR. Es el caso mayoritario. */
  promovidos: number;
  actualizados: number;
  sinCambios: number;
  descartados: Descarte[];
  /**
   * Cosas que hay que mirar aunque no impidan el alta — un correo del panel
   * distinto del de Odoo, una cuenta desactivada. Sin esto se conceden accesos
   * que luego no funcionan y nadie sabe por qué.
   */
  avisos: Array<{ nombre: string; texto: string }>;
  /**
   * De los que tienen acceso, quiénes NO pueden entrar todavía porque no tienen
   * contraseña.
   *
   * Se consulta en vez de suponerse. Lo intuitivo sería avisar solo de las
   * cuentas nuevas, pero los promocionados vienen de `sincronizarPartners`, que
   * tampoco crea credenciales: casi ninguno de los 21 podría entrar. Un alta que
   * deja a la persona fuera sin decirlo es peor que no hacerla.
   */
  sinContrasena: string[];
  /** VENDEDOR ya en la base que hoy no cumpliría la regla. Se informa, no se toca. */
  yaNoCumplen: Array<{
    email: string;
    nombre: string;
    odooUserId: number | null;
  }>;
  simulacro: boolean;
  duracionMs: number;
}

/**
 * Aplica la regla a candidatos ya medidos.
 *
 * PURA a propósito: es la decisión de quién ve la facturación de una cartera, y
 * eso tiene que poder probarse sin Odoo ni base de datos delante.
 */
export function aprobarVendedores(candidatos: CandidatoVendedor[]): {
  aprobados: CandidatoVendedor[];
  descartados: Descarte[];
} {
  const aprobados: CandidatoVendedor[] = [];
  const descartados: Descarte[] = [];

  for (const c of candidatos) {
    const fuera = (motivo: MotivoDescarte, detalle?: string) =>
      descartados.push({
        odooUserId: c.odooUserId,
        nombre: c.nombre,
        login: c.login,
        motivo,
        detalle,
      });

    if (!c.activo) {
      fuera('INACTIVO_EN_ODOO');
      continue;
    }

    if (c.monto <= 0) {
      fuera('SIN_FACTURACION', `${c.clientes} clientes asignados, 0 facturado`);
      continue;
    }

    // El login de Odoo suele ser el correo, pero no tiene por qué: puede ser un
    // nombre de usuario suelto. Sin correo no hay forma de entrar al panel.
    if (!esEmailPlausible(c.login)) {
      fuera('LOGIN_NO_ES_EMAIL', c.login);
      continue;
    }

    if (c.odooPartnerId === null) {
      fuera('SIN_PARTNER');
      continue;
    }

    aprobados.push(c);
  }

  return { aprobados, descartados };
}

interface UsuarioOdoo {
  id: number;
  name: string;
  login: string;
  active: boolean;
  partner_id: [number, string] | false;
}

/**
 * Mide los candidatos contra Odoo.
 *
 * Unas pocas RPC en total, no una por vendedor: con 28 candidatos, preguntar la
 * facturación de cada uno por separado son 28 llamadas de ~1 s contra el ERP de
 * producción.
 */
export async function medirCandidatos(): Promise<CandidatoVendedor[]> {
  const partners = await searchRead<{
    id: number;
    user_id: [number, string] | false;
  }>(
    'res.partner',
    [
      ['customer_rank', '>', 0],
      ['user_id', '!=', false],
      ['parent_id', '=', false],
      ['active', '=', true],
    ],
    ['id', 'user_id'],
  );

  const porUsuario = new Map<number, { nombre: string; partners: number[] }>();
  for (const p of partners) {
    if (!p.user_id) continue;
    const [uid, nombre] = p.user_id;
    if (!porUsuario.has(uid)) porUsuario.set(uid, { nombre, partners: [] });
    porUsuario.get(uid)!.partners.push(p.id);
  }

  if (porUsuario.size === 0) return [];

  const todos = [...porUsuario.values()].flatMap((v) => v.partners);
  const montoPorPartner = new Map<number, number>();

  /*
   * Por lotes de 250, no de una vez.
   *
   * La primera versión mandaba los 2.629 ids en un solo `in` y Odoo se pasaba
   * del timeout de 30 s. El coste no crece con el número de ids, crece MUCHO más
   * deprisa — medido contra la instancia real:
   *
   *      250 ids ->   0,6 s
   *      500 ids ->   1,7 s
   *    1.000 ids ->   6,3 s
   *    2.629 ids -> timeout
   *
   * Cuadruplicar el lote multiplica el tiempo por diez. Con 250 el total son
   * once llamadas de medio segundo: unos 7 s, frente a un fallo.
   */
  const LOTE = 250;
  for (let i = 0; i < todos.length; i += LOTE) {
    const grupos = await readGroup<{
      commercial_partner_id: [number, string] | false;
      amount_total_signed: number;
    }>(
      'account.move',
      [
        ['move_type', '=', 'out_invoice'],
        ['state', '=', 'posted'],
        ['commercial_partner_id', 'in', todos.slice(i, i + LOTE)],
      ],
      ['amount_total_signed:sum'],
      ['commercial_partner_id'],
    );

    for (const g of grupos) {
      if (!g.commercial_partner_id) continue;
      montoPorPartner.set(g.commercial_partner_id[0], g.amount_total_signed ?? 0);
    }
  }

  // Se piden también los INACTIVOS: aparecen en el informe con su motivo de
  // descarte, que es más útil que desaparecer sin explicación.
  const usuarios = await searchRead<UsuarioOdoo>(
    'res.users',
    ['|', ['active', '=', true], ['active', '=', false], ['id', 'in', [...porUsuario.keys()]]],
    ['id', 'name', 'login', 'active', 'partner_id'],
  );
  const info = new Map(usuarios.map((u) => [u.id, u]));

  return [...porUsuario.entries()]
    .map(([uid, v]) => {
      const u = info.get(uid);
      return {
        odooUserId: uid,
        nombre: u?.name ?? v.nombre,
        login: u?.login ?? '',
        activo: u?.active ?? false,
        clientes: v.partners.length,
        monto: v.partners.reduce((s, id) => s + (montoPorPartner.get(id) ?? 0), 0),
        odooPartnerId: u?.partner_id ? u.partner_id[0] : null,
      };
    })
    .sort((a, b) => b.monto - a.monto);
}

/**
 * Crea, promociona y actualiza las cuentas de vendedor.
 *
 * Por defecto es un SIMULACRO: dice qué haría y no toca nada. Hay que pedir
 * `aplicar: true` de forma explícita, porque esto concede acceso a la
 * facturación de una cartera entera y el modo seguro de algo así es el que no
 * hace nada.
 *
 * ── Quién es quién: `res.users.partner_id`, NO el correo ─────────────────────
 *
 * Casi ningún vendedor hay que crearlo: ya está en `app_users` como CLIENTE.
 * `sincronizarPartners` los metió a todos, porque el partner personal de un
 * vendedor suele tener `customer_rank > 0` —le compran a la empresa— y desde
 * fuera no se distingue de cualquier otro cliente. De los 21 aprobados, 12 ya
 * tenían ficha.
 *
 * La primera versión de esto las trataba todas como choques y descartaba a los
 * 12, entre ellos la cartera más grande de la empresa. Al mirar los datos de
 * verdad, no eran choques: eran ELLOS.
 *
 * La identidad la da `res.users.partner_id`. Es el vínculo que pone el propio
 * Odoo entre una persona y su ficha, y `odoo_partner_id` es inmutable en esta
 * base. Si la fila es la de ese partner, es esa persona: se le sube el rol.
 *
 * El correo NO sirve de identidad, y los datos lo demuestran:
 *
 *   · MARIANGELY CISNEROS entra con `supriccs6@supricom.com.ve` y en su ficha de
 *     Odoo el correo es `supriccs6@gmail.com.ve`. Mismo partner, misma persona,
 *     correos distintos.
 *   · `bladimir.vasquez@supricom.com.ve` lo tiene la ficha de SUPRICOM CCS 21,
 *     C.A. — una EMPRESA con 258 pedidos que usa su correo para facturación.
 *     Promocionar por correo habría convertido la cuenta de un cliente en la de
 *     un vendedor.
 *
 * ── El correo NO se toca al promocionar ──────────────────────────────────────
 *
 * Aunque el login de Odoo sea el corporativo y en el panel figure otro. La
 * columna `email` de una fila con partner la mantiene `sincronizarPartners` a
 * partir de `res.partner.email`: si aquí se pusiera el login, la siguiente
 * pasada de clientes lo revertiría y esa persona dejaría de poder entrar con lo
 * que se le dijo, sin que nada fallara a la vista.
 *
 * Cuando los dos correos no coinciden se emite un AVISO con los dos, para que se
 * arregle en Odoo, que es donde manda el dato.
 *
 * ── Lo que NO hace ───────────────────────────────────────────────────────────
 *
 * No retira el acceso a nadie: ver la nota de la cabecera del fichero.
 */
export async function sincronizarVendedores(
  opciones: { aplicar?: boolean } = {},
): Promise<ResumenVendedores> {
  const t0 = Date.now();
  const aplicar = opciones.aplicar === true;

  const candidatos = await medirCandidatos();
  const { aprobados, descartados } = aprobarVendedores(candidatos);

  const resumen: ResumenVendedores = {
    candidatos: candidatos.length,
    aprobados: aprobados.length,
    lista: [],
    creados: 0,
    promovidos: 0,
    actualizados: 0,
    sinCambios: 0,
    descartados,
    avisos: [],
    sinContrasena: [],
    yaNoCumplen: [],
    simulacro: !aplicar,
    duracionMs: 0,
  };

  for (const c of aprobados) {
    const partnerId = c.odooPartnerId!;
    const login = normalizarEmail(c.login);

    /*
     * Un candidato que falla NO puede tumbar la pasada.
     *
     * Ya pasó: un choque de clave única a mitad del recorrido dejó a la
     * mitad del equipo comercial con acceso y a la otra mitad sin él, y el
     * proceso salió con error sin decir por dónde se había quedado.
     *
     * Mismo criterio que `sincronizarPartners`: se anota la fila mala y se
     * sigue. La operación es idempotente, así que arreglado el dato en Odoo,
     * la siguiente pasada la recoge.
     */
    // Fuera del `try`: el `catch` también descarta.
    const descartar = (motivo: MotivoDescarte, detalle: string) => {
      resumen.descartados.push({
        odooUserId: c.odooUserId,
        nombre: c.nombre,
        login: c.login,
        motivo,
        detalle,
      });
      resumen.aprobados--;
    };

    try {
      /*
       * ── `odoo_user_id` también es ÚNICO ───────────────────────────────────
       *
       * Antes esto solo se comprobaba al crear, y la pasada entera se cayó a la
       * mitad —con la mitad de los vendedores ya escritos— contra
       * `uq_app_users_odoo_user`: una fila de OTRO partner ya llevaba ese
       * `res.users`, y el camino de promoción escribía sin mirar.
       *
       * Va aquí arriba, antes de decidir si se crea o se promociona, porque los
       * dos caminos escriben esa columna.
       */
      const porOdooUser = await prisma.appUser.findUnique({
        where: { odooUserId: c.odooUserId },
        select: { odooPartnerId: true, email: true },
      });
      if (porOdooUser && porOdooUser.odooPartnerId !== partnerId) {
        descartar(
          'PARTNER_DE_OTRA_CUENTA',
          `el usuario de Odoo ${c.odooUserId} ya está en la ficha del partner ${porOdooUser.odooPartnerId} (${porOdooUser.email})`,
        );
        continue;
      }

      const existente = await prisma.appUser.findUnique({
        where: { odooPartnerId: partnerId },
        select: {
          id: true,
          email: true,
          role: true,
          odooUserId: true,
          isActive: true,
        },
      });

      // ── Ya tiene ficha: es él, se le sube el rol ────────────────────────────
      if (existente) {
        /*
         * Salvo que esa ficha ya esté atada a OTRO usuario de Odoo. Eso no debería
         * pasar —un partner tiene un solo `res.users`— y si pasa es que los datos
         * están mal. Reasignarlo en silencio le daría la cartera de uno al otro.
         */
        if (existente.odooUserId !== null && existente.odooUserId !== c.odooUserId) {
          descartar(
            'PARTNER_DE_OTRA_CUENTA',
            `el partner ${partnerId} ya está atado al usuario de Odoo ${existente.odooUserId}`,
          );
          continue;
        }

        resumen.lista.push(c);

        // Un SUPERADMIN no se degrada a VENDEDOR porque Odoo le vea una cartera.
        const rol: AppRole = existente.role === 'SUPERADMIN' ? 'SUPERADMIN' : 'VENDEDOR';

        if (existente.email !== login) {
          resumen.avisos.push({
            nombre: c.nombre,
            texto: `entra al panel como ${existente.email}, pero su usuario de Odoo es ${login}. El correo del panel sale de su ficha de cliente; si no es el bueno, se cambia en Odoo.`,
          });
        }

        if (!existente.isActive) {
          resumen.avisos.push({
            nombre: c.nombre,
            texto:
              'su cuenta está DESACTIVADA en el panel, y desde aquí no se reactiva. Si debe entrar, actívala a mano.',
          });
        }

        if (existente.role === rol && existente.odooUserId === c.odooUserId) {
          resumen.sinCambios++;
          continue;
        }

        if (aplicar) {
          await prisma.appUser.update({
            where: { id: existente.id },
            data: { role: rol, odooUserId: c.odooUserId, syncedAt: new Date() },
          });

          recordAudit({
            action: 'sync.vendedores',
            actorId: null,
            actorOdooUserId: null,
            targetType: 'AppUser',
            targetId: existente.id,
            ip: null,
            metadata: {
              cambio: 'promocion',
              rolAnterior: existente.role,
              rolNuevo: rol,
              odooUserId: c.odooUserId,
              odooPartnerId: partnerId,
              clientes: c.clientes,
              monto: c.monto,
            },
          });
        }

        if (existente.role !== rol) resumen.promovidos++;
        else resumen.actualizados++;
        continue;
      }

      // ── No tiene ficha: hay que crearla ─────────────────────────────────────
      /*
       * Aquí sí importa el correo, porque es la columna que se va a escribir y es
       * ÚNICA. Si ya lo tiene otra fila —de otro partner— no se le quita: sería
       * darle la cuenta de un cliente a un vendedor.
       *
       * Los dos casos reales son distintos y los dos se arreglan en Odoo, no aquí:
       *
       *   · Aaron Jaramillo y Susana Hernandez tienen DOS fichas cada uno, la de
       *     vendedor y la de cliente, con el mismo correo. Es un duplicado de los
       *     de #50 y hay que fusionarlo allí.
       *   · Bladimir Vasquez comparte correo con la ficha de una empresa cliente.
       *     Ahí lo que sobra es el correo en la ficha de la empresa.
       */
      const porEmail = await prisma.appUser.findUnique({
        where: { email: login },
        select: { odooPartnerId: true, fullName: true },
      });
      if (porEmail) {
        descartar(
          'EMAIL_DE_OTRA_CUENTA',
          `${login} ya lo usa el partner ${porEmail.odooPartnerId} (${porEmail.fullName.slice(0, 30)})`,
        );
        continue;
      }

      resumen.lista.push(c);

      if (aplicar) {
        const creado = await prisma.appUser.create({
          data: {
            email: login,
            fullName: c.nombre.trim(),
            role: 'VENDEDOR',
            odooPartnerId: partnerId,
            odooUserId: c.odooUserId,
            isActive: true,
            syncStatus: 'SYNCED',
            syncedAt: new Date(),
          },
          select: { id: true },
        });

        recordAudit({
          action: 'sync.vendedores',
          actorId: null,
          actorOdooUserId: null,
          targetType: 'AppUser',
          targetId: creado.id,
          ip: null,
          metadata: {
            cambio: 'alta',
            email: login,
            odooUserId: c.odooUserId,
            odooPartnerId: partnerId,
            clientes: c.clientes,
            monto: c.monto,
          },
        });
      }

      resumen.creados++;
    } catch (error) {
      // Sale de `lista`: se anunció como "tendría acceso" y no lo tiene.
      const i = resumen.lista.indexOf(c);
      if (i >= 0) resumen.lista.splice(i, 1);
      descartar('FALLIDO', error instanceof Error ? error.message.slice(0, 140) : 'desconocido');
    }
  }

  /*
   * ── Quién no puede entrar todavía ─────────────────────────────────────────
   *
   * En simulacro las cuentas nuevas aún no existen, así que solo se puede mirar
   * a los que ya tienen ficha. No pasa nada: son la mayoría, y las nuevas se dan
   * por descontado — nacen sin contraseña siempre.
   */
  const conFicha = await prisma.appUser.findMany({
    where: { odooUserId: { in: resumen.lista.map((a) => a.odooUserId) } },
    select: { email: true, credentials: { select: { userId: true } } },
  });
  for (const u of conFicha) {
    if (!u.credentials) resumen.sinContrasena.push(u.email);
  }

  // ── Quién tiene acceso hoy y ya no cumpliría ──────────────────────────────
  const conAcceso = new Set(resumen.lista.map((a) => a.odooUserId));
  const enBase = await prisma.appUser.findMany({
    where: { role: 'VENDEDOR' },
    select: { email: true, fullName: true, odooUserId: true },
  });

  for (const v of enBase) {
    if (v.odooUserId === null || !conAcceso.has(v.odooUserId)) {
      resumen.yaNoCumplen.push({
        email: v.email,
        nombre: v.fullName,
        odooUserId: v.odooUserId,
      });
    }
  }

  resumen.duracionMs = Date.now() - t0;
  return resumen;
}
