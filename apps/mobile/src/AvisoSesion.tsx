import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { TEMA } from './tema.js';

/**
 * «¿Sigues ahí?», 30 segundos antes de cerrar la sesión (#41).
 *
 * Tapa la pantalla a propósito: si el cliente está leyendo y no ve el aviso, se
 * le cierra la sesión mientras compara dos tóners y parece que la tablet se
 * estropeó. Y el botón grande es el de seguir: cerrar ya ocurre solo.
 */
export function AvisoSesion({ visible, alSeguir, alTerminar }: { visible: boolean; alSeguir: () => void; alTerminar: () => void }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={alSeguir}>
      <View style={estilos.fondo}>
        <View style={estilos.caja}>
          <Text style={estilos.titulo}>¿Sigues ahí?</Text>
          <Text style={estilos.texto}>Vamos a cerrar esta consulta para dejar la tablet libre.</Text>
          <Pressable style={estilos.seguir} onPress={alSeguir} accessibilityRole="button">
            <Text style={estilos.textoSeguir}>Sigo aquí</Text>
          </Pressable>
          <Pressable style={estilos.terminar} onPress={alTerminar} accessibilityRole="button">
            <Text style={estilos.textoTerminar}>Ya terminé</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const estilos = StyleSheet.create({
  fondo: { flex: 1, backgroundColor: 'rgba(2, 6, 23, 0.85)', alignItems: 'center', justifyContent: 'center', padding: TEMA.espacio.l },
  caja: { backgroundColor: TEMA.color.superficie, borderRadius: TEMA.radio, padding: TEMA.espacio.l, gap: TEMA.espacio.m, maxWidth: 700, width: '100%' },
  titulo: { color: TEMA.color.texto, fontSize: TEMA.texto.titulo, fontWeight: '700' },
  texto: { color: TEMA.color.textoTenue, fontSize: TEMA.texto.cuerpo },
  seguir: { height: TEMA.alturaBoton, borderRadius: TEMA.radio, backgroundColor: TEMA.color.acento, alignItems: 'center', justifyContent: 'center' },
  textoSeguir: { color: TEMA.color.fondo, fontSize: TEMA.texto.subtitulo, fontWeight: '700' },
  terminar: { height: TEMA.alturaBoton, borderRadius: TEMA.radio, borderWidth: 2, borderColor: TEMA.color.textoTenue, alignItems: 'center', justifyContent: 'center' },
  textoTerminar: { color: TEMA.color.textoTenue, fontSize: TEMA.texto.cuerpo, fontWeight: '600' },
});
