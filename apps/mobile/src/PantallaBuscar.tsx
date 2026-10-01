import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import type { Config, Impresora, MotivoFallo } from './api.js';
import { AvisoDatosGuardados } from './AvisoDatosGuardados.js';
import type { CacheLocal } from './cache.js';
import type { Informe } from './conexion.js';
import { buscarConCache } from './datos.js';
import { Teclado } from './Teclado.js';
import { TEMA } from './tema.js';

/**
 * Buscar la impresora del cliente (#40, sobre la búsqueda de #38).
 *
 * ── Dos momentos, una pantalla ───────────────────────────────────────────────
 *
 * Arriba, a todo lo ancho, lo que se escribe. Debajo, una de dos cosas:
 *
 *   · ESCRIBIENDO: el teclado del kiosco (`Teclado.tsx`), grande y a todo lo
 *     ancho, porque es lo que se usa con el dedo y de pie;
 *   · ELIGIENDO: lo encontrado, en el sitio del teclado, a dos columnas si
 *     cabe. Ya no hace falta teclear, y repartir la pantalla entre las dos cosas
 *     las dejaba pequeñas a las dos.
 *
 * Tocar el campo vuelve a sacar el teclado para corregir.
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
  cache: CacheLocal;
  alElegir: (impresora: Impresora, busquedaId: string | null) => void;
  alTocar: () => void;
  /** Lo llama la capa de datos con el resultado: alimenta el indicador (#42). */
  alConectar: (informe: Informe) => void;
}

type Estado =
  | { fase: 'vacio' }
  | { fase: 'buscando' }
  | {
      fase: 'resultados';
      impresoras: Impresora[];
      sugerencias: Impresora[];
      busquedaId: string | null;
      consulta: string;
      /** Cuándo se guardó, si esto sale de la caché (#42). */
      guardadoEn: number | null;
    }
  | { fase: 'error'; motivo: MotivoFallo };

/** Ningún modelo se acerca a esto; más es alguien apoyado en el teclado. */
const MAX_LARGO = 24;

/** El margen lateral de la pantalla; con él se calcula el ancho de las columnas. */
const MARGEN = TEMA.espacio.l;

export function PantallaBuscar({ config, cache, alElegir, alTocar, alConectar }: Props) {
  const { width, height } = useWindowDimensions();
  /** En una tablet baja (7", 1024 × 600) el consejo le quitaría al teclado el alto que necesita. */
  const conConsejo = height >= 700;
  const [texto, setTexto] = useState('');
  const [estado, setEstado] = useState<Estado>({ fase: 'vacio' });
  const escribiendo = estado.fase === 'vacio';
  const puedeBuscar = texto.trim().length >= 2;

  const buscar = async () => {
    const consulta = texto.trim();
    if (consulta.length < 2) return;
    alTocar();
    setEstado({ fase: 'buscando' });
    const r = await buscarConCache(config, cache, consulta, alConectar);
    if (!r.ok) {
      setEstado({ fase: 'error', motivo: r.motivo });
      return;
    }
    setEstado({ fase: 'resultados', ...r.datos, consulta, guardadoEn: r.desdeCache ? r.guardadoEn : null });
  };

  const corregir = () => {
    alTocar();
    setEstado({ fase: 'vacio' });
  };

  const escribir = (letra: string) => {
    alTocar();
    setTexto((t) => (t.length >= MAX_LARGO || (letra === ' ' && (t === '' || t.endsWith(' '))) ? t : t + letra));
  };

  return (
    <View style={estilos.todo} onTouchStart={alTocar}>
      <Text style={estilos.titulo}>¿Qué impresora tienes?</Text>

      <Campo
        texto={texto}
        ancho={width}
        alto={height}
        escribiendo={escribiendo}
        alTocar={corregir}
        alLimpiar={() => {
          setTexto('');
          corregir();
        }}
      />

      {escribiendo ? (
        <>
          {conConsejo && (
            <Text style={estilos.consejo}>
              Basta con las letras y los números: <Text style={estilos.codigoEnLinea}>P1606</Text>, no «LaserJet Professional P1606dn». No
              importan guiones ni espacios.
            </Text>
          )}
          <View style={estilos.zonaTeclado}>
            <Teclado alEscribir={escribir} alBorrar={() => setTexto((t) => t.slice(0, -1))} alBuscar={buscar} puedeBuscar={puedeBuscar} />
          </View>
        </>
      ) : (
        <Resultados
          estado={estado}
          columnas={width >= 1000 ? 2 : 1}
          ancho={width - 2 * MARGEN}
          alElegir={alElegir}
          alTocar={alTocar}
          alCorregir={corregir}
        />
      )}
    </View>
  );
}

/**
 * Lo escrito, en grande y en la letra de la placa, con su cursor.
 *
 * El tamaño sigue a la pantalla: en una tablet de 8" no puede ser el
 * de una de 13", y el modelo tiene que leerse desde un paso atrás en las dos.
 */
function Campo({
  texto,
  ancho,
  alto,
  escribiendo,
  alTocar,
  alLimpiar,
}: {
  texto: string;
  ancho: number;
  alto: number;
  escribiendo: boolean;
  alTocar: () => void;
  alLimpiar: () => void;
}) {
  const parpadeo = useRef(new Animated.Value(1)).current;
  // Del ancho, y del alto en las tablets bajas, para dejarle sitio al teclado.
  const letra = Math.round(Math.min(56, Math.max(34, Math.min(ancho * 0.042, alto * 0.065))));

  useEffect(() => {
    const ciclo = Animated.loop(
      Animated.sequence([
        Animated.timing(parpadeo, { toValue: 0, duration: 0, delay: 530, useNativeDriver: true }),
        Animated.timing(parpadeo, { toValue: 1, duration: 0, delay: 530, useNativeDriver: true }),
      ]),
    );
    ciclo.start();
    return () => ciclo.stop();
  }, [parpadeo]);

  return (
    <Pressable
      style={[estilos.campo, { height: letra * 2 }, !escribiendo && estilos.campoEnReposo]}
      onPress={alTocar}
      accessibilityRole={escribiendo ? 'text' : 'button'}
      accessibilityLabel={texto ? `Modelo: ${texto}${escribiendo ? '' : '. Toca para corregir'}` : 'Modelo de la impresora, vacío'}
    >
      <View style={estilos.lineaTexto}>
        {texto ? (
          <Text style={[estilos.textoCampo, { fontSize: letra }]} numberOfLines={1} adjustsFontSizeToFit>
            {texto}
          </Text>
        ) : null}
        {escribiendo && <Animated.View style={[estilos.cursor, { height: letra * 1.1, opacity: parpadeo }]} />}
        {!texto && <Text style={[estilos.ejemplo, { fontSize: letra * 0.6 }]}>P1606, MF4100, HL-2350…</Text>}
      </View>

      {!escribiendo && <Text style={estilos.corregir}>✎ Corregir</Text>}
      {escribiendo && texto.length > 0 && (
        <Pressable
          style={({ pressed }) => [estilos.limpiar, pressed && { backgroundColor: TEMA.color.tecla }]}
          onPress={alLimpiar}
          accessibilityRole="button"
          accessibilityLabel="Borrar todo"
        >
          <Text style={estilos.textoLimpiar}>✕</Text>
        </Pressable>
      )}
    </Pressable>
  );
}

function Resultados({
  estado,
  columnas,
  ancho,
  alElegir,
  alTocar,
  alCorregir,
}: {
  estado: Exclude<Estado, { fase: 'vacio' }>;
  columnas: 1 | 2;
  ancho: number;
  alElegir: (impresora: Impresora, busquedaId: string | null) => void;
  alTocar: () => void;
  alCorregir: () => void;
}) {
  if (estado.fase === 'buscando') return <ActivityIndicator size="large" color={TEMA.color.azul} style={{ marginTop: TEMA.espacio.xl }} />;

  if (estado.fase === 'error') {
    return (
      <Mensaje
        titulo="No pudimos buscar"
        texto={
          estado.motivo === 'red'
            ? 'Sin conexión, y esta impresora no la habíamos consultado antes. Pregunta en el mostrador.'
            : estado.motivo === 'erp'
              ? 'Ahora mismo no podemos consultar esta impresora. Pregunta en el mostrador.'
              : estado.motivo === 'permiso'
                ? 'Esta tablet no está autorizada. Avisa a alguien del mostrador.'
                : 'Algo falló de nuestro lado. Inténtalo otra vez.'
        }
        alCorregir={alCorregir}
        aviso
      />
    );
  }

  const opciones = estado.impresoras.length > 0 ? estado.impresoras : estado.sugerencias;
  const sonSugerencias = estado.impresoras.length === 0 && estado.sugerencias.length > 0;

  if (opciones.length === 0) {
    return (
      <Mensaje
        titulo={`No encontramos «${estado.consulta}»`}
        texto="Revisa el modelo en la impresora y corrígelo, o pregunta en el mostrador: lo buscamos por ti."
        alCorregir={alCorregir}
      />
    );
  }

  const gap = TEMA.espacio.s;
  const anchoOpcion = columnas === 2 ? (ancho - gap) / 2 : ancho;

  return (
    <View style={{ flex: 1, gap: TEMA.espacio.s }}>
      {estado.guardadoEn !== null && <AvisoDatosGuardados guardadoEn={estado.guardadoEn} />}
      <Text style={estilos.encabezado}>
        {sonSugerencias
          ? '¿Quisiste decir…?'
          : opciones.length === 1
            ? 'Toca tu impresora'
            : `${opciones.length} impresoras · toca la tuya`}
      </Text>
      <ScrollView contentContainerStyle={estilos.rejilla} onScrollBeginDrag={alTocar}>
        {opciones.map((i) => (
          <Pressable
            key={i.id}
            style={({ pressed }) => [
              estilos.opcion,
              { width: anchoOpcion },
              sonSugerencias && estilos.opcionSugerida,
              pressed && estilos.opcionPulsada,
            ]}
            onPress={() => alElegir(i, estado.busquedaId)}
            accessibilityRole="button"
            accessibilityLabel={`${i.marca} ${i.nombre}`}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={estilos.marca}>{i.marca}</Text>
              <Text style={estilos.modelo} numberOfLines={1} adjustsFontSizeToFit>
                {i.nombre}
              </Text>
            </View>
            <Text style={estilos.chevron}>›</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

function Mensaje({ titulo, texto, alCorregir, aviso = false }: { titulo: string; texto: string; alCorregir: () => void; aviso?: boolean }) {
  return (
    <View style={estilos.mensaje}>
      <Text style={[estilos.mensajeTitulo, aviso && { color: TEMA.color.bajo }]}>{titulo}</Text>
      <Text style={estilos.mensajeTexto}>{texto}</Text>
      <Pressable
        style={({ pressed }) => [estilos.botonCorregir, pressed && { backgroundColor: TEMA.color.azulHondo }]}
        onPress={alCorregir}
        accessibilityRole="button"
      >
        <Text style={estilos.textoBotonCorregir}>Corregir el modelo</Text>
      </Pressable>
    </View>
  );
}

const estilos = StyleSheet.create({
  todo: { flex: 1, paddingHorizontal: MARGEN, paddingTop: TEMA.espacio.s, paddingBottom: TEMA.espacio.m, gap: TEMA.espacio.s },
  titulo: { color: TEMA.color.tinta, fontSize: 34, fontFamily: TEMA.fuente.titulo, letterSpacing: -0.5 },

  campo: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: TEMA.color.superficie,
    borderRadius: TEMA.radio,
    borderWidth: 3,
    borderColor: TEMA.color.azul,
    paddingLeft: TEMA.espacio.m,
    paddingRight: TEMA.espacio.s,
  },
  campoEnReposo: { borderColor: TEMA.color.linea },
  lineaTexto: { flex: 1, flexDirection: 'row', alignItems: 'center', overflow: 'hidden' },
  textoCampo: { flexShrink: 1, color: TEMA.color.tinta, fontFamily: TEMA.fuente.codigo },
  cursor: { width: 4, marginLeft: 3, backgroundColor: TEMA.color.azul, borderRadius: 2 },
  ejemplo: { marginLeft: TEMA.espacio.s, color: TEMA.color.tintaTenue, fontFamily: TEMA.fuente.codigoCuerpo },
  limpiar: { width: 72, height: 72, borderRadius: TEMA.radio, alignItems: 'center', justifyContent: 'center' },
  textoLimpiar: { color: TEMA.color.tintaTenue, fontSize: 32, fontFamily: TEMA.fuente.fuerte },
  corregir: {
    color: TEMA.color.azulHondo,
    fontSize: TEMA.texto.etiqueta,
    fontFamily: TEMA.fuente.titulo,
    paddingHorizontal: TEMA.espacio.s,
  },

  consejo: { color: TEMA.color.tintaSuave, fontFamily: TEMA.fuente.cuerpo, fontSize: 18, lineHeight: 26 },
  codigoEnLinea: { fontFamily: TEMA.fuente.codigoFuerte, color: TEMA.color.tinta },
  // El teclado abajo: es donde llega la mano de alguien de pie delante de un soporte.
  zonaTeclado: { flex: 1, justifyContent: 'flex-end' },

  encabezado: { color: TEMA.color.tintaSuave, fontFamily: TEMA.fuente.fuerte, fontSize: TEMA.texto.etiqueta, marginTop: TEMA.espacio.xs },
  rejilla: { flexDirection: 'row', flexWrap: 'wrap', gap: TEMA.espacio.s, paddingBottom: TEMA.espacio.s },
  opcion: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: TEMA.color.superficie,
    borderRadius: TEMA.radio,
    borderLeftWidth: 8,
    borderLeftColor: TEMA.color.azul,
    paddingVertical: TEMA.espacio.s,
    paddingHorizontal: TEMA.espacio.m,
    minHeight: TEMA.alturaBoton + 24,
  },
  opcionSugerida: { borderLeftColor: TEMA.color.tintaTenue },
  opcionPulsada: { backgroundColor: TEMA.color.azulSuave },
  marca: { color: TEMA.color.tintaTenue, fontSize: 18, fontFamily: TEMA.fuente.fuerte, letterSpacing: 1.5, textTransform: 'uppercase' },
  modelo: { color: TEMA.color.tinta, fontSize: 36, fontFamily: TEMA.fuente.codigo },
  chevron: { color: TEMA.color.azul, fontSize: 52, fontFamily: TEMA.fuente.fuerte, marginLeft: TEMA.espacio.s, marginTop: -6 },

  mensaje: { gap: TEMA.espacio.xs, marginTop: TEMA.espacio.m, maxWidth: 760 },
  mensajeTitulo: { color: TEMA.color.tinta, fontFamily: TEMA.fuente.titulo, fontSize: TEMA.texto.subtitulo },
  mensajeTexto: { color: TEMA.color.tintaSuave, fontFamily: TEMA.fuente.cuerpo, fontSize: TEMA.texto.etiqueta, lineHeight: 30 },
  botonCorregir: {
    alignSelf: 'flex-start',
    marginTop: TEMA.espacio.s,
    height: TEMA.alturaBoton,
    paddingHorizontal: TEMA.espacio.l,
    borderRadius: TEMA.radio,
    backgroundColor: TEMA.color.azul,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textoBotonCorregir: { color: TEMA.color.superficie, fontFamily: TEMA.fuente.titulo, fontSize: TEMA.texto.cuerpo },
});
