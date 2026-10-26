/**
 * Odoo no respondió, pero la revisión sigue (#127).
 *
 * Revisar es trabajo de MySQL: de Odoo solo llegan el importe vendido, que
 * ordena la lista, y el nombre de los productos. Se dice arriba, una vez, para
 * que nadie lea el orden como «lo más vendido» ni un producto sin nombre como
 * uno que ya no existe.
 */
export function AvisoOdoo({ cobertura = false }: { cobertura?: boolean }) {
  return (
    <div className="notice" style={{ marginBottom: 18 }}>
      <h2>Odoo no responde</h2>
      <p>Se puede seguir revisando: la lista sale sin ordenar por ventas{cobertura ? ' y sin cobertura' : ''}.</p>
    </div>
  );
}
