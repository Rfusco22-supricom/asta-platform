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
export function IndicadorConexion({ estado }: { estado: EstadoConexion }) {
  const sinRed = estado === 'sin_conexion';
  return (
    <View style={estilos.fila} accessibilityRole="text" accessibilityLabel={sinRed ? 'Sin conexión' : 'Conectado'}>
      <View style={[estilos.punto, { backgroundColor: sinRed ? TEMA.color.agotado : TEMA.color.disponible }]} />
      <Text style={[estilos.texto, sinRed && estilos.textoSinRed]}>{sinRed ? 'Sin conexión' : 'En línea'}</Text>
    </View>
  );
}

const estilos = StyleSheet.create({
  fila: { flexDirection: 'row', alignItems: 'center', gap: TEMA.espacio.xs },
  punto: { width: 14, height: 14, borderRadius: 7 },
  texto: { color: TEMA.color.textoTenue, fontSize: TEMA.texto.etiqueta },
  textoSinRed: { color: TEMA.color.agotado, fontWeight: '700' },
});
