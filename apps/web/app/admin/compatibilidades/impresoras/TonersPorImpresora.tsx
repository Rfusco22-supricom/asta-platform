'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CartuchoElegible, EstadoRevision, ImpresoraConToners, TonerDeImpresora } from '@asta/shared-types';
import { money } from '@/lib/formato';

/**
 * «Impresora | Tóners compatibles»: cada fila es una impresora, y sus tóners se
 * eligen en un selector, como un select de varios.
 *
 * Se trabaja así: se miran los sugeridos (lo que trajeron las listas del
 * fabricante y los importadores), se marcan los que sirven, se busca o se crea
 * el que falta, y se guarda. Al guardar queda EXACTAMENTE lo marcado: lo marcado,
 * validado; lo sugerido o validado que no se marcó, descartado. Antes de pulsar,
 * la fila dice qué va a pasar.
 *
 * Cada tóner dice si tiene producto ASTA, porque el kiosco solo ofrece ASTA.
 *
 * Teclado: ↑ ↓ para moverse por la lista, Intro para marcar, Esc para cerrar,
 * Retroceso con el campo vacío quita el último, y ⌘/Ctrl + Intro guarda la fila.
 */

const TIPO: Record<CartuchoElegible['tipo'], string> = { TONER: 'Tóner', TINTA: 'Tinta', DRUM: 'Tambor', OTRO: 'Otro' };
const ESTADO: Record<EstadoRevision, string> = { PROPUESTA: 'Sugerido', VALIDADA: 'Validado', RECHAZADA: 'Descartado' };
const MARCAS_HABITUALES = ['HP', 'Canon', 'Epson', 'Brother', 'Samsung', 'Xerox', 'Lexmark', 'Kyocera', 'Ricoh', 'Pantum'];

const normalizar = (s: string) => s.normalize('NFD').toLowerCase().replace(/[^a-z0-9]/g, '');

interface Nuevo {
  clave: string;
  marca: string;
  codigo: string;
  tipo: CartuchoElegible['tipo'];
}

/**
 * De dónde salió la sugerencia, en palabras. Cada importador la apunta a su
 * manera en `sourceRef`:
 *
 *   compatibilidad_productos #81: HP LaserJet…  → tabla de compatibilidades · HP LaserJet…
 *   product.template #108153: L1110, L3110      → del nombre del producto: L1110, L3110
 *   https://support.hp.com/…                    → lista del fabricante (support.hp.com)
 */
function origenLegible(t: TonerDeImpresora): string {
  const o = t.origen?.trim();
  if (o) {
    if (/^https?:\/\//.test(o)) {
      try {
        return `lista del fabricante (${new URL(o).hostname.replace(/^www\./, '')})`;
      } catch {
        return 'lista del fabricante';
      }
    }
    return o
      .replace(/^compatibilidad_productos\s+#\d+:\s*/, 'tabla de compatibilidades · ')
      .replace(/^product\.template\s+#\d+:\s*/, 'del nombre del producto: ');
  }
  if (t.propuestaPor) return `propuesto por ${t.propuestaPor}`;
  return { FABRICANTE: 'lista del fabricante', PARSEO: 'leído del nombre del producto', MANUAL: 'añadido a mano', BUSQUEDA: 'búsqueda del kiosco' }[t.fuente];
}

export function TonersPorImpresora({ impresoras, odooDisponible, marcas }: { impresoras: ImpresoraConToners[]; odooDisponible: boolean; marcas: string[] }) {
  const marcasCartucho = useMemo(() => [...new Set([...marcas, ...MARCAS_HABITUALES])], [marcas]);
  return (
    <div className="pi-lista" role="list">
      <div className="pi-cabecera" aria-hidden="true">
        <span>Impresora</span>
        <span>Tóners compatibles</span>
      </div>
      {impresoras.map((i) => (
        <FilaImpresora key={i.printerModelId} inicial={i} odooDisponible={odooDisponible} marcas={marcasCartucho} />
      ))}
    </div>
  );
}

function FilaImpresora({ inicial, odooDisponible, marcas }: { inicial: ImpresoraConToners; odooDisponible: boolean; marcas: string[] }) {
  const router = useRouter();
  const [impresora, setImpresora] = useState(inicial);
  const validadas = (i: ImpresoraConToners) => new Set(i.toners.filter((t) => t.estado === 'VALIDADA').map((t) => t.cartridgeId));
  const [seleccion, setSeleccion] = useState<Set<number>>(() => validadas(inicial));
  const [extras, setExtras] = useState<Map<number, CartuchoElegible>>(new Map());
  const [nuevos, setNuevos] = useState<Nuevo[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState<{ tono: 'ok' | 'error'; texto: string } | null>(null);

  const deLaImpresora = useMemo(() => new Map(impresora.toners.map((t) => [t.cartridgeId, t])), [impresora]);
  const sugeridos = impresora.toners.filter((t) => t.estado === 'PROPUESTA');
  const sugeridosSinMarcar = sugeridos.filter((t) => !seleccion.has(t.cartridgeId));

  const marcados: CartuchoElegible[] = [...seleccion].map((id) => deLaImpresora.get(id) ?? extras.get(id)).filter((c) => c !== undefined);
  const aValidar = marcados.filter((c) => deLaImpresora.get(c.cartridgeId)?.estado !== 'VALIDADA').length + nuevos.length;
  const aDescartar = impresora.toners.filter((t) => t.estado !== 'RECHAZADA' && !seleccion.has(t.cartridgeId));
  // Tocada: lo marcado ya no es lo validado. Una fila con sugeridos sin tocar no
  // tiene «cambios»: tiene trabajo pendiente, y se ofrece resolverlo de un clic.
  const iniciales = validadas(impresora);
  const tocada = nuevos.length > 0 || seleccion.size !== iniciales.size || [...seleccion].some((id) => !iniciales.has(id));

  function alternar(c: CartuchoElegible) {
    setMensaje(null);
    setSeleccion((s) => {
      const n = new Set(s);
      if (n.has(c.cartridgeId)) n.delete(c.cartridgeId);
      else n.add(c.cartridgeId);
      return n;
    });
    if (!deLaImpresora.has(c.cartridgeId)) setExtras((e) => new Map(e).set(c.cartridgeId, c));
  }

  function descartarCambios() {
    setSeleccion(validadas(impresora));
    setExtras(new Map());
    setNuevos([]);
    setMensaje(null);
  }

  async function guardar(compatibles: Set<number> = seleccion) {
    if (guardando || (!tocada && sugeridos.length === 0 && compatibles === seleccion)) return;
    setGuardando(true);
    setMensaje(null);
    try {
      const res = await fetch('/api/compatibilidades/toners', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          printerModelId: impresora.printerModelId,
          vistos: impresora.toners.map((t) => ({ cartridgeId: t.cartridgeId, estado: t.estado })),
          compatibles: [...compatibles],
          nuevos: nuevos.map(({ marca, codigo, tipo }) => ({ marca, codigo, tipo })),
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setMensaje({ tono: 'error', texto: body?.error?.message ?? 'No se pudo guardar.' });
        if (res.status === 409) router.refresh();
        return;
      }
      const { impresora: nueva, validadas: v, rechazadas: r } = body.data as { impresora: ImpresoraConToners; validadas: number; rechazadas: number };
      setImpresora(nueva);
      setSeleccion(validadas(nueva));
      setExtras(new Map());
      setNuevos([]);
      const partes = [v && `${v} validado${v > 1 ? 's' : ''}`, r && `${r} descartado${r > 1 ? 's' : ''}`].filter(Boolean);
      setMensaje({ tono: 'ok', texto: `Guardado${partes.length ? `: ${partes.join(', ')}` : ''}.` });
    } catch {
      setMensaje({ tono: 'error', texto: 'No se pudo contactar con el servidor.' });
    } finally {
      setGuardando(false);
    }
  }

  // Lo que el kiosco hará con esta impresora si se guarda así.
  const conAsta = marcados.some((c) => c.asta);
  const kiosco = !odooDisponible
    ? { clase: 'neutro', texto: 'Kiosco: sin datos de Odoo' }
    : conAsta
      ? { clase: 'bien', texto: 'Kiosco: recomienda ASTA' }
      : marcados.length || nuevos.length
        ? { clase: 'aviso', texto: 'Kiosco: sin ASTA, al mostrador' }
        : impresora.seVende
          ? { clase: 'neutro', texto: 'Kiosco: sale, sin tóner' }
          : { clase: 'neutro', texto: 'Kiosco: no sale' };

  const revisada = sugeridos.length === 0 && !tocada && impresora.toners.some((t) => t.estado === 'VALIDADA');

  return (
    <article
      role="listitem"
      className={`pi-fila${tocada ? ' con-cambios' : ''}${revisada ? ' revisada' : ''}`}
      aria-label={`${impresora.marca} ${impresora.nombre}`}
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
          e.preventDefault();
          void guardar();
        }
      }}
    >
      <div className="pi-impresora">
        <div className="pi-marca">{impresora.marca}</div>
        <div className="pi-nombre">{impresora.nombre}</div>
        <div className="pi-insignias">
          {impresora.seVende && <span className="pi-insignia tienda">Se vende en tienda</span>}
          <span className={`pi-insignia kiosco ${kiosco.clase}`}>{kiosco.texto}</span>
        </div>
        {impresora.ventas12m > 0 && <div className="pi-ventas">{money(impresora.ventas12m)} en tóners · 12 meses</div>}
      </div>

      <div className="pi-toners">
        <Selector
          toners={impresora.toners}
          seleccion={seleccion}
          marcados={marcados}
          nuevos={nuevos}
          odooDisponible={odooDisponible}
          marcas={marcas}
          marcaPorDefecto={impresora.marca}
          deshabilitado={guardando}
          onAlternar={alternar}
          onCrear={(n) => {
            setMensaje(null);
            setNuevos((xs) => (xs.some((x) => normalizar(x.codigo) === normalizar(n.codigo) && x.marca === n.marca) ? xs : [...xs, n]));
          }}
          onQuitarNuevo={(clave) => setNuevos((xs) => xs.filter((x) => x.clave !== clave))}
        />

        {sugeridosSinMarcar.length > 0 && (
          <div className="pi-sugeridos">
            <span className="pi-sugeridos-titulo">Sugeridos</span>
            {sugeridosSinMarcar.map((t) => (
              <button key={t.cartridgeId} type="button" className="pi-sugerido" disabled={guardando} onClick={() => alternar(t)} title={origenLegible(t)}>
                <span aria-hidden="true">＋</span> {t.codigo}
                {odooDisponible && t.asta && <span className="pi-asta-mini">ASTA</span>}
              </button>
            ))}
            {sugeridosSinMarcar.length > 1 && (
              <button
                type="button"
                className="btn-link"
                disabled={guardando}
                onClick={() => {
                  setMensaje(null);
                  setSeleccion((s) => new Set([...s, ...sugeridosSinMarcar.map((t) => t.cartridgeId)]));
                }}
              >
                Marcar todos
              </button>
            )}
          </div>
        )}

        <div className="pi-pie">
          <span className="pi-resumen" aria-live="polite">
            {mensaje ? (
              <span className={`pi-mensaje ${mensaje.tono}`} role={mensaje.tono === 'error' ? 'alert' : 'status'}>
                {mensaje.tono === 'ok' ? '✓ ' : ''}
                {mensaje.texto}
              </span>
            ) : tocada ? (
              <>
                Al guardar:
                {aValidar > 0 && <span className="pi-va valida">✓ valida {aValidar}</span>}
                {aDescartar.length > 0 && (
                  <span className="pi-va descarta" title={aDescartar.map((t) => t.codigo).join(', ')}>
                    ✕ descarta {aDescartar.length}
                  </span>
                )}
                {aValidar === 0 && aDescartar.length === 0 && 'no cambia nada'}
              </>
            ) : sugeridos.length > 0 ? (
              `${sugeridos.length} ${sugeridos.length === 1 ? 'sugerido' : 'sugeridos'} por revisar`
            ) : revisada ? (
              <span className="pi-mensaje ok">✓ Revisada</span>
            ) : impresora.toners.length === 0 ? (
              'Sin tóner todavía: búscalo o créalo en el selector.'
            ) : null}
          </span>
          {tocada ? (
            <span className="pi-botones">
              <button type="button" className="btn-link" disabled={guardando} onClick={descartarCambios}>
                Deshacer
              </button>
              <button type="button" className="btn btn-inline" disabled={guardando} onClick={() => void guardar()} title="⌘/Ctrl + Intro">
                {guardando ? 'Guardando…' : 'Guardar'}
              </button>
            </span>
          ) : sugeridos.length > 0 ? (
            <span className="pi-botones">
              <button
                type="button"
                className="btn-link pi-ninguno"
                disabled={guardando}
                onClick={() => void guardar(new Set(iniciales))}
                title={`Descarta ${sugeridos.map((t) => t.codigo).join(', ')}`}
              >
                Ninguno sirve
              </button>
              <button
                type="button"
                className="btn btn-inline btn-validar"
                disabled={guardando}
                onClick={() => void guardar(new Set([...iniciales, ...sugeridos.map((t) => t.cartridgeId)]))}
              >
                {guardando ? 'Guardando…' : sugeridos.length === 1 ? 'Validar sugerido' : `Validar los ${sugeridos.length}`}
              </button>
            </span>
          ) : null}
        </div>
      </div>
    </article>
  );
}

interface Opcion {
  id: string;
  tipo: 'toner' | 'crear';
  cartucho?: CartuchoElegible;
  estado?: EstadoRevision;
  nota?: string;
  grupo: string;
}

function Selector({
  toners,
  seleccion,
  marcados,
  nuevos,
  odooDisponible,
  marcas,
  marcaPorDefecto,
  deshabilitado,
  onAlternar,
  onCrear,
  onQuitarNuevo,
}: {
  toners: TonerDeImpresora[];
  seleccion: Set<number>;
  marcados: CartuchoElegible[];
  nuevos: Nuevo[];
  odooDisponible: boolean;
  marcas: string[];
  marcaPorDefecto: string;
  deshabilitado: boolean;
  onAlternar: (c: CartuchoElegible) => void;
  onCrear: (n: Nuevo) => void;
  onQuitarNuevo: (clave: string) => void;
}) {
  const id = useId();
  const raiz = useRef<HTMLDivElement>(null);
  const campo = useRef<HTMLInputElement>(null);
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState('');
  const [activa, setActiva] = useState(0);
  const [resultados, setResultados] = useState<CartuchoElegible[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [creando, setCreando] = useState<{ codigo: string; marca: string; tipo: CartuchoElegible['tipo'] } | null>(null);

  // Cerrar al hacer clic fuera.
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => {
      if (raiz.current && !raiz.current.contains(e.target as Node)) {
        setAbierto(false);
        setCreando(null);
      }
    };
    document.addEventListener('mousedown', fuera);
    return () => document.removeEventListener('mousedown', fuera);
  }, [abierto]);

  // Buscar en todos los tóners, con una pausa corta para no pedir en cada tecla.
  useEffect(() => {
    const q = texto.trim();
    if (q.length < 2) {
      setResultados([]);
      return;
    }
    let vigente = true;
    setBuscando(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/compatibilidades/toners?q=${encodeURIComponent(q)}`);
        const body = await res.json().catch(() => null);
        if (vigente && res.ok) setResultados(body?.data ?? []);
      } finally {
        if (vigente) setBuscando(false);
      }
    }, 180);
    return () => {
      vigente = false;
      clearTimeout(t);
    };
  }, [texto]);

  const q = normalizar(texto);
  const propios = new Set(toners.map((t) => t.cartridgeId));
  const opciones: Opcion[] = [
    ...toners
      .filter((t) => !q || normalizar(t.codigo).includes(q))
      .map((t) => ({ id: `t${t.cartridgeId}`, tipo: 'toner' as const, cartucho: t, estado: t.estado, nota: origenLegible(t), grupo: 'De esta impresora' })),
    ...resultados
      .filter((c) => !propios.has(c.cartridgeId))
      .map((c) => ({ id: `r${c.cartridgeId}`, tipo: 'toner' as const, cartucho: c, grupo: 'Otros tóners' })),
  ];
  const exacto = opciones.some((o) => o.cartucho && normalizar(o.cartucho.codigo) === q) || nuevos.some((n) => normalizar(n.codigo) === q);
  if (texto.trim().length >= 2 && !exacto && !buscando) opciones.push({ id: 'crear', tipo: 'crear', grupo: 'No está' });

  const activaSegura = Math.min(activa, Math.max(0, opciones.length - 1));

  function elegir(o: Opcion) {
    if (o.tipo === 'crear') {
      setCreando({ codigo: texto.trim().toUpperCase(), marca: marcaPorDefecto, tipo: 'TONER' });
      return;
    }
    onAlternar(o.cartucho!);
    setTexto('');
    campo.current?.focus();
  }

  function confirmarNuevo() {
    if (!creando || creando.codigo.trim().length < 2) return;
    onCrear({ clave: `${creando.marca}:${creando.codigo}:${Date.now()}`, marca: creando.marca, codigo: creando.codigo.trim(), tipo: creando.tipo });
    setCreando(null);
    setTexto('');
    campo.current?.focus();
  }

  const grupos = [...new Set(opciones.map((o) => o.grupo))];

  return (
    <div className={`pi-selector${abierto ? ' abierto' : ''}`} ref={raiz}>
      <div
        className="pi-campo"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) {
            e.preventDefault();
            campo.current?.focus();
            setAbierto(true);
          }
        }}
      >
        {marcados.map((c) => (
          <span key={c.cartridgeId} className={`pi-chip${c.asta && odooDisponible ? ' asta' : ''}`}>
            <span className="pi-chip-codigo">{c.codigo}</span>
            {odooDisponible && (c.asta ? <span className="pi-asta-mini" title={c.asta.nombre}>ASTA</span> : <span className="pi-sin-asta" title="Sin producto ASTA validado: el kiosco manda al mostrador">sin ASTA</span>)}
            <button type="button" className="pi-chip-quitar" aria-label={`Quitar ${c.codigo}`} disabled={deshabilitado} onClick={() => onAlternar(c)}>
              ×
            </button>
          </span>
        ))}
        {nuevos.map((n) => (
          <span key={n.clave} className="pi-chip nuevo" title="Se crea al guardar">
            <span className="pi-chip-codigo">{n.codigo}</span>
            <span className="pi-nuevo-mini">nuevo · {n.marca}</span>
            <button type="button" className="pi-chip-quitar" aria-label={`Quitar ${n.codigo}`} disabled={deshabilitado} onClick={() => onQuitarNuevo(n.clave)}>
              ×
            </button>
          </span>
        ))}
        <input
          ref={campo}
          className="pi-entrada"
          role="combobox"
          aria-expanded={abierto}
          aria-controls={`${id}-lista`}
          aria-activedescendant={abierto && opciones[activaSegura] ? `${id}-${opciones[activaSegura]!.id}` : undefined}
          aria-autocomplete="list"
          aria-label="Buscar o añadir un tóner"
          placeholder={marcados.length || nuevos.length ? 'Añadir otro…' : 'Elige los tóners compatibles…'}
          value={texto}
          disabled={deshabilitado}
          onFocus={() => setAbierto(true)}
          onChange={(e) => {
            setTexto(e.target.value);
            setActiva(0);
            setAbierto(true);
            setCreando(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setAbierto(true);
              setActiva((a) => Math.min(a + 1, opciones.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActiva((a) => Math.max(a - 1, 0));
            } else if (e.key === 'Enter' && !(e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              if (creando) confirmarNuevo();
              else if (abierto && opciones[activaSegura]) elegir(opciones[activaSegura]!);
            } else if (e.key === 'Escape') {
              setAbierto(false);
              setCreando(null);
            } else if (e.key === 'Backspace' && texto === '') {
              const ultimo = nuevos.at(-1);
              if (ultimo) onQuitarNuevo(ultimo.clave);
              else if (marcados.at(-1)) onAlternar(marcados.at(-1)!);
            }
          }}
        />
        <span className="pi-flecha" aria-hidden="true">
          ▾
        </span>
      </div>

      {abierto && (
        <div className="pi-desplegable">
          {creando ? (
            <div className="pi-crear" role="group" aria-label="Crear un tóner nuevo">
              <div className="pi-crear-titulo">
                Crear el tóner <strong>{creando.codigo}</strong>
              </div>
              <div className="pi-crear-campos">
                <label>
                  Código
                  <input className="input" value={creando.codigo} onChange={(e) => setCreando({ ...creando, codigo: e.target.value })} />
                </label>
                <label>
                  Marca
                  <select className="select" value={creando.marca} onChange={(e) => setCreando({ ...creando, marca: e.target.value })}>
                    {[...new Set([creando.marca, ...marcas])].map((m) => (
                      <option key={m}>{m}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Tipo
                  <select className="select" value={creando.tipo} onChange={(e) => setCreando({ ...creando, tipo: e.target.value as CartuchoElegible['tipo'] })}>
                    {Object.entries(TIPO).map(([v, t]) => (
                      <option key={v} value={v}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="pi-crear-botones">
                <button type="button" className="btn-link" onClick={() => setCreando(null)}>
                  Volver
                </button>
                <button type="button" className="btn btn-inline" onClick={confirmarNuevo}>
                  Añadir como compatible
                </button>
              </div>
              <p className="pi-crear-nota">Se crea al guardar la fila, ya validado para esta impresora.</p>
            </div>
          ) : (
            <ul className="pi-opciones" role="listbox" id={`${id}-lista`} aria-multiselectable="true" aria-label="Tóners">
              {opciones.length === 0 && (
                <li className="pi-vacio" role="presentation">
                  {buscando ? 'Buscando…' : texto.trim().length >= 2 ? 'Nada con ese código.' : 'Escribe un código: CF258A, TN-2370, 667…'}
                </li>
              )}
              {grupos.map((g) => (
                <li key={g} role="presentation">
                  <div className="pi-grupo">{g}</div>
                  <ul role="presentation">
                    {opciones
                      .filter((o) => o.grupo === g)
                      .map((o) => {
                        const i = opciones.indexOf(o);
                        if (o.tipo === 'crear') {
                          return (
                            <li
                              key={o.id}
                              id={`${id}-${o.id}`}
                              role="option"
                              aria-selected={false}
                              className={`pi-opcion crear${i === activaSegura ? ' activa' : ''}`}
                              onMouseEnter={() => setActiva(i)}
                              onMouseDown={(e) => {
                                e.preventDefault();
                                elegir(o);
                              }}
                            >
                              <span className="pi-mas" aria-hidden="true">
                                ＋
                              </span>
                              Crear el tóner «{texto.trim().toUpperCase()}»
                            </li>
                          );
                        }
                        const c = o.cartucho!;
                        const marcado = seleccion.has(c.cartridgeId);
                        return (
                          <li
                            key={o.id}
                            id={`${id}-${o.id}`}
                            role="option"
                            aria-selected={marcado}
                            className={`pi-opcion${i === activaSegura ? ' activa' : ''}${marcado ? ' marcada' : ''}`}
                            onMouseEnter={() => setActiva(i)}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              elegir(o);
                            }}
                          >
                            <span className={`pi-casilla${marcado ? ' si' : ''}`} aria-hidden="true">
                              {marcado ? '✓' : ''}
                            </span>
                            <span className="pi-opcion-cuerpo">
                              <span className="pi-opcion-linea">
                                <span className="pi-chip-codigo">{c.codigo}</span>
                                <span className="pi-opcion-meta">
                                  {c.marca} · {TIPO[c.tipo]}
                                  {c.color ? ` · ${c.color}` : ''}
                                </span>
                                {odooDisponible && (c.asta ? <span className="pi-asta-mini">ASTA</span> : <span className="pi-sin-asta">sin ASTA</span>)}
                                {o.estado && <span className={`pi-estado ${o.estado.toLowerCase()}`}>{ESTADO[o.estado]}</span>}
                              </span>
                              {(o.nota ?? c.asta?.nombre) && <span className="pi-opcion-nota">{o.nota ?? c.asta?.nombre}</span>}
                            </span>
                          </li>
                        );
                      })}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
