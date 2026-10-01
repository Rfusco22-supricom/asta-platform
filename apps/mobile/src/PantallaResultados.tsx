import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { registrarClic, type Config, type Impresora, type ProductoCompatible } from './api.js';
import { AvisoDatosGuardados } from './AvisoDatosGuardados.js';
import type { CacheLocal } from './cache.js';
import type { Informe } from './conexion.js';
import { compatiblesConCache } from './datos.js';
import { clase, codigosDeCartucho, esAsta, ordenarPorStock, titulo } from './producto.js';
import { colorDeStock, TEMA, textoDeStock } from './tema.js';

/**
 * Qué le sirve a la impresora del cliente, y si lo hay aquí (#40, sobre #39).
 *
 * Solo salen compatibilidades verificadas por una persona; de eso se encarga el
 * servidor. Aquí lo que importa es que el cliente vea de un vistazo QUÉ pedir y
 * SI LO HAY, que es a lo que vino. Por eso, de arriba abajo:
 *
 *   · la respuesta corta, el código del cartucho («Usa el CE278A»), que es lo
 *     que dice la caja y lo que entiende cualquiera en el mostrador;
 *   · las opciones, lo que hay en tienda primero (`ordenarPorStock`), cada una
 *     con su marca, si es tóner o polvo, y la existencia en grande;
 *   · al tocar una, queda marcada y el pie dice qué pedir con su código: el
 *     cliente enseña la tablet y el dependiente no tiene que adivinar cuál.
 *
 * Sin precios: la tarifa del cliente es #31. Decirlos mal en piso de venta es
 * peor que no decirlos.
 */

interface Props {
  config: Config;
  cache: CacheLocal;
  impresora: Impresora;
  busquedaId: string | null;
  alVolver: () => void;
  alTocar: () => void;
  alConectar: (informe: Informe) => void;
  /** Cambia al volver la red: la pantalla se pone al día sola (#42). */
  recarga: number;
}

export function PantallaResultados({ config, cache, impresora, busquedaId, alVolver, alTocar, alConectar, recarga }: Props) {
  const { width, height } = useWindowDimensions();
  /** En vertical la respuesta va arriba, a todo lo ancho (ver `PantallaAtraccion`). */
  const vertical = height > width;
  const [productos, setProductos] = useState<ProductoCompatible[] | null>(null);
  const [guardadoEn, setGuardadoEn] = useState<number | null>(null);
  const [fallo, setFallo] = useState<string | null>(null);
  const [elegido, setElegido] = useState<number | null>(null);

  useEffect(() => {
    let vigente = true;
    void (async () => {
      const r = await compatiblesConCache(config, cache, impresora.id, busquedaId, alConectar);
      if (!vigente) return;
      if (r.ok) {
        setProductos(ordenarPorStock(r.datos));
        setGuardadoEn(r.desdeCache ? r.guardadoEn : null);
        setFallo(null);
      } else {
        setFallo(
          r.motivo === 'red' || r.motivo === 'erp'
            ? 'Ahora mismo no podemos consultar esta impresora, y no la habíamos consultado antes. Pregunta en el mostrador.'
            : 'No pudimos consultarlo ahora mismo.',
        );
      }
    })();
    return () => {
      vigente = false;
    };
    // `recarga` cambia cuando vuelve la red: se vuelve a pedir lo mismo, en vivo.
  }, [config, cache, impresora.id, busquedaId, alConectar, recarga]);

  const codigos = productos ? codigosDeCartucho(productos) : [];
  const enTienda = productos?.filter((p) => p.stock !== 'agotado').length ?? 0;
  const productoElegido = productos?.find((p) => p.id === elegido) ?? null;

  return (
    <View style={estilos.todo} onTouchStart={alTocar}>
      <View style={estilos.cabecera}>
        <Pressable
          style={({ pressed }) => [estilos.volver, pressed && { backgroundColor: TEMA.color.azulSuave }]}
          onPress={alVolver}
          accessibilityRole="button"
          accessibilityLabel="Buscar otra impresora"
        >
          <Text style={estilos.textoVolver}>‹ Buscar otra</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={estilos.para}>Para tu impresora</Text>
          <Text style={estilos.impresora} numberOfLines={1} adjustsFontSizeToFit>
            <Text style={estilos.impresoraMarca}>{impresora.marca} </Text>
            {impresora.nombre}
          </Text>
        </View>
      </View>

      {!productos && !fallo && <ActivityIndicator size="large" color={TEMA.color.azul} style={{ marginTop: TEMA.espacio.xl }} />}
      {fallo && <Text style={estilos.fallo}>{fallo}</Text>}

      {productos && productos.length === 0 && (
        // Pasa con las impresoras que vendemos y cuyo tóner aún no se ha
        // validado (#40): el kiosco las encuentra, pero no recomienda nada sin
        // verificar. Que se lea como un paso, no como un error.
        <View style={estilos.vacio}>
          <Text style={estilos.vacioRotulo}>TE AYUDAMOS EN EL MOSTRADOR</Text>
          <Text style={estilos.vacioTitulo}>Aún no tenemos cargado en el kiosco qué tóner le sirve a esta impresora.</Text>
          <Text style={estilos.vacioTexto}>
            Enseña esta pantalla en el mostrador y te decimos cuál es y si lo tenemos:{' '}
            <Text style={estilos.vacioModelo}>
              {impresora.marca} {impresora.nombre}
            </Text>
          </Text>
        </View>
      )}

      {productos && productos.length > 0 && (
        <View style={[estilos.cuerpo, vertical && { flexDirection: 'column' }]}>
          {/* La respuesta corta, a la izquierda: no se mueve al desplazar la lista. */}
          <View style={[estilos.respuesta, vertical && { width: 'auto', alignSelf: 'stretch' }]}>
            <Text style={estilos.rotulo}>{codigos.length === 1 ? 'USA EL CARTUCHO' : 'USA LOS CARTUCHOS'}</Text>
            {codigos.map((c) => (
              <Text key={c} style={estilos.codigo} numberOfLines={1} adjustsFontSizeToFit>
                {c}
              </Text>
            ))}
            <View style={estilos.separador} />
            <Text style={estilos.resumen}>
              <Text style={estilos.resumenFuerte}>
                {productos.length} {productos.length === 1 ? 'opción' : 'opciones'}
              </Text>
              {enTienda > 0
                ? ` · ${enTienda} en tienda`
                : ' · ninguna en tienda ahora: se puede encargar'}
            </Text>
          </View>

          <View style={{ flex: 1, gap: TEMA.espacio.s }}>
            <ScrollView contentContainerStyle={{ gap: TEMA.espacio.s }} onScrollBeginDrag={alTocar}>
              {guardadoEn !== null && <AvisoDatosGuardados guardadoEn={guardadoEn} />}
              {productos.map((p) => (
                <Etiqueta
                  key={p.id}
                  producto={p}
                  impresora={impresora}
                  elegido={p.id === elegido}
                  alPulsar={() => {
                    alTocar();
                    setElegido(p.id);
                    // Sin conexión no se registra: el clic se perdería y no merece
                    // una cola que sobreviva a la sesión (#41).
                    if (guardadoEn === null && p.id !== elegido) registrarClic(config, busquedaId, p.id);
                  }}
                />
              ))}
            </ScrollView>

            <View style={[estilos.pie, productoElegido && estilos.pieElegido]}>
              {productoElegido ? (
                <Text style={estilos.pieTexto}>
                  Enseña esta pantalla en el mostrador y pide{' '}
                  <Text style={estilos.pieCodigo}>{productoElegido.sku ?? titulo(productoElegido, impresora)}</Text>
                </Text>
              ) : (
                <Text style={[estilos.pieTexto, { color: TEMA.color.tintaSuave }]}>
                  Toca el que quieras llevarte y enséñale la pantalla al mostrador.
                </Text>
              )}
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

/** Un producto, con la forma de la etiqueta de una caja de tóner. */
function Etiqueta({
  producto: p,
  impresora,
  elegido,
  alPulsar,
}: {
  producto: ProductoCompatible;
  impresora: Impresora;
  elegido: boolean;
  alPulsar: () => void;
}) {
  const stock = colorDeStock(p.stock);
  const asta = esAsta(p);
  const agotado = p.stock === 'agotado';

  return (
    <Pressable
      style={({ pressed }) => [estilos.etiqueta, elegido && estilos.etiquetaElegida, pressed && !elegido && { backgroundColor: TEMA.color.azulSuave }]}
      onPress={alPulsar}
      accessibilityRole="button"
      accessibilityState={{ selected: elegido }}
      accessibilityLabel={`${titulo(p, impresora)}, ${textoDeStock(p.stock)}`}
    >
      <View style={[estilos.franja, { backgroundColor: stock.texto }]} />

      <View style={[estilos.etiquetaCuerpo, agotado && { opacity: 0.62 }]}>
        <View style={estilos.sellos}>
          {asta ? (
            <View style={[estilos.sello, { backgroundColor: TEMA.color.azul }]}>
              <Text style={[estilos.textoSello, { color: TEMA.color.superficie }]}>ASTA</Text>
            </View>
          ) : (
            <View style={[estilos.sello, estilos.selloContorno]}>
              <Text style={[estilos.textoSello, { color: TEMA.color.tinta }]}>{p.tipo === 'original' ? 'ORIGINAL' : 'COMPATIBLE'}</Text>
            </View>
          )}
          {clase(p) === 'polvo' && (
            <View style={[estilos.sello, { backgroundColor: TEMA.color.tecla }]}>
              <Text style={[estilos.textoSello, { color: TEMA.color.tintaSuave }]}>PARA RECARGAR</Text>
            </View>
          )}
        </View>
        <Text style={estilos.titulo} numberOfLines={1}>
          {titulo(p, impresora)}
        </Text>
        <Text style={estilos.nombreErp} numberOfLines={1}>
          {p.nombre}
        </Text>
      </View>

      <View style={[estilos.stock, { backgroundColor: stock.fondo }]}>
        <Text style={[estilos.textoStock, { color: stock.texto }]}>{textoDeStock(p.stock)}</Text>
        {elegido && <Text style={estilos.marcaElegido}>✓ Elegido</Text>}
      </View>
    </Pressable>
  );
}

const estilos = StyleSheet.create({
  todo: { flex: 1, paddingHorizontal: TEMA.espacio.l, paddingBottom: TEMA.espacio.m, gap: TEMA.espacio.m },
  cabecera: { flexDirection: 'row', alignItems: 'center', gap: TEMA.espacio.m, paddingTop: TEMA.espacio.xs },
  para: { color: TEMA.color.tintaTenue, fontSize: 18, fontFamily: TEMA.fuente.fuerte, letterSpacing: 1.5, textTransform: 'uppercase' },
  impresora: { color: TEMA.color.tinta, fontSize: TEMA.texto.titulo, fontFamily: TEMA.fuente.codigo },
  impresoraMarca: { fontFamily: TEMA.fuente.titulo, color: TEMA.color.tintaSuave },
  volver: {
    height: TEMA.alturaBoton - 8,
    paddingHorizontal: TEMA.espacio.m,
    borderRadius: TEMA.radio,
    borderWidth: 2,
    borderColor: TEMA.color.azul,
    backgroundColor: TEMA.color.superficie,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textoVolver: { color: TEMA.color.azulHondo, fontSize: TEMA.texto.etiqueta, fontFamily: TEMA.fuente.titulo },

  cuerpo: { flex: 1, flexDirection: 'row', gap: TEMA.espacio.l },
  respuesta: {
    width: 340,
    alignSelf: 'flex-start',
    backgroundColor: TEMA.color.azul,
    borderRadius: TEMA.radio,
    padding: TEMA.espacio.m,
    gap: TEMA.espacio.xs,
  },
  rotulo: { color: TEMA.color.sobreAzul, fontFamily: TEMA.fuente.fuerte, fontSize: 16, letterSpacing: 2.5 },
  codigo: { color: TEMA.color.superficie, fontFamily: TEMA.fuente.codigo, fontSize: 56, lineHeight: 64 },
  separador: { height: 2, backgroundColor: 'rgba(255,255,255,0.28)', marginVertical: TEMA.espacio.xs },
  resumen: { color: TEMA.color.sobreAzul, fontFamily: TEMA.fuente.cuerpo, fontSize: TEMA.texto.etiqueta, lineHeight: 28 },
  resumenFuerte: { color: TEMA.color.superficie, fontFamily: TEMA.fuente.titulo },

  etiqueta: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: TEMA.color.superficie,
    borderRadius: TEMA.radio,
    borderWidth: 3,
    borderColor: 'transparent',
    overflow: 'hidden',
    minHeight: 112,
  },
  etiquetaElegida: { borderColor: TEMA.color.azul },
  franja: { width: 10 },
  etiquetaCuerpo: { flex: 1, paddingVertical: TEMA.espacio.s, paddingHorizontal: TEMA.espacio.m, gap: 4, justifyContent: 'center' },
  sellos: { flexDirection: 'row', gap: TEMA.espacio.xs },
  sello: { borderRadius: 3, paddingHorizontal: 8, paddingVertical: 2 },
  selloContorno: { borderWidth: 2, borderColor: TEMA.color.tinta, paddingVertical: 0 },
  textoSello: { fontFamily: TEMA.fuente.titulo, fontSize: 14, letterSpacing: 1.5 },
  titulo: { color: TEMA.color.tinta, fontSize: TEMA.texto.cuerpo, fontFamily: TEMA.fuente.titulo },
  nombreErp: { color: TEMA.color.tintaTenue, fontSize: 16, fontFamily: TEMA.fuente.codigoCuerpo },
  stock: { width: 220, alignItems: 'center', justifyContent: 'center', paddingHorizontal: TEMA.espacio.s, gap: 4 },
  textoStock: { fontFamily: TEMA.fuente.titulo, fontSize: TEMA.texto.etiqueta, textAlign: 'center' },
  marcaElegido: { color: TEMA.color.azulHondo, fontFamily: TEMA.fuente.fuerte, fontSize: 16 },

  pie: {
    borderTopWidth: 2,
    borderStyle: 'dashed',
    borderColor: TEMA.color.linea,
    paddingTop: TEMA.espacio.s,
    minHeight: 56,
    justifyContent: 'center',
  },
  pieElegido: { borderColor: TEMA.color.azul },
  pieTexto: { color: TEMA.color.tinta, fontSize: TEMA.texto.etiqueta, fontFamily: TEMA.fuente.medio, lineHeight: 30 },
  pieCodigo: { fontFamily: TEMA.fuente.codigo, color: TEMA.color.azulHondo },

  vacio: {
    gap: TEMA.espacio.s,
    marginTop: TEMA.espacio.m,
    maxWidth: 820,
    backgroundColor: TEMA.color.superficie,
    borderRadius: TEMA.radio,
    borderLeftWidth: 10,
    borderLeftColor: TEMA.color.azul,
    padding: TEMA.espacio.l,
  },
  vacioRotulo: { color: TEMA.color.azulHondo, fontFamily: TEMA.fuente.fuerte, fontSize: 16, letterSpacing: 2.5 },
  vacioTitulo: { color: TEMA.color.tinta, fontSize: TEMA.texto.subtitulo, fontFamily: TEMA.fuente.titulo, lineHeight: 36 },
  vacioTexto: { color: TEMA.color.tintaSuave, fontSize: TEMA.texto.cuerpo, fontFamily: TEMA.fuente.cuerpo, lineHeight: 34 },
  vacioModelo: { color: TEMA.color.tinta, fontFamily: TEMA.fuente.codigoFuerte },
  fallo: { color: TEMA.color.bajo, fontSize: TEMA.texto.cuerpo, fontFamily: TEMA.fuente.fuerte, marginTop: TEMA.espacio.l },
});
