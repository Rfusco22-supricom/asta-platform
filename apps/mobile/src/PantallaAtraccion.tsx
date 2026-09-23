import { Pressable, StyleSheet, Text, View } from 'react-native';
import { TEMA } from './tema.js';

/**
 * Lo que se ve cuando nadie está usando la tablet (#40).
 *
 * Tiene un solo propósito: que alguien que pasa por delante entienda en dos
 * segundos qué hace y la toque. Por eso una frase grande, una instrucción, y
 * toda la pantalla es el botón: buscar el botón es una barrera.
 */
export function PantallaAtraccion({ alEmpezar }: { alEmpezar: () => void }) {
  return (
    <Pressable style={estilos.todo} onPress={alEmpezar} accessibilityRole="button" accessibilityLabel="Empezar a buscar tu tóner">
      <Text style={estilos.titulo}>¿Qué tóner necesita tu impresora?</Text>
      <Text style={estilos.sub}>Dinos el modelo y te decimos cuál le sirve y si lo tenemos aquí.</Text>
      <View style={estilos.boton}>
        <Text style={estilos.textoBoton}>Toca para empezar</Text>
      </View>
    </Pressable>
  );
}

const estilos = StyleSheet.create({
  todo: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: TEMA.espacio.xl, gap: TEMA.espacio.l },
  titulo: { color: TEMA.color.texto, fontSize: TEMA.texto.gigante, fontWeight: '700', textAlign: 'center' },
  sub: { color: TEMA.color.textoTenue, fontSize: TEMA.texto.subtitulo, textAlign: 'center', maxWidth: 900 },
  boton: {
    backgroundColor: TEMA.color.acento,
    paddingHorizontal: TEMA.espacio.xl,
    height: TEMA.alturaBoton + 16,
    borderRadius: TEMA.radio,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textoBoton: { color: TEMA.color.fondo, fontSize: TEMA.texto.titulo, fontWeight: '700' },
});
