import { useEffect, useMemo, useRef, useState } from 'react';
import { SafeAreaView, StatusBar, StyleSheet, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { useKeepAwake } from 'expo-keep-awake';
import * as ScreenOrientation from 'expo-screen-orientation';
import type { Config, Impresora } from './src/api.js';
import { AvisoSesion } from './src/AvisoSesion.js';
import { BotonTerminar } from './src/BotonTerminar.js';
import { CacheLocal } from './src/cache.js';
import { crearVigilante, type EstadoConexion, type Informe, type Vigilante } from './src/conexion.js';
import { IndicadorConexion } from './src/IndicadorConexion.js';
import { PantallaAtraccion } from './src/PantallaAtraccion.js';
import { PantallaBuscar } from './src/PantallaBuscar.js';
import { PantallaResultados } from './src/PantallaResultados.js';
import { crearSesion, type Sesion } from './src/sesion.js';
import { TEMA } from './src/tema.js';

/**
 * Kiosco de Asta (#40, #41).
 *
 * Tres pantallas: atracción → buscar → resultados. Nada más: quien lo usa está
 * de pie, con prisa y a veces con el dependiente esperando.
 *
 * ── Lo que hace de esto un kiosco ────────────────────────────────────────────
 *
 *   · pantalla completa, sin barras (`app.json`: `androidNavigationBar` en
 *     sticky-immersive y `androidStatusBar.hidden`);
 *   · orientación bloqueada en horizontal: la tablet está en un soporte;
 *   · la pantalla no se apaga durante la jornada (`useKeepAwake`).
 *
 * ── La sesión (#41) ──────────────────────────────────────────────────────────
 *
 * La tablet es compartida, así que lo que hay en pantalla es del cliente de
 * antes. Al tocar la atracción empieza una sesión que se cierra sola a los
 * cuatro minutos sin uso, avisando 30 segundos antes, y que el cliente puede
 * cerrar con «Terminar». Al cerrarse **no queda nada suyo**: `claveSesion`
 * cambia y con ella se desmontan las pantallas, que es donde viven la búsqueda,
 * el modelo elegido y los resultados.
 *
 * Hoy se consulta como visitante y no hay precios en pantalla (#31), pero la
 * sesión se construye ahora para no tener que añadirla cuando sí los haya.
 *
 * ── Sin conexión (#42) ──────────────────────────────────────────────────────
 *
 * Lo consultado se guarda en la tablet. Sin red, se enseña lo último que se
 * supo, con su fecha, en vez de una pantalla en blanco; el estado de la conexión
 * está siempre visible para el personal, y cuando la red vuelve, la pantalla se
 * pone al día sola.
 */
export default function App() {
  useKeepAwake();

  const [pantalla, setPantalla] = useState<'atraccion' | 'buscar' | 'resultados'>('atraccion');
  const [elegida, setElegida] = useState<{ impresora: Impresora; busquedaId: string | null } | null>(null);
  const [avisando, setAvisando] = useState(false);
  const [conexion, setConexion] = useState<EstadoConexion>('conectado');
  /** Cambia al recuperar la red: obliga a las pantallas a volver a pedir (#42). */
  const [recarga, setRecarga] = useState(0);
  /** Cambia en cada sesión: remonta las pantallas y con eso borra su estado. */
  const [claveSesion, setClaveSesion] = useState(0);
  const sesion = useRef<Sesion | null>(null);

  const config = useMemo<Config>(() => {
    const extra = (Constants.expoConfig?.extra ?? {}) as { apiBase?: string; apiKey?: string };
    return { base: extra.apiBase ?? '', apiKey: extra.apiKey ?? '' };
  }, []);

  const cache = useMemo(() => new CacheLocal(AsyncStorage), []);

  const vigilante = useRef<Vigilante | null>(null);
  if (vigilante.current === null) {
    vigilante.current = crearVigilante({
      // `/health` no pide API key y es lo más barato que responde el middleware.
      comprobar: async () => {
        try {
          return (await fetch(`${config.base}/health`)).ok;
        } catch {
          return false;
        }
      },
      alCambiar: setConexion,
      alRecuperar: () => setRecarga((n) => n + 1),
    });
  }
  const alConectar = (informe: Informe) => vigilante.current?.reportar(informe);

  useEffect(() => {
    void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
  }, []);

  const cerrarSesion = () => {
    sesion.current?.parar();
    sesion.current = null;
    setAvisando(false);
    setElegida(null);
    setClaveSesion((n) => n + 1);
    setPantalla('atraccion');
  };

  const empezar = () => {
    sesion.current?.parar();
    sesion.current = crearSesion({ alAvisar: setAvisando, alCerrar: cerrarSesion });
    setPantalla('buscar');
  };

  // Si la app se cierra o se recarga, el temporizador no se queda suelto.
  useEffect(
    () => () => {
      sesion.current?.parar();
      vigilante.current?.parar();
    },
    [],
  );

  const alTocar = () => sesion.current?.tocar();

  return (
    <SafeAreaView style={estilos.todo}>
      <StatusBar hidden />
      {pantalla === 'atraccion' && (
        <>
          <View style={estilos.barraAtraccion}>
            <IndicadorConexion estado={conexion} />
          </View>
          <PantallaAtraccion alEmpezar={empezar} />
        </>
      )}

      {pantalla !== 'atraccion' && (
        <View style={estilos.conSesion} key={claveSesion}>
          <View style={estilos.barra}>
            <IndicadorConexion estado={conexion} />
            <BotonTerminar alPulsar={() => sesion.current?.terminar()} />
          </View>

          {pantalla === 'buscar' && (
            <PantallaBuscar
              config={config}
              cache={cache}
              alConectar={alConectar}
              alTocar={alTocar}
              alElegir={(impresora, busquedaId) => {
                setElegida({ impresora, busquedaId });
                setPantalla('resultados');
              }}
            />
          )}

          {pantalla === 'resultados' && elegida && (
            <PantallaResultados
              config={config}
              cache={cache}
              alConectar={alConectar}
              recarga={recarga}
              impresora={elegida.impresora}
              busquedaId={elegida.busquedaId}
              alTocar={alTocar}
              alVolver={() => {
                alTocar();
                setElegida(null);
                setPantalla('buscar');
              }}
            />
          )}
        </View>
      )}

      <AvisoSesion visible={avisando} alSeguir={alTocar} alTerminar={() => sesion.current?.terminar()} />
    </SafeAreaView>
  );
}

const estilos = StyleSheet.create({
  todo: { flex: 1, backgroundColor: TEMA.color.fondo },
  conSesion: { flex: 1 },
  barraAtraccion: { position: 'absolute', top: TEMA.espacio.s, left: TEMA.espacio.l, zIndex: 1 },
  barra: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: TEMA.espacio.l,
    paddingTop: TEMA.espacio.s,
  },
});
