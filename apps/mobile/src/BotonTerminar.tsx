import { Pressable, StyleSheet, Text } from 'react-native';
import { TEMA } from './tema.js';

/**
 * «Terminar», visible en toda pantalla con sesión abierta (#41).
 *
 * El cliente tiene que poder irse dejando la tablet limpia sin esperar cuatro
 * minutos ni preguntarle a nadie. Va arriba a la derecha, discreto pero del
 * tamaño de cualquier otro objetivo táctil.
 */
export function BotonTerminar({ alPulsar }: { alPulsar: () => void }) {
  return (
    <Pressable style={estilos.boton} onPress={alPulsar} accessibilityRole="button" accessibilityLabel="Terminar y borrar esta consulta">
      <Text style={estilos.texto}>Terminar</Text>
    </Pressable>
  );
}

const estilos = StyleSheet.create({
  boton: {
    height: TEMA.alturaBoton,
    paddingHorizontal: TEMA.espacio.m,
    borderRadius: TEMA.radio,
    borderWidth: 2,
    borderColor: TEMA.color.textoTenue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  texto: { color: TEMA.color.textoTenue, fontSize: TEMA.texto.cuerpo, fontWeight: '600' },
});
