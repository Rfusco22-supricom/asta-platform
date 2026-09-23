import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { buscarImpresoras, type Config, type Impresora } from './api.js';
import { TEMA } from './tema.js';

/**
 * Buscar la impresora del cliente (#40, sobre la búsqueda de #38).
 *
 * ── Por qué se busca al pulsar y no al teclear ───────────────────────────────
 *
 * Buscar a cada tecla en una tablet compartida manda una petición por pulsación
 * y deja la lista saltando debajo del dedo mientras alguien escribe de pie. Se
 * busca al pulsar "Buscar", que además es lo que una persona espera de un
 * teclado en pantalla.
 *
 * ── Sugerencias ──────────────────────────────────────────────────────────────
 *
 * Cuando no hay coincidencias, la API devuelve parecidos aparte. Se PREGUNTA
 * («¿quisiste decir…?»), nunca se afirma: darle por bueno un modelo parecido es
 * venderle al cliente un tóner que no le entra.
 */

interface Props {
  config: Config;
  alElegir: (impresora: Impresora, busquedaId: string | null) => void;
  alTocar: () => void;
}

type Estado =
  | { fase: 'vacio' }
  | { fase: 'buscando' }
  | { fase: 'resultados'; impresoras: Impresora[]; sugerencias: Impresora[]; busquedaId: string | null; consulta: string }
  | { fase: 'error'; motivo: 'red' | 'servidor' | 'permiso' };

export function PantallaBuscar({ config, alElegir, alTocar }: Props) {
  const [texto, setTexto] = useState('');
  const [estado, setEstado] = useState<Estado>({ fase: 'vacio' });

  const buscar = async () => {
    const consulta = texto.trim();
    if (consulta.length < 2) return;
    alTocar();
    setEstado({ fase: 'buscando' });
    const r = await buscarImpresoras(config, consulta);
    if (!r.ok) {
      setEstado({ fase: 'error', motivo: r.motivo });
      return;
    }
    setEstado({ fase: 'resultados', ...r.datos, consulta });
  };

  return (
    <View style={estilos.todo} onTouchStart={alTocar}>
      <Text style={estilos.titulo}>¿Qué impresora tienes?</Text>
      <Text style={estilos.ayuda}>Escríbelo como lo veas en la impresora. No importan guiones ni mayúsculas.</Text>

      <View style={estilos.fila}>
        <TextInput
          style={estilos.entrada}
          value={texto}
          onChangeText={setTexto}
          placeholder="Por ejemplo: HL-2350 o M404"
          placeholderTextColor={TEMA.color.textoTenue}
          autoCapitalize="characters"
          autoCorrect={false}
          returnKeyType="search"
          onSubmitEditing={buscar}
          accessibilityLabel="Modelo de la impresora"
        />
        <Pressable style={[estilos.boton, texto.trim().length < 2 && estilos.botonApagado]} onPress={buscar} accessibilityRole="button">
          <Text style={estilos.textoBoton}>Buscar</Text>
        </Pressable>
      </View>

      {estado.fase === 'buscando' && <ActivityIndicator size="large" color={TEMA.color.acento} style={{ marginTop: TEMA.espacio.l }} />}

      {estado.fase === 'error' && (
        <Text style={estilos.error}>
          {estado.motivo === 'red'
            ? 'Sin conexión. Avisa a alguien del mostrador.'
            : estado.motivo === 'permiso'
              ? 'Esta tablet no está autorizada. Avisa a alguien del mostrador.'
              : 'No pudimos buscar ahora mismo. Inténtalo otra vez.'}
        </Text>
      )}

      {estado.fase === 'resultados' && (
        <ScrollView style={estilos.lista} contentContainerStyle={{ gap: TEMA.espacio.s }} onScrollBeginDrag={alTocar}>
          {estado.impresoras.length === 0 && estado.sugerencias.length === 0 && (
            <Text style={estilos.error}>No encontramos «{estado.consulta}». Prueba con el modelo completo, o pregunta en el mostrador.</Text>
          )}
          {estado.sugerencias.length > 0 && estado.impresoras.length === 0 && <Text style={estilos.pregunta}>¿Quisiste decir…?</Text>}
          {[...estado.impresoras, ...estado.sugerencias].map((i) => (
            <Pressable key={i.id} style={estilos.opcion} onPress={() => alElegir(i, estado.busquedaId)} accessibilityRole="button">
              <Text style={estilos.marca}>{i.marca}</Text>
              <Text style={estilos.modelo}>{i.nombre}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const estilos = StyleSheet.create({
  todo: { flex: 1, padding: TEMA.espacio.l, gap: TEMA.espacio.s },
  titulo: { color: TEMA.color.texto, fontSize: TEMA.texto.titulo, fontWeight: '700' },
  ayuda: { color: TEMA.color.textoTenue, fontSize: TEMA.texto.etiqueta },
  fila: { flexDirection: 'row', gap: TEMA.espacio.s, marginTop: TEMA.espacio.s },
  entrada: {
    flex: 1,
    height: TEMA.alturaBoton,
    backgroundColor: TEMA.color.superficie,
    borderRadius: TEMA.radio,
    paddingHorizontal: TEMA.espacio.m,
    color: TEMA.color.texto,
    fontSize: TEMA.texto.cuerpo,
  },
  boton: {
    height: TEMA.alturaBoton,
    paddingHorizontal: TEMA.espacio.l,
    backgroundColor: TEMA.color.acento,
    borderRadius: TEMA.radio,
    alignItems: 'center',
    justifyContent: 'center',
  },
  botonApagado: { opacity: 0.4 },
  textoBoton: { color: TEMA.color.fondo, fontSize: TEMA.texto.subtitulo, fontWeight: '700' },
  lista: { marginTop: TEMA.espacio.m },
  opcion: { backgroundColor: TEMA.color.superficie, borderRadius: TEMA.radio, padding: TEMA.espacio.m, minHeight: TEMA.alturaBoton },
  marca: { color: TEMA.color.textoTenue, fontSize: TEMA.texto.etiqueta },
  modelo: { color: TEMA.color.texto, fontSize: TEMA.texto.subtitulo, fontWeight: '600' },
  pregunta: { color: TEMA.color.textoTenue, fontSize: TEMA.texto.cuerpo },
  error: { color: TEMA.color.bajo, fontSize: TEMA.texto.cuerpo, marginTop: TEMA.espacio.m },
});
