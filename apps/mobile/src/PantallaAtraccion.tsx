import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Logo } from './Logo.js';
import { TEMA } from './tema.js';

/**
 * Lo que se ve cuando nadie está usando la tablet (#40).
 *
 * Tiene un solo propósito: que alguien que pasa por delante entienda en dos
 * segundos qué hace y la toque. Por eso una frase grande, una instrucción, y
 * toda la pantalla es el botón: buscar el botón es una barrera.
 *
 * A la derecha, la etiqueta de una impresora con el modelo marcado, rotando
 * entre marcas. Responde a la duda que de verdad frena a la gente —«¿y cuál es
 * mi modelo?»— antes de que la tengan, y de paso enseña que no hace falta
 * escribir «LaserJet Professional»: basta con el código.
 */

const EJEMPLOS = [
  { linea: 'HP LaserJet Professional', modelo: 'P1606dn' },
  { linea: 'Canon i-SENSYS', modelo: 'MF4570dn' },
  { linea: 'Brother', modelo: 'HL-L2350DW' },
  { linea: 'Samsung Xpress', modelo: 'M2020W' },
] as const;

const MS_POR_EJEMPLO = 3200;

export function PantallaAtraccion({ alEmpezar }: { alEmpezar: () => void }) {
  const { width, height } = useWindowDimensions();
  // Pensada en horizontal (la tablet va en un soporte), pero un iPad no
  // siempre respeta el bloqueo de orientación: en vertical, una columna.
  const vertical = height > width;
  const [indice, setIndice] = useState(0);
  const opacidad = useRef(new Animated.Value(1)).current;
  const latido = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const t = setInterval(() => {
      Animated.timing(opacidad, { toValue: 0, duration: 220, useNativeDriver: true }).start(() => {
        setIndice((i) => (i + 1) % EJEMPLOS.length);
        Animated.timing(opacidad, { toValue: 1, duration: 320, useNativeDriver: true }).start();
      });
    }, MS_POR_EJEMPLO);
    return () => clearInterval(t);
  }, [opacidad]);

  useEffect(() => {
    // Un pulso lento en el botón: algo que se mueve se ve desde el pasillo, y
    // lento para que no parezca un anuncio.
    const ciclo = Animated.loop(
      Animated.sequence([
        Animated.timing(latido, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(latido, { toValue: 0, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    ciclo.start();
    return () => ciclo.stop();
  }, [latido]);

  const ejemplo = EJEMPLOS[indice] ?? EJEMPLOS[0];
  const escala = latido.interpolate({ inputRange: [0, 1], outputRange: [1, 1.035] });

  return (
    <Pressable style={[estilos.todo, vertical && estilos.todoVertical]} onPress={alEmpezar} accessibilityRole="button" accessibilityLabel="Empezar a buscar tu tóner">
      <View style={[estilos.izquierda, vertical && estilos.columnaVertical]}>
        <Logo ancho={210} color={TEMA.color.superficie} />

        <View style={{ gap: TEMA.espacio.m }}>
          <Text style={estilos.titulo}>¿Qué tóner necesita tu impresora?</Text>
          <Text style={estilos.sub}>Escribe el modelo y te decimos cuál le sirve y si lo tenemos en la tienda.</Text>
        </View>

        <Animated.View style={[estilos.boton, { transform: [{ scale: escala }] }]}>
          <Text style={estilos.textoBoton}>Toca para empezar</Text>
          <Text style={estilos.flecha}>→</Text>
        </Animated.View>
      </View>

      <View style={[estilos.derecha, vertical && estilos.columnaVertical]}>
        <Text style={estilos.rotulo}>DÓNDE ESTÁ TU MODELO</Text>

        {/* El frente de una impresora, con su placa. */}
        <View style={estilos.impresora}>
          <View style={estilos.bandeja} />
          <View style={estilos.placa}>
            <Animated.View style={{ opacity: opacidad, gap: TEMA.espacio.xs }}>
              <Text style={estilos.linea} numberOfLines={1}>
                {ejemplo.linea}
              </Text>
              <View style={estilos.marcado}>
                <Text style={estilos.modelo} numberOfLines={1} adjustsFontSizeToFit>
                  {ejemplo.modelo}
                </Text>
              </View>
            </Animated.View>
          </View>
          <View style={estilos.ranura} />
        </View>

        <Text style={estilos.pista}>Suele estar impreso en el frente o en la tapa. Basta con las letras y los números.</Text>
      </View>
    </Pressable>
  );
}

const estilos = StyleSheet.create({
  todo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: TEMA.color.azul,
    paddingHorizontal: TEMA.espacio.xl,
    paddingVertical: TEMA.espacio.l,
    gap: TEMA.espacio.xl,
  },
  todoVertical: { flexDirection: 'column', justifyContent: 'center', paddingHorizontal: TEMA.espacio.l },
  columnaVertical: { flex: 0, alignSelf: 'stretch' },
  izquierda: { flex: 1.15, gap: TEMA.espacio.l, justifyContent: 'center' },
  titulo: {
    color: TEMA.color.superficie,
    fontFamily: TEMA.fuente.titulo,
    fontSize: TEMA.texto.gigante,
    lineHeight: TEMA.texto.gigante * 1.04,
    letterSpacing: -1.5,
  },
  sub: { color: TEMA.color.sobreAzul, fontFamily: TEMA.fuente.cuerpo, fontSize: TEMA.texto.subtitulo, lineHeight: 36, maxWidth: 620 },
  boton: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: TEMA.espacio.m,
    backgroundColor: TEMA.color.superficie,
    height: TEMA.alturaBoton + 16,
    paddingHorizontal: TEMA.espacio.l,
    borderRadius: TEMA.radio,
  },
  textoBoton: { color: TEMA.color.azulHondo, fontFamily: TEMA.fuente.titulo, fontSize: 34 },
  flecha: { color: TEMA.color.azul, fontFamily: TEMA.fuente.titulo, fontSize: 40, marginTop: -4 },

  derecha: { flex: 0.85, gap: TEMA.espacio.m },
  rotulo: { color: TEMA.color.sobreAzul, fontFamily: TEMA.fuente.fuerte, fontSize: 18, letterSpacing: 2.5 },
  impresora: {
    backgroundColor: '#E9EEF2',
    borderRadius: 14,
    padding: TEMA.espacio.m,
    gap: TEMA.espacio.m,
    // La sombra separa el dibujo del azul sin un borde que lo haga parecer un botón.
    shadowColor: '#062E4A',
    shadowOpacity: 0.35,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 14 },
    elevation: 10,
  },
  bandeja: { height: 18, borderRadius: 4, backgroundColor: '#C9D3DC', marginHorizontal: TEMA.espacio.l },
  placa: {
    backgroundColor: '#2A3440',
    borderRadius: 6,
    paddingVertical: TEMA.espacio.m,
    paddingHorizontal: TEMA.espacio.m,
    minHeight: 150,
    justifyContent: 'center',
  },
  linea: { color: '#AEB9C4', fontFamily: TEMA.fuente.medio, fontSize: TEMA.texto.etiqueta },
  marcado: {
    alignSelf: 'flex-start',
    borderWidth: 4,
    borderColor: TEMA.color.azul,
    borderRadius: 4,
    paddingHorizontal: TEMA.espacio.s,
    paddingVertical: 2,
    backgroundColor: 'rgba(14, 143, 218, 0.18)',
  },
  modelo: { color: TEMA.color.superficie, fontFamily: TEMA.fuente.codigo, fontSize: 48 },
  ranura: { height: 14, borderRadius: 7, backgroundColor: '#1D252E', marginHorizontal: TEMA.espacio.xl },
  pista: { color: TEMA.color.sobreAzul, fontFamily: TEMA.fuente.cuerpo, fontSize: TEMA.texto.etiqueta, lineHeight: 28 },
});
