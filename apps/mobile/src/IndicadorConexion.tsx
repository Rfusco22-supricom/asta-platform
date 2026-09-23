import { StyleSheet, Text, View } from 'react-native';
import type { EstadoConexion } from './conexion.js';
import { TEMA } from './tema.js';

/**
 * Estado de la conexión, siempre visible (#42).
 *
 * Es para el PERSONAL, no para el cliente: si la tablet lleva media mañana sin
 * red, alguien tiene que verlo sin ponerse a buscar una impresora para
 * descubrirlo. Por eso está siempre, aunque en verde sea casi invisible.
 */
const SEGUN_ESTADO = {
  conectado: { color: TEMA.color.disponible, texto: 'En línea' },
  sin_conexion: { color: TEMA.color.agotado, texto: 'Sin conexión' },
  // La búsqueda funciona; lo que no se sabe es la existencia.
  sin_datos_vivos: { color: TEMA.color.bajo, texto: 'Sin datos en vivo' },
} as const;

export function IndicadorConexion({ estado }: { estado: EstadoConexion }) {
  const { color, texto } = SEGUN_ESTADO[estado];
  return (
    <View style={estilos.fila} accessibilityRole="text" accessibilityLabel={texto}>
      <View style={[estilos.punto, { backgroundColor: color }]} />
      <Text style={[estilos.texto, estado !== 'conectado' && estilos.textoAviso]}>{texto}</Text>
    </View>
  );
}

const estilos = StyleSheet.create({
  fila: { flexDirection: 'row', alignItems: 'center', gap: TEMA.espacio.xs },
  punto: { width: 14, height: 14, borderRadius: 7 },
  texto: { color: TEMA.color.textoTenue, fontSize: TEMA.texto.etiqueta },
  textoAviso: { fontWeight: '700' },
});
