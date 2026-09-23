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
      <Text style={estilos.texto}>
        Sin conexión: esto es lo último que sabemos, de {haceCuanto(guardadoEn)}. La existencia puede haber cambiado; confírmala en el mostrador.
      </Text>
    </View>
  );
}

const estilos = StyleSheet.create({
  caja: { backgroundColor: TEMA.color.bajo, borderRadius: TEMA.radio, padding: TEMA.espacio.m },
  texto: { color: TEMA.color.fondo, fontSize: TEMA.texto.etiqueta, fontWeight: '600' },
});
