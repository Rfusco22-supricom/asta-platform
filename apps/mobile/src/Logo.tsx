import { Image } from 'react-native';

/**
 * El logo de Asta, recortado a sus letras (`assets/asta-logo.png`, sacado del
 * de `apps/web`). `tintColor` lo pinta del color que toque: blanco sobre el
 * azul de la atracción, azul en la barra de la consulta.
 */
const PROPORCION = 1000 / 404;

export function Logo({ ancho, color }: { ancho: number; color: string }) {
  return (
    <Image
      source={require('../assets/asta-logo.png')}
      style={{ width: ancho, height: ancho / PROPORCION, tintColor: color }}
      resizeMode="contain"
      accessibilityRole="image"
      accessibilityLabel="Asta"
    />
  );
}
