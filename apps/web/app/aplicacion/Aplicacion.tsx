'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ClienteApi, Datos, activar, almacenNavegador, estaVivo, olvidarToken, tokenGuardado, type Informe, type MotivoFallo, type ResultadoActivacion } from './api';
import {
  AVISO_ANTES_MS,
  CacheLocal,
  LATIDO_MS,
  MAX_LARGO,
  REINTENTO_MS,
  SESION_MS,
  TEXTO_STOCK,
  codigosDeCartucho,
  encabezadoDeCodigos,
  esAsta,
  esPolvo,
  haceCuanto,
  normalizarCodigo,
  queEnsenar,
  recomendado,
  titulo,
  type Busqueda,
  type Impresora,
  type ParaEnsenar,
  type ProductoCompatible,
} from './dominio';

/**
 * La aplicación ASTA web: la misma que las nativas (`apps/android`, `apps/ios`),
 * pantalla por pantalla.
 *
 *   activación → atracción → buscar → resultados
 *
 * Quien la usa está de pie, con prisa y a veces con el dependiente esperando:
 * letra grande, botones de 72 px y un teclado propio. La tablet es compartida:
 * la sesión se cierra sola a los 4 minutos sin tocar (aviso 30 s antes) o con
 * «Terminar», y al cerrarse no queda nada del cliente en pantalla.
 */

type Conexion = 'CONECTADO' | 'SIN_CONEXION' | 'SIN_DATOS_VIVOS';

// ── Raíz: activada o no ──────────────────────────────────────────────────────

export function Aplicacion() {
  // `undefined` mientras se lee el token: en el servidor no hay `localStorage`.
  const [token, setToken] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    setToken(tokenGuardado());
    // Solo en producción: en desarrollo, el código de Next no lleva hash y la caché serviría uno viejo.
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/aplicacion/sw.js', { scope: '/aplicacion' }).catch(() => undefined);
    }
  }, []);

  usePantallaEncendida();
  // Estable: el latido depende de ella y no puede rearmarse en cada repintado.
  const rechazado = useCallback(() => {
    olvidarToken();
    setToken(null);
  }, []);

  if (token === undefined) return <div className="aa-fondo" />;
  if (!token) return <Activacion alActivar={setToken} />;
  return (
<AplicacionActiva key={token} token={token} alRechazar={rechazado} />
  );
}

/** Que la pantalla no se apague durante la jornada (si el navegador lo permite). */
function usePantallaEncendida() {
  useEffect(() => {
    let candado: { release: () => Promise<void> } | null = null;
    const pedir = async () => {
      try {
        const wl = (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock;
        if (wl && document.visibilityState === 'visible') candado = await wl.request('screen');
      } catch {
        /* sin permiso: no pasa nada */
      }
    };
    void pedir();
    const alVolver = () => document.visibilityState === 'visible' && void pedir();
    document.addEventListener('visibilitychange', alVolver);
    return () => {
      document.removeEventListener('visibilitychange', alVolver);
      void candado?.release().catch(() => undefined);
    };
  }, []);
}

// ── Activación ───────────────────────────────────────────────────────────────

const TEXTO_ACTIVACION: Record<Exclude<ResultadoActivacion['tipo'], 'ACTIVADA'>, string> = {
  FORMATO_INVALIDO: 'El código tiene 6 dígitos. Escríbelo tal como sale en el panel.',
  RECHAZADO: 'Ese código no sirve: está mal escrito, caducó (duran 10 minutos) o ya se usó. Pide uno nuevo en el panel.',
  DEMASIADOS_INTENTOS: 'Demasiados códigos equivocados. Espera unos minutos y vuelve a intentarlo.',
  SIN_CONEXION: 'No se pudo comprobar: la tablet no llega al servidor. Revisa el wifi y vuelve a intentarlo.',
};

function Activacion({ alActivar }: { alActivar: (token: string) => void }) {
  const [codigo, setCodigo] = useState('');
  const [comprobando, setComprobando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const instalada = useInstalada();
  const valido = normalizarCodigo(codigo) !== null;

  const enviar = async () => {
    if (!valido || comprobando) return;
    setComprobando(true);
    setAviso(null);
    const r = await activar(codigo);
    setComprobando(false);
    if (r.tipo === 'ACTIVADA') alActivar(r.token);
    else setAviso(TEXTO_ACTIVACION[r.tipo]);
  };

  return (
    <div className="aa-fondo aa-activacion">
      <div className="aa-tarjeta aa-activacion-caja">
        <div className="aa-franja" />
        <div className="aa-activacion-cuerpo">
          <Logo ancho={150} color="var(--aa-azul)" />
          <h1 className="aa-t48">Activa esta tablet</h1>
          <p className="aa-cuerpo aa-suave">
            Esta aplicación es para clientes de Supricom. Para usarla, entra al panel de ASTA con tu cuenta, ve a <b>Tablets → «Añadir tablet»</b> y escribe aquí el código de 6 dígitos.
          </p>
          <form
            className="aa-activacion-fila"
            onSubmit={(e) => {
              e.preventDefault();
              void enviar();
            }}
          >
            <input
              className="aa-codigo-campo"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.replace(/[^\d\s-]/g, '').slice(0, 15))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="482 913"
              aria-label="Código de 6 dígitos"
            />
            <button type="submit" className="aa-boton aa-boton-marca" disabled={!valido || comprobando}>
              {comprobando ? 'Comprobando…' : 'Activar'}
            </button>
          </form>
          {aviso && <p className="aa-aviso-rojo">{aviso}</p>}
          {!instalada && <ComoInstalar />}
        </div>
      </div>
    </div>
  );
}

/** Abierta desde la pantalla de inicio (instalada) y no en una pestaña del navegador. */
function useInstalada() {
  const [instalada, setInstalada] = useState(true);
  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    setInstalada(standalone);
  }, []);
  return instalada;
}

/** Cómo dejarla en la pantalla de inicio, según la tablet. */
function ComoInstalar() {
  const [esIos, setEsIos] = useState(false);
  useEffect(() => setEsIos(/iPad|iPhone|Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1), []);
  return (
    <div className="aa-instalar">
      <b>Primero, instálala en esta tablet</b>
      {esIos ? (
        <span>
          En Safari, toca <b>Compartir</b> (el cuadrado con la flecha) → <b>Añadir a pantalla de inicio</b>, y ábrela desde el icono de ASTA. Luego activa con el código.
        </span>
      ) : (
        <span>
          En Chrome, toca el menú <b>⋮</b> → <b>Instalar aplicación</b> (o «Añadir a pantalla de inicio»), y ábrela desde el icono de ASTA. Luego activa con el código.
        </span>
      )}
    </div>
  );
}

// ── La aplicación activada ───────────────────────────────────────────────────

type Pantalla = { tipo: 'atraccion' } | { tipo: 'buscar' } | { tipo: 'resultados'; impresora: Impresora; busquedaId: string | null };

interface Kiosco {
  datos: Datos;
  conexion: Conexion;
  recargas: number;
  informar: (i: Informe) => void;
  tocar: () => void;
  elegir: (impresora: Impresora, busquedaId: string | null) => void;
  volverABuscar: () => void;
}

function AplicacionActiva({ token, alRechazar }: { token: string; alRechazar: () => void }) {
  const datos = useMemo(() => new Datos(new ClienteApi(token), new CacheLocal(almacenNavegador)), [token]);
  const [pantalla, setPantalla] = useState<Pantalla>({ tipo: 'atraccion' });
  const [avisando, setAvisando] = useState(false);
  // Cambia en cada sesión: rehace las pantallas y con eso borra su estado.
  const [claveSesion, setClaveSesion] = useState(0);
  const { conexion, recargas, informar } = useVigilante();

  // Latido cada 10 min, y de paso si el token sigue valiendo: un 401 es que la desactivaron en el panel.
  useEffect(() => {
    let vivo = true;
    const latir = async () => {
      if ((await datos.api.comprobar()) === 'RECHAZADO' && vivo) alRechazar();
    };
    void latir();
    const id = setInterval(() => void latir(), LATIDO_MS);
    return () => {
      vivo = false;
      clearInterval(id);
    };
  }, [datos, alRechazar]);

  // La sesión: aviso a los 3:30 sin tocar, cierre a los 4:00.
  const relojes = useRef<number[]>([]);
  const viva = useRef(false);
  const limpiar = () => {
    relojes.current.forEach((r) => clearTimeout(r));
    relojes.current = [];
  };
  const cerrar = useCallback(() => {
    viva.current = false;
    limpiar();
    setAvisando(false);
    setClaveSesion((c) => c + 1);
    setPantalla({ tipo: 'atraccion' });
  }, []);
  const armar = useCallback(() => {
    limpiar();
    relojes.current = [window.setTimeout(() => viva.current && setAvisando(true), SESION_MS - AVISO_ANTES_MS), window.setTimeout(() => viva.current && cerrar(), SESION_MS)];
  }, [cerrar]);
  const tocar = useCallback(() => {
    if (!viva.current) return;
    setAvisando(false);
    armar();
  }, [armar]);
  const empezar = () => {
    viva.current = true;
    armar();
    setPantalla({ tipo: 'buscar' });
  };
  useEffect(() => limpiar, []);

  const kiosco: Kiosco = {
    datos,
    conexion,
    recargas,
    informar,
    tocar,
    elegir: (impresora, busquedaId) => {
      tocar();
      setPantalla({ tipo: 'resultados', impresora, busquedaId });
    },
    volverABuscar: () => {
      tocar();
      setPantalla({ tipo: 'buscar' });
    },
  };

  return (
    <>
      {pantalla.tipo === 'atraccion' ? (
        <Atraccion conexion={conexion} alEmpezar={empezar} />
      ) : (
        // Cualquier toque, en cualquier sitio, cuenta como actividad.
        <div key={claveSesion} className="aa-fondo aa-sesion" onPointerDownCapture={tocar}>
          <Barra paso={pantalla.tipo === 'buscar' ? 1 : 2} conexion={conexion} alTerminar={cerrar} />
          {pantalla.tipo === 'resultados' ? <Resultados kiosco={kiosco} impresora={pantalla.impresora} busquedaId={pantalla.busquedaId} /> : <Buscar kiosco={kiosco} />}
        </div>
      )}
      {avisando && <AvisoSesion alSeguir={tocar} alTerminar={cerrar} />}
    </>
  );
}

/**
 * El estado de la conexión, por lo que pasa con las peticiones de verdad. Mientras
 * algo está caído se comprueba cada 15 s; al volver, `recargas` sube y la
 * pantalla vuelve a pedir lo mismo, en vivo.
 */
function useVigilante() {
  const [conexion, setConexion] = useState<Conexion>('CONECTADO');
  const [recargas, setRecargas] = useState(0);
  const actual = useRef<Conexion>('CONECTADO');
  const sondeo = useRef<number | null>(null);

  const pasarA = useCallback((nuevo: Conexion) => {
    if (nuevo === actual.current) return;
    actual.current = nuevo;
    setConexion(nuevo);
    if (sondeo.current) clearInterval(sondeo.current);
    sondeo.current = null;
    if (nuevo === 'CONECTADO') {
      setRecargas((r) => r + 1);
      return;
    }
    sondeo.current = window.setInterval(async () => {
      if (await estaVivo()) pasarA('CONECTADO');
    }, REINTENTO_MS);
  }, []);

  useEffect(() => () => void (sondeo.current && clearInterval(sondeo.current)), []);

  const informar = useCallback((i: Informe) => pasarA(i === 'OK' ? 'CONECTADO' : i === 'SIN_RED' ? 'SIN_CONEXION' : 'SIN_DATOS_VIVOS'), [pasarA]);
  return { conexion, recargas, informar };
}

// ── Piezas comunes ───────────────────────────────────────────────────────────

/** El logo de Asta, del color que toque (máscara sobre sus letras). */
function Logo({ ancho, color }: { ancho: number; color: string }) {
  return <span className="aa-logo" role="img" aria-label="Asta" style={{ width: ancho, height: ancho * 0.404, background: color }} />;
}

/** Estado de la conexión, siempre visible: es para el personal. */
function IndicadorConexion({ conexion, sobreAzul = false }: { conexion: Conexion; sobreAzul?: boolean }) {
  const texto = conexion === 'CONECTADO' ? 'En línea' : conexion === 'SIN_CONEXION' ? 'Sin conexión' : 'Sin datos en vivo';
  return (
    <span className={`aa-conexion aa-conexion-${conexion.toLowerCase()}${sobreAzul ? ' sobre-azul' : ''}`} role="status">
      <i />
      {texto}
    </span>
  );
}

function AvisoDatosGuardados({ guardadoEn }: { guardadoEn: number }) {
  return (
    <div className="aa-guardados">
      <b>Datos de {haceCuanto(guardadoEn)}</b>
      <span>Ahora mismo no podemos consultar la existencia. Confírmala en el mostrador.</span>
    </div>
  );
}

// ── Atracción ────────────────────────────────────────────────────────────────

const EJEMPLOS: [string, string][] = [
  ['HP LaserJet Professional', 'P1606dn'],
  ['Canon i-SENSYS', 'MF4570dn'],
  ['Brother', 'HL-L2350DW'],
  ['Samsung Xpress', 'M2020W'],
];

/** Lo que se ve cuando nadie la usa: una frase grande, y toda la pantalla es el botón. */
function Atraccion({ conexion, alEmpezar }: { conexion: Conexion; alEmpezar: () => void }) {
  const [indice, setIndice] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setIndice((i) => (i + 1) % EJEMPLOS.length), 3_200);
    return () => clearInterval(id);
  }, []);
  const [linea, modelo] = EJEMPLOS[indice]!;
  return (
    <button type="button" className="aa-atraccion" onClick={alEmpezar} aria-label="Empezar a buscar tu tóner">
      <span className="aa-atraccion-conexion">
        <IndicadorConexion conexion={conexion} sobreAzul />
      </span>
      <span className="aa-atraccion-izq">
        <Logo ancho={210} color="#fff" />
        <span className="aa-atraccion-titulo">¿Qué tóner necesita tu impresora?</span>
        <span className="aa-atraccion-sub">Escribe el modelo y te decimos qué tóner le sirve.</span>
        <span className="aa-atraccion-boton">
          Toca para empezar <b>→</b>
        </span>
      </span>
      <span className="aa-atraccion-der">
        <span className="aa-etiqueta-mayus sobre-azul">DÓNDE ESTÁ TU MODELO</span>
        <span className="aa-placa">
          <span className="aa-placa-ranura" />
          <span className="aa-placa-pantalla">
            <span key={indice} className="aa-placa-ejemplo">
              <span className="aa-placa-linea">{linea}</span>
              <span className="aa-placa-modelo">{modelo}</span>
            </span>
          </span>
          <span className="aa-placa-bandeja" />
        </span>
        <span className="aa-atraccion-pie">Suele estar impreso en el frente o en la tapa. Basta con las letras y los números.</span>
      </span>
    </button>
  );
}

// ── Barra ────────────────────────────────────────────────────────────────────

function Barra({ paso, conexion, alTerminar }: { paso: number; conexion: Conexion; alTerminar: () => void }) {
  return (
    <header className="aa-barra">
      <Logo ancho={104} color="var(--aa-azul)" />
      <div className="aa-pasos">
        {['Tu impresora', 'Tu tóner'].map((nombre, i) => (
          <span key={nombre} className="aa-paso-grupo">
            {i > 0 && <span className="aa-paso-flecha">›</span>}
            <span className={`aa-paso${paso === i + 1 ? ' activo' : ''}`}>
              <i>{i + 1}</i>
              {nombre}
            </span>
          </span>
        ))}
      </div>
      <IndicadorConexion conexion={conexion} />
      <button type="button" className="aa-boton aa-boton-borde" onClick={alTerminar} aria-label="Terminar y borrar esta consulta">
        ✕&nbsp; Terminar
      </button>
    </header>
  );
}

// ── Buscar ───────────────────────────────────────────────────────────────────

type EstadoBusqueda = { tipo: 'vacio' } | { tipo: 'buscando' } | { tipo: 'resultados'; b: Busqueda; consulta: string; guardadoEn: number | null } | { tipo: 'error'; motivo: MotivoFallo };

const TEXTO_FALLO_BUSQUEDA: Record<MotivoFallo, string> = {
  RED: 'Sin conexión, y esta impresora no la habíamos consultado antes. Pregunta en el mostrador.',
  ERP: 'Ahora mismo no podemos consultar esta impresora. Pregunta en el mostrador.',
  PERMISO: 'Esta tablet no está autorizada. Avisa a alguien del mostrador.',
  SERVIDOR: 'Algo falló de nuestro lado. Inténtalo otra vez.',
};

function Buscar({ kiosco }: { kiosco: Kiosco }) {
  const [texto, setTexto] = useState('');
  const [estado, setEstado] = useState<EstadoBusqueda>({ tipo: 'vacio' });
  const escribiendo = estado.tipo === 'vacio';
  const puedeBuscar = texto.trim().length >= 2;
  // Cuál es la búsqueda que vale: «Corregir» con una en curso no puede traer sus resultados después.
  const vigente = useRef(0);

  const corregir = () => {
    vigente.current++;
    setEstado({ tipo: 'vacio' });
  };

  const buscar = async () => {
    const consulta = texto.trim();
    if (consulta.length < 2) return;
    const esta = ++vigente.current;
    setEstado({ tipo: 'buscando' });
    const r = await kiosco.datos.buscar(consulta, kiosco.informar);
    if (esta !== vigente.current) return;
    setEstado(r.ok ? { tipo: 'resultados', b: r.datos, consulta, guardadoEn: r.guardadoEn } : { tipo: 'error', motivo: r.motivo });
  };

  const escribir = (letra: string) =>
    setTexto((t) => (t.length < MAX_LARGO && !(letra === ' ' && (t === '' || t.endsWith(' '))) ? t + letra : t));
  const borrar = () => setTexto((t) => t.slice(0, -1));

  // Con un teclado físico también se puede (una tablet con funda, el portátil del mostrador).
  const refBuscar = useRef(buscar);
  refBuscar.current = buscar;
  useEffect(() => {
    if (!escribiendo) return;
    const alTeclear = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Enter') void refBuscar.current();
      else if (e.key === 'Backspace') borrar();
      else if (/^[a-z0-9 -]$/i.test(e.key)) escribir(e.key.toUpperCase());
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', alTeclear);
    return () => window.removeEventListener('keydown', alTeclear);
  }, [escribiendo]);

  return (
    <main className="aa-buscar">
      <h1 className="aa-t34">¿Qué impresora tienes?</h1>
      <button
        type="button"
        className={`aa-campo${escribiendo ? ' escribiendo' : ''}`}
        onClick={corregir}
        aria-label={texto ? `Modelo: ${texto}${escribiendo ? '' : '. Toca para corregir'}` : 'Modelo de la impresora, vacío'}
      >
        {texto && <span className="aa-campo-texto">{texto}</span>}
        {escribiendo && <span className="aa-cursor" />}
        {!texto && <span className="aa-campo-ejemplo">P1606, MF4100, HL-2350…</span>}
        <span className="aa-hueco" />
        {!escribiendo ? (
          <span className="aa-campo-corregir">✎ Corregir</span>
        ) : (
          texto && (
            <span
              className="aa-campo-limpiar"
              role="button"
              aria-label="Borrar todo"
              onClick={(e) => {
                e.stopPropagation();
                setTexto('');
                corregir();
              }}
            >
              ✕
            </span>
          )
        )}
      </button>
      {escribiendo ? (
        <>
          <p className="aa-consejo">
            Basta con las letras y los números: <code>P1606</code>, no «LaserJet Professional P1606dn». No importan guiones ni espacios.
          </p>
          <span className="aa-hueco" />
          <Teclado alEscribir={escribir} alBorrar={borrar} alBuscar={() => void buscar()} puedeBuscar={puedeBuscar} />
        </>
      ) : (
        <Lista estado={estado} kiosco={kiosco} alCorregir={corregir} />
      )}
    </main>
  );
}

function Lista({ estado, kiosco, alCorregir }: { estado: EstadoBusqueda; kiosco: Kiosco; alCorregir: () => void }) {
  if (estado.tipo === 'vacio') return null;
  if (estado.tipo === 'buscando') return <Cargando />;
  if (estado.tipo === 'error') return <Mensaje titulo="No pudimos buscar" texto={TEXTO_FALLO_BUSQUEDA[estado.motivo]} alCorregir={alCorregir} aviso />;
  const { b } = estado;
  const opciones = b.impresoras.length ? b.impresoras : b.sugerencias;
  const sonSugerencias = b.impresoras.length === 0 && b.sugerencias.length > 0;
  if (opciones.length === 0) {
    return <Mensaje titulo={`No encontramos «${estado.consulta}»`} texto="Revisa el modelo en la impresora y corrígelo, o pregunta en el mostrador: lo buscamos por ti." alCorregir={alCorregir} />;
  }
  return (
    <div className="aa-lista">
      {estado.guardadoEn !== null && <AvisoDatosGuardados guardadoEn={estado.guardadoEn} />}
      <p className="aa-lista-titulo">{sonSugerencias ? '¿Quisiste decir…?' : opciones.length === 1 ? 'Toca tu impresora' : `${opciones.length} impresoras · toca la tuya`}</p>
      <div className="aa-impresoras">
        {opciones.map((i) => (
          <button key={i.id} type="button" className={`aa-impresora${sonSugerencias ? ' sugerida' : ''}`} onClick={() => kiosco.elegir(i, b.busquedaId)} aria-label={`${i.marca} ${i.nombre}`}>
            <span className="aa-impresora-texto">
              <span className="aa-impresora-marca">{i.marca.toUpperCase()}</span>
              <span className="aa-impresora-nombre">{i.nombre}</span>
            </span>
            <span className="aa-impresora-flecha">›</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Mensaje({ titulo: t, texto, alCorregir, aviso = false }: { titulo: string; texto: string; alCorregir: () => void; aviso?: boolean }) {
  return (
    <div className="aa-mensaje">
      <h2 className={aviso ? 'aa-t28 aa-color-bajo' : 'aa-t28'}>{t}</h2>
      <p className="aa-cuerpo20 aa-suave">{texto}</p>
      <button type="button" className="aa-boton aa-boton-marca" onClick={alCorregir}>
        Corregir el modelo
      </button>
    </div>
  );
}

function Cargando() {
  return (
    <div className="aa-cargando" role="status" aria-label="Buscando">
      <span />
    </div>
  );
}

// ── Teclado ──────────────────────────────────────────────────────────────────

/**
 * Teclado propio: el del sistema tapa media pantalla, trae autocorrección (que
 * convierte «MF4100» en otra cosa) y se cierra si se toca fuera. QWERTY
 * escalonado, sin minúsculas: los modelos vienen en mayúsculas.
 */
type Pieza = { tipo: 'letra'; t: string; peso?: number } | { tipo: 'hueco'; peso: number } | { tipo: 'borrar' } | { tipo: 'espacio' } | { tipo: 'buscar' };

const letras = (s: string): Pieza[] => [...s].map((t) => ({ tipo: 'letra', t }));
const FILAS: Pieza[][] = [
  letras('1234567890'),
  letras('QWERTYUIOP'),
  [{ tipo: 'hueco', peso: 0.5 }, ...letras('ASDFGHJKL'), { tipo: 'hueco', peso: 0.5 }],
  [{ tipo: 'hueco', peso: 1.5 }, ...letras('ZXCVBNM'), { tipo: 'borrar' }],
  [{ tipo: 'letra', t: '-', peso: 1.5 }, { tipo: 'espacio' }, { tipo: 'buscar' }],
];
const PESO: Record<Pieza['tipo'], number> = { letra: 1, hueco: 1, borrar: 1.5, espacio: 4, buscar: 4.5 };

function Teclado({ alEscribir, alBorrar, alBuscar, puedeBuscar }: { alEscribir: (l: string) => void; alBorrar: () => void; alBuscar: () => void; puedeBuscar: boolean }) {
  // Al bajar el dedo y no al levantarlo: se escribe rápido y sin el retraso del clic.
  const pulsar = (e: React.PointerEvent, accion: () => void) => {
    e.preventDefault();
    accion();
  };
  return (
    <div className="aa-teclado" role="group" aria-label="Teclado">
      {FILAS.map((fila, f) => (
        <div key={f} className="aa-teclado-fila">
          {fila.map((p, k) => {
            const flex = { flex: `${'peso' in p && p.peso ? p.peso : PESO[p.tipo]} 1 0` };
            if (p.tipo === 'hueco') return <span key={k} style={flex} />;
            if (p.tipo === 'letra') {
              return (
                <button key={k} type="button" style={flex} className="aa-tecla" aria-label={p.t === '-' ? 'Guion' : p.t} onPointerDown={(e) => pulsar(e, () => alEscribir(p.t))}>
                  {p.t}
                </button>
              );
            }
            if (p.tipo === 'borrar') {
              return (
                <button key={k} type="button" style={flex} className="aa-tecla secundaria" aria-label="Borrar" onPointerDown={(e) => pulsar(e, alBorrar)}>
                  ⌫ Borrar
                </button>
              );
            }
            if (p.tipo === 'espacio') {
              return (
                <button key={k} type="button" style={flex} className="aa-tecla secundaria" aria-label="Espacio" onPointerDown={(e) => pulsar(e, () => alEscribir(' '))}>
                  espacio
                </button>
              );
            }
            return (
              <button key={k} type="button" style={flex} className="aa-tecla aa-tecla-buscar" disabled={!puedeBuscar} aria-label="Buscar" onClick={alBuscar}>
                Buscar&nbsp; →
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ── Resultados ───────────────────────────────────────────────────────────────

type EstadoResultados = { tipo: 'cargando' } | { tipo: 'listo'; que: ParaEnsenar; guardadoEn: number | null } | { tipo: 'fallo'; texto: string };

function Resultados({ kiosco, impresora, busquedaId }: { kiosco: Kiosco; impresora: Impresora; busquedaId: string | null }) {
  const [estado, setEstado] = useState<EstadoResultados>({ tipo: 'cargando' });
  const [elegido, setElegido] = useState<number | null>(null);
  const { datos, informar, recargas } = kiosco;

  // `recargas` cambia cuando vuelve la red: se vuelve a pedir lo mismo, en vivo.
  useEffect(() => {
    let vigente = true;
    void datos.compatibles(impresora.id, busquedaId, informar).then((r) => {
      if (!vigente) return;
      setEstado(
        r.ok
          ? { tipo: 'listo', que: queEnsenar(r.datos), guardadoEn: r.guardadoEn }
          : {
              tipo: 'fallo',
              texto: r.motivo === 'RED' || r.motivo === 'ERP' ? 'Ahora mismo no podemos consultar esta impresora, y no la habíamos consultado antes. Pregunta en el mostrador.' : 'No pudimos consultarlo ahora mismo.',
            },
      );
    });
    return () => {
      vigente = false;
    };
  }, [datos, informar, impresora.id, busquedaId, recargas]);

  return (
    <main className="aa-resultados">
      <div className="aa-cabecera">
        <button type="button" className="aa-boton aa-boton-azul-borde" onClick={kiosco.volverABuscar} aria-label="Buscar otra impresora">
          ‹ Buscar otra
        </button>
        <div className="aa-cabecera-texto">
          <span className="aa-etiqueta-mayus">PARA TU IMPRESORA</span>
          <span className="aa-cabecera-impresora">
            <span className="aa-suave">{impresora.marca} </span>
            <code>{impresora.nombre}</code>
          </span>
        </div>
      </div>
      {estado.tipo === 'cargando' && <Cargando />}
      {estado.tipo === 'fallo' && <p className="aa-t24 aa-color-bajo aa-fallo">{estado.texto}</p>}
      {estado.tipo === 'listo' && estado.que.tipo === 'sinNada' && (
        <>
          {estado.guardadoEn !== null && <AvisoDatosGuardados guardadoEn={estado.guardadoEn} />}
          <Nota etiqueta="TE AYUDAMOS EN EL MOSTRADOR" titulo="Aún no tenemos cargado qué tóner le sirve a esta impresora." texto="Enseña esta pantalla en el mostrador y te decimos cuál es y si lo tenemos: " impresora={impresora} />
        </>
      )}
      {estado.tipo === 'listo' && estado.que.tipo === 'sinAsta' && (
        <>
          {estado.guardadoEn !== null && <AvisoDatosGuardados guardadoEn={estado.guardadoEn} />}
          <Nota etiqueta="★ ASTA PARA TU IMPRESORA" titulo="Todavía no tenemos Asta para esta impresora." texto="Pregunta en el mostrador y te decimos qué opciones hay para tu " impresora={impresora} />
        </>
      )}
      {estado.tipo === 'listo' && estado.que.tipo === 'asta' && (
        <ConAsta
          productos={estado.que.productos}
          impresora={impresora}
          guardadoEn={estado.guardadoEn}
          elegido={elegido}
          alElegir={(p) => {
            // Sin conexión no se registra: el clic se perdería.
            if (estado.guardadoEn === null && p.id !== elegido) datos.api.registrarClic(busquedaId, p.id);
            setElegido(p.id);
          }}
        />
      )}
    </main>
  );
}

function ConAsta({ productos, impresora, guardadoEn, elegido, alElegir }: { productos: ProductoCompatible[]; impresora: Impresora; guardadoEn: number | null; elegido: number | null; alElegir: (p: ProductoCompatible) => void }) {
  const sugerido = recomendado(productos);
  const codigos = codigosDeCartucho(productos);
  const enTienda = productos.filter((p) => p.stock !== 'agotado').length;
  // Una tablet sin almacén (la de un cliente) no sabe qué hay en tienda: no lo dice.
  const conExistencias = productos.every((p) => p.stock != null);
  const elegidoP = productos.find((p) => p.id === elegido) ?? null;
  return (
    <div className="aa-con-asta">
      <aside className="aa-respuesta">
        <span className="aa-etiqueta-mayus sobre-azul">{encabezadoDeCodigos(productos)}</span>
        {codigos.map((c) => (
          <code key={c} className="aa-respuesta-codigo">
            {c}
          </code>
        ))}
        <hr />
        <span className="aa-respuesta-resumen">
          <b>
            {productos.length} {productos.length === 1 ? 'opción' : 'opciones'}
          </b>
          {conExistencias && (enTienda > 0 ? ` · ${enTienda} en tienda` : ' · ninguna en tienda ahora: se puede encargar')}
        </span>
        {sugerido && (
          <span className="aa-recomendamos">
            <span className="aa-etiqueta-mayus azul">TE RECOMENDAMOS</span>
            <b>{titulo(sugerido, impresora)}</b>
            {sugerido.stock && <span className="aa-color-disponible">{TEXTO_STOCK[sugerido.stock]}</span>}
          </span>
        )}
      </aside>
      <div className="aa-opciones">
        <div className="aa-opciones-lista">
          {guardadoEn !== null && <AvisoDatosGuardados guardadoEn={guardadoEn} />}
          {productos.map((p) => (
            <Etiqueta key={p.id} p={p} impresora={impresora} elegido={p.id === elegido} recomendado={p.id === sugerido?.id} alPulsar={() => alElegir(p)} />
          ))}
        </div>
        <div className={`aa-pie${elegidoP ? ' con-elegido' : ''}`}>
          {elegidoP ? (
            <span>
              Enseña esta pantalla en el mostrador y pide <code>{elegidoP.sku ?? titulo(elegidoP, impresora)}</code>
            </span>
          ) : (
            <span className="aa-suave">Toca el que quieras llevarte y enséñale la pantalla al mostrador.</span>
          )}
        </div>
      </div>
    </div>
  );
}

/** Un producto, con la forma de la etiqueta de una caja de tóner. */
function Etiqueta({ p, impresora, elegido, recomendado: rec, alPulsar }: { p: ProductoCompatible; impresora: Impresora; elegido: boolean; recomendado: boolean; alPulsar: () => void }) {
  const stock = p.stock ?? null;
  return (
    <button
      type="button"
      className={`aa-producto${elegido ? ' elegido' : ''}${rec ? ' recomendado' : ''} stock-${stock ?? 'nada'}`}
      onClick={alPulsar}
      aria-label={[titulo(p, impresora), stock ? TEXTO_STOCK[stock] : null].filter(Boolean).join(', ')}
    >
      <span className="aa-producto-franja" />
      <span className="aa-producto-texto">
        <span className="aa-sellos">
          {rec && <span className="aa-sello hondo">★ RECOMENDADO</span>}
          {esAsta(p) ? <span className="aa-sello azul">ASTA</span> : <span className="aa-sello borde">{p.tipo === 'original' ? 'ORIGINAL' : 'COMPATIBLE'}</span>}
          {esPolvo(p) && <span className="aa-sello gris">PARA RECARGAR</span>}
        </span>
        <span className="aa-producto-titulo">{titulo(p, impresora)}</span>
        <code className="aa-producto-nombre">{p.nombre}</code>
      </span>
      {stock ? (
        <span className="aa-producto-stock">
          <b>{TEXTO_STOCK[stock]}</b>
          {elegido && <span>✓ Elegido</span>}
        </span>
      ) : (
        elegido && <span className="aa-producto-elegido">✓ Elegido</span>
      )}
    </button>
  );
}

function Nota({ etiqueta, titulo: t, texto, impresora }: { etiqueta: string; titulo: string; texto: string; impresora: Impresora }) {
  return (
    <div className="aa-nota">
      <span className="aa-nota-franja" />
      <div className="aa-nota-cuerpo">
        <span className="aa-etiqueta-mayus azul">{etiqueta}</span>
        <h2 className="aa-t28">{t}</h2>
        <p className="aa-cuerpo aa-suave">
          {texto}
          <code>
            {impresora.marca} {impresora.nombre}
          </code>
        </p>
      </div>
    </div>
  );
}

// ── Aviso de sesión ──────────────────────────────────────────────────────────

/** «¿Sigues ahí?», 30 s antes de cerrar. Tapa la pantalla a propósito. */
function AvisoSesion({ alSeguir, alTerminar }: { alSeguir: () => void; alTerminar: () => void }) {
  const [quedan, setQuedan] = useState(AVISO_ANTES_MS / 1000);
  useEffect(() => {
    const id = setInterval(() => setQuedan((q) => Math.max(0, q - 1)), 1_000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="aa-velo" role="alertdialog" aria-label="¿Sigues ahí?">
      <div className="aa-tarjeta aa-aviso">
        <div className="aa-franja" />
        <div className="aa-aviso-cuerpo">
          <div className="aa-aviso-fila">
            <span className="aa-cuenta">
              <b>{quedan}</b>
              <span>seg</span>
            </span>
            <span>
              <h2 className="aa-t40">¿Sigues ahí?</h2>
              <p className="aa-cuerpo aa-suave">Vamos a cerrar esta consulta para dejar la tablet libre.</p>
            </span>
          </div>
          <div className="aa-aviso-botones">
            <button type="button" className="aa-boton aa-boton-borde" onClick={alTerminar}>
              Ya terminé
            </button>
            <button type="button" className="aa-boton aa-boton-marca aa-boton-grande" onClick={alSeguir}>
              Sigo aquí
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
