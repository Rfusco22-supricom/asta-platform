import { StyleSheet, Text, View } from 'react-native';
import type { EstadoConexion } from './conexion.js';
import { TEMA } from './tema.js';

/**
 * Estado de la conexión, siempre visible (#42).
 *
 * Es para el PERSONAL, no para el cliente: si la tablet lleva media mañana sin
 * red, alguien tiene que verlo sin ponerse a buscar una impresora para
 * descubrirlo. Por eso está siempre, aunque en verde sea casi invisible; cuando
 * algo falla se convierte en una etiqueta de color que sí se ve.
 */
const SEGUN_ESTADO = {
  conectado: { color: TEMA.color.disponible, fondo: TEMA.color.disponibleSuave, texto: 'En línea' },
  sin_conexion: { color: TEMA.color.agotado, fondo: TEMA.color.agotadoSuave, texto: 'Sin conexión' },
  // La búsqueda funciona; lo que no se sabe es la existencia.
  sin_datos_vivos: { color: TEMA.color.bajo, fondo: TEMA.color.bajoSuave, texto: 'Sin datos en vivo' },
} as const;

export function IndicadorConexion({ estado, sobreAzul = false }: { estado: EstadoConexion; sobreAzul?: boolean }) {
  const { color, fondo, texto } = SEGUN_ESTADO[estado];
  const enCalma = estado === 'conectado';
  return (
    <View
      style={[estilos.fila, !enCalma && { backgroundColor: fondo, paddingHorizontal: TEMA.espacio.s }]}
      accessibilityRole="text"
      accessibilityLabel={texto}
    >
      <View style={[estilos.punto, { backgroundColor: enCalma && sobreAzul ? TEMA.color.sobreAzul : color }]} />
      <Text
        style={[
          estilos.texto,
          { color: enCalma ? (sobreAzul ? TEMA.color.sobreAzul : TEMA.color.tintaTenue) : color },
          !enCalma && estilos.textoAviso,
        ]}
      >
        {texto}
      </Text>
    </View>
  );
}

const estilos = StyleSheet.create({
  fila: { flexDirection: 'row', alignItems: 'center', gap: TEMA.espacio.xs, height: 40, borderRadius: TEMA.radio },
  punto: { width: 12, height: 12, borderRadius: 6 },
  texto: { fontFamily: TEMA.fuente.medio, fontSize: TEMA.texto.etiqueta },
  textoAviso: { fontFamily: TEMA.fuente.fuerte },
});
