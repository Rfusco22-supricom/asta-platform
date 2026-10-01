import { StyleSheet, Text, View } from 'react-native';
import { haceCuanto } from './datos.js';
import { TEMA } from './tema.js';

/**
 * «Esto es de hace un rato» (#42).
 *
 * Se enseña encima de los datos guardados, no debajo: el cliente tiene que
 * leerlo ANTES de mirar la existencia. Dice la hora concreta porque «puede que
 * no esté actualizado» no ayuda a decidir, y «hace 6 minutos» sí.
 */
export function AvisoDatosGuardados({ guardadoEn }: { guardadoEn: number }) {
  return (
    <View style={estilos.caja}>
      <Text style={estilos.titulo}>Datos de {haceCuanto(guardadoEn)}</Text>
      <Text style={estilos.texto}>Ahora mismo no podemos consultar la existencia. Confírmala en el mostrador.</Text>
    </View>
  );
}

const estilos = StyleSheet.create({
  caja: {
    backgroundColor: TEMA.color.bajoSuave,
    borderLeftWidth: 8,
    borderLeftColor: TEMA.color.bajo,
    borderRadius: TEMA.radio,
    padding: TEMA.espacio.m,
    gap: 4,
  },
  titulo: { color: TEMA.color.bajo, fontSize: TEMA.texto.etiqueta, fontFamily: TEMA.fuente.titulo },
  texto: { color: TEMA.color.tinta, fontSize: TEMA.texto.etiqueta, fontFamily: TEMA.fuente.cuerpo },
});
