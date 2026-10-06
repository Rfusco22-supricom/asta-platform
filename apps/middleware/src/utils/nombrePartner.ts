/**
 * El nombre de un cliente de Odoo, siempre como texto.
 *
 * Odoo devuelve `false` en un campo vacío, también en `res.partner.name`: hay
 * fichas sin nombre (la 137384, por ejemplo). Tratar el nombre como texto sin
 * mirar —`p.name.trim()`— tumbaba el alta de ese cliente en el sync, que desde
 * el 1 de octubre lo daba como «fallido» en cada pasada completa, y habría
 * tumbado igual la reconciliación, la ficha del cliente o los duplicados.
 *
 * Sin nombre, «Cliente #id»: la cuenta sale en el panel y se reconoce, y se
 * corrige en Odoo.
 */
export function nombrePartner(p: { id: number; name: string | false | null | undefined }): string {
  const n = typeof p.name === 'string' ? p.name.trim() : '';
  return n || `Cliente #${p.id}`;
}
