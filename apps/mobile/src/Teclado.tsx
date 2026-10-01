import { Pressable, StyleSheet, Text, View } from 'react-native';
import { TEMA } from './tema.js';

/**
 * Teclado propio del kiosco, para escribir modelos de impresora (#40).
 *
 * ── Por qué no el del sistema ────────────────────────────────────────────────
 *
 * El del sistema tapa media pantalla justo donde salen los resultados, cambia
 * entre Android e iPad, trae emojis, dictado y autocorrección —que convierte
 * «MF4100» en otra cosa—, y se cierra si el cliente toca fuera. Un modelo de
 * impresora son letras, números y guiones: con eso, en teclas grandes y
 * siempre en el mismo sitio, basta. Sin minúsculas: los modelos vienen en
 * mayúsculas en la placa, y la búsqueda no las distingue.
 *
 * ── Por qué QWERTY escalonado ────────────────────────────────────────────────
 *
 * Es el que la gente tiene en la cabeza: buscar la «M» en un teclado ordenado
 * alfabéticamente o en cuadrícula cuesta más que en el de siempre. Por eso las
 * filas van desplazadas como en uno físico.
 *
 * ── Tamaño ───────────────────────────────────────────────────────────────────
 *
 * Ocupa todo el ancho y las teclas crecen con el hueco que le deja la pantalla
 * (`flex` en filas y teclas), con un tope para que en vertical no salgan
 * teclas de un palmo. En una tablet de 11" apaisada salen de unos 100 × 80 px.
 */

type Fila = ReadonlyArray<string | { hueco: number }>;

const FILAS: readonly Fila[] = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
  [{ hueco: 0.5 }, 'A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', { hueco: 0.5 }],
];

interface Props {
  alEscribir: (letra: string) => void;
  alBorrar: () => void;
  alBuscar: () => void;
  puedeBuscar: boolean;
}

export function Teclado({ alEscribir, alBorrar, alBuscar, puedeBuscar }: Props) {
  return (
    <View style={estilos.todo}>
      {FILAS.map((fila, f) => (
        <View key={f} style={estilos.fila}>
          {fila.map((t, i) =>
            typeof t === 'string' ? <Tecla key={t} etiqueta={t} alPulsar={() => alEscribir(t)} /> : <View key={`h${i}`} style={{ flex: t.hueco }} />,
          )}
        </View>
      ))}

      <View style={estilos.fila}>
        <View style={{ flex: 1.5 }} />
        {['Z', 'X', 'C', 'V', 'B', 'N', 'M'].map((t) => (
          <Tecla key={t} etiqueta={t} alPulsar={() => alEscribir(t)} />
        ))}
        <Tecla etiqueta="⌫ Borrar" peso={1.5} alPulsar={alBorrar} etiquetaAccesible="Borrar" secundaria pequena />
      </View>

      <View style={estilos.fila}>
        <Tecla etiqueta="-" peso={1.5} alPulsar={() => alEscribir('-')} etiquetaAccesible="Guion" />
        <Tecla etiqueta="espacio" peso={4} alPulsar={() => alEscribir(' ')} secundaria pequena />
        <Pressable
          style={({ pressed }) => [
            estilos.tecla,
            estilos.buscar,
            { flex: 4.5 },
            !puedeBuscar && estilos.buscarApagado,
            pressed && puedeBuscar && { backgroundColor: TEMA.color.azulHondo },
          ]}
          onPress={alBuscar}
          disabled={!puedeBuscar}
          accessibilityRole="button"
          accessibilityLabel="Buscar"
          accessibilityState={{ disabled: !puedeBuscar }}
        >
          <Text style={estilos.textoBuscar}>Buscar  →</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Tecla({
  etiqueta,
  alPulsar,
  peso = 1,
  etiquetaAccesible,
  secundaria = false,
  pequena = false,
}: {
  etiqueta: string;
  alPulsar: () => void;
  peso?: number;
  etiquetaAccesible?: string;
  secundaria?: boolean;
  pequena?: boolean;
}) {
  return (
    <Pressable
      style={({ pressed }) => [estilos.tecla, { flex: peso }, secundaria && estilos.secundaria, pressed && estilos.pulsada]}
      onPress={alPulsar}
      accessibilityRole="button"
      accessibilityLabel={etiquetaAccesible ?? etiqueta}
    >
      {({ pressed }) => (
        <Text style={[estilos.letra, pequena && estilos.letraPequena, pressed && { color: TEMA.color.superficie }]}>{etiqueta}</Text>
      )}
    </Pressable>
  );
}

/** 5 filas de hasta 88 px más los huecos: por encima, las teclas ya no ganan nada. */
const ALTO_MAXIMO = 5 * 88 + 4 * 10 + 2 * 14;

const estilos = StyleSheet.create({
  todo: {
    flex: 1,
    maxHeight: ALTO_MAXIMO,
    minHeight: 5 * 48 + 4 * 10 + 2 * 14,
    gap: 10,
    padding: 14,
    backgroundColor: TEMA.color.tecla,
    borderRadius: TEMA.radio + 4,
  },
  fila: { flex: 1, flexDirection: 'row', gap: 10 },
  tecla: {
    borderRadius: TEMA.radio,
    backgroundColor: TEMA.color.superficie,
    alignItems: 'center',
    justifyContent: 'center',
    // El canto inferior de una tecla física: sin él, una cuadrícula blanca no
    // se lee como algo que se pulsa.
    borderBottomWidth: 4,
    borderBottomColor: TEMA.color.linea,
  },
  secundaria: { backgroundColor: '#D3DCE5', borderBottomColor: '#B9C5D1' },
  pulsada: { backgroundColor: TEMA.color.azul, borderBottomColor: TEMA.color.azulHondo },
  letra: { color: TEMA.color.tinta, fontFamily: TEMA.fuente.codigoFuerte, fontSize: 32 },
  letraPequena: { fontFamily: TEMA.fuente.fuerte, fontSize: TEMA.texto.etiqueta, color: TEMA.color.tintaSuave },
  buscar: { backgroundColor: TEMA.color.azul, borderBottomColor: TEMA.color.azulHondo },
  buscarApagado: { backgroundColor: '#9FCDEB', borderBottomColor: '#8ABFE2' },
  textoBuscar: { color: TEMA.color.superficie, fontFamily: TEMA.fuente.titulo, fontSize: TEMA.texto.subtitulo },
});
