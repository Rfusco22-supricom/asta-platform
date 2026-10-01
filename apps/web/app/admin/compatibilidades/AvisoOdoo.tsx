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
      <h2>Odoo no responde: se puede seguir revisando</h2>
      <p>
        Las compatibilidades están en nuestra base y las decisiones se guardan con normalidad. Lo que falta mientras tanto viene de Odoo:
        la lista no está ordenada por ventas, algunos productos salen sin nombre
        {cobertura ? ' y la cobertura del top no se puede calcular, porque sin ventas no hay top' : ''}.
      </p>
    </div>
  );
}
