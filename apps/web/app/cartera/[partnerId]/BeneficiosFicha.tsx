import { getProgramaDeCliente, esRedireccion } from '@/lib/api';
import { Beneficios } from '@/components/Beneficios';

/**
 * Los beneficios del cliente en la ficha: los de su nivel del programa y los
 * que suma si sube, para que el vendedor sepa qué le toca y qué ofrecerle. Va
 * en su propio `Suspense`: el programa lee las compras de todos los clientes y
 * la primera vez tarda.
 */
export async function BeneficiosFicha({ token, partnerId }: { token: string; partnerId: number }) {
  let programa;
  try {
    programa = await getProgramaDeCliente(token, partnerId);
  } catch (error) {
    if (esRedireccion(error)) throw error;
    // Sin programa, la ficha sigue: es una ayuda, no un dato del cliente.
    return null;
  }
  return <Beneficios nivel={programa.evaluacion.nivel} para="vendedor" />;
}
