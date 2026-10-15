import { reenviar } from './reenviar';

/** Busca usuarios internos de Odoo, con su acceso actual. */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get('q') ?? '';
  return reenviar(`/odoo?${new URLSearchParams({ q })}`, { method: 'GET' });
}
