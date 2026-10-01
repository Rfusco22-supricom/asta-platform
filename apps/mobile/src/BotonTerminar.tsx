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
    <Pressable
      style={({ pressed }) => [estilos.boton, pressed && estilos.pulsado]}
      onPress={alPulsar}
      accessibilityRole="button"
      accessibilityLabel="Terminar y borrar esta consulta"
    >
      <Text style={estilos.aspa}>✕</Text>
      <Text style={estilos.texto}>Terminar</Text>
    </Pressable>
  );
}

const estilos = StyleSheet.create({
  boton: {
    flexDirection: 'row',
    gap: TEMA.espacio.xs,
    height: TEMA.alturaBoton - 8,
    paddingHorizontal: TEMA.espacio.m,
    borderRadius: TEMA.radio,
    borderWidth: 2,
    borderColor: TEMA.color.linea,
    backgroundColor: TEMA.color.superficie,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulsado: { backgroundColor: TEMA.color.tecla },
  aspa: { color: TEMA.color.tintaSuave, fontSize: TEMA.texto.etiqueta, fontFamily: TEMA.fuente.fuerte },
  texto: { color: TEMA.color.tintaSuave, fontSize: TEMA.texto.etiqueta, fontFamily: TEMA.fuente.fuerte },
});
