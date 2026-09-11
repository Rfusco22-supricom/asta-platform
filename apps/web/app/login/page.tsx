import { redirect } from 'next/navigation';
import { z } from 'zod';
import { setSession } from '@/lib/session';

/**
 * Login PROVISIONAL.
 *
 * No hay contraseña porque todavía no existe: la autenticación propia es la
 * Fase 2 (#51 login con Argon2id, #52 JWT) y depende de MySQL.
 *
 * Se elige un vendedor de una lista que sirve el middleware. Cuando esté el
 * login real, esta página pasa a ser un formulario de email y contraseña, y
 * `lib/session.ts` guarda el JWT en vez de un id — el resto del panel no se
 * entera.
 */

const MIDDLEWARE_URL = process.env.MIDDLEWARE_URL ?? 'http://localhost:3001';

const vendedoresSchema = z.object({
  data: z.array(
    z.object({
      id: z.number().int().positive(),
      nombre: z.string(),
      clientes: z.number().int().nonnegative(),
    }),
  ),
});

type Vendedor = z.infer<typeof vendedoresSchema>['data'][number];

async function getVendedores(): Promise<{ lista: Vendedor[]; error: string | null }> {
  try {
    const res = await fetch(`${MIDDLEWARE_URL}/api/v1/salesperson/_dev/vendedores`, {
      cache: 'no-store',
    });
    if (!res.ok) {
      return {
        lista: [],
        error:
          res.status === 404
            ? 'El middleware está corriendo sin DEV_AUTH_ENABLED=true.'
            : `El middleware devolvió ${res.status}.`,
      };
    }
    const parsed = vendedoresSchema.safeParse(await res.json());
    if (!parsed.success) return { lista: [], error: 'Respuesta inesperada del middleware.' };
    return { lista: parsed.data.data, error: null };
  } catch {
    return { lista: [], error: 'No se pudo contactar con el middleware.' };
  }
}

export default async function LoginPage() {
  const { lista, error } = await getVendedores();

  async function entrar(formData: FormData) {
    'use server';
    const valor = String(formData.get('vendedor') ?? '');
    const [idRaw, ...resto] = valor.split('|');
    const id = Number(idRaw);
    if (!Number.isInteger(id) || id <= 0) return;
    await setSession({ odooUserId: id, nombre: resto.join('|') || `Usuario ${id}` });
    redirect('/cartera');
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <h1>ASTA · Panel de vendedores</h1>
        <p>Cartera y facturación, en vivo desde Odoo.</p>

        {error ? (
          <div className="notice error">
            <h2>No se pudo cargar la lista de vendedores</h2>
            <p>{error}</p>
            <p style={{ marginTop: 10 }}>
              Arranca el middleware con <code>pnpm dev:middleware</code> y recarga.
            </p>
          </div>
        ) : (
          <form action={entrar}>
            <div className="field">
              <label htmlFor="vendedor">Entrar como</label>
              <select id="vendedor" name="vendedor" className="select" required defaultValue="">
                <option value="" disabled>
                  Elige un vendedor…
                </option>
                {lista.map((v) => (
                  <option key={v.id} value={`${v.id}|${v.nombre}`}>
                    {v.nombre} · {v.clientes} clientes
                  </option>
                ))}
              </select>
              <div className="hint">{lista.length} vendedores con cartera en Odoo.</div>
            </div>

            <button type="submit" className="btn">
              Entrar
            </button>
          </form>
        )}

        <p style={{ marginTop: 20, marginBottom: 0, fontSize: 12.5, color: 'var(--text-3)' }}>
          Acceso sin contraseña. La autenticación real son los issues #51 y #52.
        </p>
      </div>
    </div>
  );
}
