import { useEffect, useMemo, useRef, useState } from 'react';
import { SafeAreaView, StatusBar, StyleSheet } from 'react-native';
import Constants from 'expo-constants';
import { useKeepAwake } from 'expo-keep-awake';
import * as ScreenOrientation from 'expo-screen-orientation';
import type { Config, Impresora } from './src/api.js';
import { crearTemporizador, MS_INACTIVIDAD, type Temporizador } from './src/inactividad.js';
import { PantallaAtraccion } from './src/PantallaAtraccion.js';
import { PantallaBuscar } from './src/PantallaBuscar.js';
import { PantallaResultados } from './src/PantallaResultados.js';
import { TEMA } from './src/tema.js';

/**
 * Kiosco de Asta (#40).
 *
 * Tres pantallas: atracción → buscar → resultados. Nada más: quien lo usa está
 * de pie, con prisa y a veces con el dependiente esperando.
 *
 * ── Lo que hace de esto un kiosco ────────────────────────────────────────────
 *
 *   · pantalla completa, sin barras (`app.json`: `androidNavigationBar` en
 *     sticky-immersive y `androidStatusBar.hidden`);
 *   · orientación bloqueada en horizontal: la tablet está en un soporte;
 *   · la pantalla no se apaga durante la jornada (`useKeepAwake`);
 *   · vuelve sola a la atracción tras un minuto sin que nadie la toque, para
 *     que el siguiente cliente no vea la impresora del anterior.
 *
 * El cierre de sesión con aviso a los 4 minutos es #41, y el modo sin conexión,
 * #42. Aquí no hay sesión todavía: se consulta como visitante.
 */
export default function App() {
  useKeepAwake();

  const [pantalla, setPantalla] = useState<'atraccion' | 'buscar' | 'resultados'>('atraccion');
  const [elegida, setElegida] = useState<{ impresora: Impresora; busquedaId: string | null } | null>(null);
  const temporizador = useRef<Temporizador | null>(null);

  const config = useMemo<Config>(() => {
    const extra = (Constants.expoConfig?.extra ?? {}) as { apiBase?: string; apiKey?: string };
    return { base: extra.apiBase ?? '', apiKey: extra.apiKey ?? '' };
  }, []);

  useEffect(() => {
    void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
  }, []);

  // El temporizador solo corre fuera de la atracción: en la atracción ya está
  // donde tiene que estar, y un temporizador dando vueltas toda la noche no
  // aporta nada.
  useEffect(() => {
    temporizador.current?.parar();
    if (pantalla === 'atraccion') return;
    temporizador.current = crearTemporizador(MS_INACTIVIDAD, () => {
      setElegida(null);
      setPantalla('atraccion');
    });
    return () => temporizador.current?.parar();
  }, [pantalla]);

  const alTocar = () => temporizador.current?.reiniciar();

  return (
    <SafeAreaView style={estilos.todo}>
      <StatusBar hidden />
      {pantalla === 'atraccion' && <PantallaAtraccion alEmpezar={() => setPantalla('buscar')} />}
      {pantalla === 'buscar' && (
        <PantallaBuscar
          config={config}
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
          impresora={elegida.impresora}
          busquedaId={elegida.busquedaId}
          alTocar={alTocar}
          alVolver={() => {
            setElegida(null);
            setPantalla('buscar');
          }}
        />
      )}
    </SafeAreaView>
  );
}

const estilos = StyleSheet.create({
  todo: { flex: 1, backgroundColor: TEMA.color.fondo },
});
