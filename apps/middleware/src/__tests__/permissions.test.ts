import { describe, expect, it } from 'vitest';
import {
  MATRIZ,
  TODAS_LAS_ACCIONES,
  accionesDe,
  ambitoDe,
  appRoleSchema,
  isClientRole,
  isStaffRole,
  puede,
  type Accion,
  type AppRole,
} from '@asta/shared-types';

/**
 * Issue #18 — la matriz de permisos, comprobada entera.
 *
 * No se prueban "algunos casos": se recorren los 5 roles × todas las acciones y
 * se contrasta cada celda contra una tabla escrita a mano aquí.
 *
 * Esa duplicación es DELIBERADA. Si el test derivara lo esperado de la propia
 * matriz, comprobaría que un objeto es igual a sí mismo y pasaría siempre. Al
 * escribir la expectativa aparte, cambiar un permiso obliga a tocar dos sitios
 * —y el segundo es este, donde alguien tiene que mirar la línea y decir "sí,
 * quiero que los clientes vean esto".
 */

const ROLES = appRoleSchema.options;

/** Lo que DEBE poder cada rol. Escrito a mano, no derivado de MATRIZ. */
const ESPERADO: Record<AppRole, Accion[]> = {
  SUPERADMIN: [
    'cliente.ver',
    'cliente.perfil.ver',
    'cliente.notas.escribir',
    'admin.sync.ejecutar',
    'admin.sync.estado.ver',
    'admin.usuarios.gestionar',
    'admin.reconciliacion.ver',
    'admin.agentes.ver',
    'admin.asta.ver',
    'admin.reportes.ver',
    'catalogo.leer',
  ],
  VENDEDOR: [
    'asta.propias.ver',
    'reportes.propios.ver',
    'cartera.ver',
    'cliente.ver',
    'cliente.perfil.ver',
    'cliente.notas.escribir',
    'catalogo.leer',
  ],
  BRONCE: ['apikeys.propias.gestionar', 'catalogo.leer', 'precios.propios.leer', 'facturas.propias.leer'],
  PLATA: ['apikeys.propias.gestionar', 'catalogo.leer', 'precios.propios.leer', 'facturas.propias.leer'],
  GOLD: ['apikeys.propias.gestionar', 'catalogo.leer', 'precios.propios.leer', 'facturas.propias.leer'],
};

describe('#18 · La matriz completa, celda a celda', () => {
  for (const role of ROLES) {
    for (const accion of TODAS_LAS_ACCIONES) {
      const deberia = ESPERADO[role].includes(accion);
      it(`${role} ${deberia ? 'SÍ' : 'NO'} puede → ${accion}`, () => {
        expect(puede(role, accion)).toBe(deberia);
      });
    }
  }
});

describe('#18 · Invariantes de la matriz', () => {
  it('toda acción declara al menos un rol', () => {
    // Una acción sin roles no la puede hacer nadie: o sobra, o es un olvido.
    for (const a of TODAS_LAS_ACCIONES) {
      expect(MATRIZ[a].roles.length, `${a} no tiene roles`).toBeGreaterThan(0);
    }
  });

  it('toda acción declara ámbito y descripción', () => {
    for (const a of TODAS_LAS_ACCIONES) {
      expect(['ninguno', 'partner-propio', 'identidad']).toContain(MATRIZ[a].ambito);
      expect(MATRIZ[a].descripcion.length, `${a} sin descripción`).toBeGreaterThan(10);
    }
  });

  it('ningún rol declarado es inválido', () => {
    for (const a of TODAS_LAS_ACCIONES) {
      for (const r of MATRIZ[a].roles) {
        expect(ROLES, `${a} declara el rol desconocido ${r}`).toContain(r);
      }
    }
  });

  it('accionesDe coincide con puede()', () => {
    for (const role of ROLES) {
      expect(accionesDe(role).sort()).toEqual(
        TODAS_LAS_ACCIONES.filter((a) => puede(role, a)).sort(),
      );
    }
  });

  it('los tres niveles de cliente tienen EXACTAMENTE los mismos permisos', () => {
    // Bronce, Plata y Gold se distinguen para resolver la TARIFA, no para dar
    // permisos distintos. Si algún día divergen, es un cambio de modelo y debe
    // discutirse — no colarse en un commit.
    const [b, p, g] = [accionesDe('BRONCE'), accionesDe('PLATA'), accionesDe('GOLD')];
    expect(p).toEqual(b);
    expect(g).toEqual(b);
  });

  it('ninguna acción de cliente permite ver datos de otro sin ámbito', () => {
    // La regla que evita la fuga: si un rol de cliente puede hacer algo, ese
    // algo tiene que estar acotado a lo suyo. Una acción de cliente con ámbito
    // 'ninguno' sería acceso global.
    for (const a of TODAS_LAS_ACCIONES) {
      const soloClientes = MATRIZ[a].roles.every(isClientRole);
      if (!soloClientes) continue;
      expect(ambitoDe(a), `${a} es de clientes pero no acota el ámbito`).not.toBe('ninguno');
    }
  });

  it('toda acción sobre un cliente concreto exige ámbito partner-propio', () => {
    // Si una acción nombra un cliente, tiene que comprobar de quién es. Este
    // test es el que caza un endpoint nuevo al que se le olvidó el ámbito.
    for (const a of TODAS_LAS_ACCIONES) {
      if (!a.startsWith('cliente.')) continue;
      expect(ambitoDe(a), `${a} toca un cliente sin comprobar pertenencia`).toBe(
        'partner-propio',
      );
    }
  });

  it('solo el staff administra', () => {
    for (const a of TODAS_LAS_ACCIONES) {
      if (!a.startsWith('admin.')) continue;
      for (const r of MATRIZ[a].roles) {
        expect(isStaffRole(r), `${a} se la concede a ${r}`).toBe(true);
      }
    }
  });

  it('SUPERADMIN no tiene cartera propia', () => {
    // No es un olvido: la cartera son "mis clientes" y un administrador no
    // tiene. Devolverle una lista vacía parecería un bug.
    expect(puede('SUPERADMIN', 'cartera.ver')).toBe(false);
  });

  it('los vendedores no gestionan API keys', () => {
    // Las keys son para que un CLIENTE integre su sistema. Un vendedor que
    // necesite datos los tiene en el panel.
    expect(puede('VENDEDOR', 'apikeys.propias.gestionar')).toBe(false);
    expect(puede('SUPERADMIN', 'apikeys.propias.gestionar')).toBe(false);
  });
});

describe('#18 · Helpers de rol', () => {
  it('isClientRole distingue clientes de staff', () => {
    expect(ROLES.filter(isClientRole)).toEqual(['BRONCE', 'PLATA', 'GOLD']);
  });

  it('isStaffRole es exactamente el complemento', () => {
    for (const r of ROLES) {
      expect(isStaffRole(r)).toBe(!isClientRole(r));
    }
  });
});
