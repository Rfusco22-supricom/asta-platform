import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { MS_AVISO_ANTES } from './sesion.js';
import { TEMA } from './tema.js';

/**
 * «¿Sigues ahí?», 30 segundos antes de cerrar la sesión (#41).
 *
 * Tapa la pantalla a propósito: si el cliente está leyendo y no ve el aviso, se
 * le cierra la sesión mientras compara dos tóners y parece que la tablet se
 * estropeó. Y el botón grande es el de seguir: cerrar ya ocurre solo.
 *
 * La cuenta atrás es solo para la vista: quien cierra es `sesion.ts`. Si se
 * desfasa un segundo no pasa nada; lo que no puede es decir «30» y cerrar.
 */
export function AvisoSesion({ visible, alSeguir, alTerminar }: { visible: boolean; alSeguir: () => void; alTerminar: () => void }) {
  const [quedan, setQuedan] = useState(MS_AVISO_ANTES / 1000);

  useEffect(() => {
    if (!visible) return;
    const fin = Date.now() + MS_AVISO_ANTES;
    setQuedan(MS_AVISO_ANTES / 1000);
    const t = setInterval(() => setQuedan(Math.max(0, Math.ceil((fin - Date.now()) / 1000))), 250);
    return () => clearInterval(t);
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={alSeguir} supportedOrientations={['landscape']}>
      <View style={estilos.fondo}>
        <View style={estilos.caja}>
          <View style={estilos.cabecera}>
            <View style={estilos.cuenta}>
              <Text style={estilos.numero}>{quedan}</Text>
              <Text style={estilos.unidad}>seg</Text>
            </View>
            <View style={{ flex: 1, gap: TEMA.espacio.xs }}>
              <Text style={estilos.titulo}>¿Sigues ahí?</Text>
              <Text style={estilos.texto}>Vamos a cerrar esta consulta para dejar la tablet libre.</Text>
            </View>
          </View>
          <View style={estilos.botones}>
            <Pressable
              style={({ pressed }) => [estilos.terminar, pressed && { backgroundColor: TEMA.color.tecla }]}
              onPress={alTerminar}
              accessibilityRole="button"
            >
              <Text style={estilos.textoTerminar}>Ya terminé</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [estilos.seguir, pressed && { backgroundColor: TEMA.color.azulHondo }]}
              onPress={alSeguir}
              accessibilityRole="button"
            >
              <Text style={estilos.textoSeguir}>Sigo aquí</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const estilos = StyleSheet.create({
  fondo: { flex: 1, backgroundColor: 'rgba(11, 31, 51, 0.72)', alignItems: 'center', justifyContent: 'center', padding: TEMA.espacio.l },
  caja: {
    backgroundColor: TEMA.color.superficie,
    borderRadius: TEMA.radio,
    borderTopWidth: 10,
    borderTopColor: TEMA.color.azul,
    padding: TEMA.espacio.l,
    gap: TEMA.espacio.l,
    maxWidth: 760,
    width: '100%',
  },
  cabecera: { flexDirection: 'row', alignItems: 'center', gap: TEMA.espacio.l },
  cuenta: {
    width: 128,
    height: 128,
    borderRadius: 64,
    borderWidth: 8,
    borderColor: TEMA.color.azul,
    alignItems: 'center',
    justifyContent: 'center',
  },
  numero: { color: TEMA.color.tinta, fontSize: 52, lineHeight: 56, fontFamily: TEMA.fuente.codigo },
  unidad: { color: TEMA.color.tintaTenue, fontSize: 16, fontFamily: TEMA.fuente.medio, marginTop: -4 },
  titulo: { color: TEMA.color.tinta, fontSize: TEMA.texto.titulo, fontFamily: TEMA.fuente.titulo },
  texto: { color: TEMA.color.tintaSuave, fontSize: TEMA.texto.cuerpo, fontFamily: TEMA.fuente.cuerpo },
  botones: { flexDirection: 'row', gap: TEMA.espacio.s },
  seguir: {
    flex: 2,
    height: TEMA.alturaBoton,
    borderRadius: TEMA.radio,
    backgroundColor: TEMA.color.azul,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textoSeguir: { color: TEMA.color.superficie, fontSize: TEMA.texto.subtitulo, fontFamily: TEMA.fuente.titulo },
  terminar: {
    flex: 1,
    height: TEMA.alturaBoton,
    borderRadius: TEMA.radio,
    borderWidth: 2,
    borderColor: TEMA.color.linea,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textoTerminar: { color: TEMA.color.tintaSuave, fontSize: TEMA.texto.cuerpo, fontFamily: TEMA.fuente.fuerte },
});
