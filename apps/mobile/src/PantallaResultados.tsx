import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { registrarClic, type Config, type Impresora, type ProductoCompatible } from './api.js';
import { AvisoDatosGuardados } from './AvisoDatosGuardados.js';
import type { CacheLocal } from './cache.js';
import { compatiblesConCache } from './datos.js';
import { colorDeStock, TEMA, textoDeStock } from './tema.js';

/**
 * Qué le sirve a la impresora del cliente, y si lo hay aquí (#40, sobre #39).
 *
 * Solo salen compatibilidades verificadas por una persona; de eso se encarga el
 * servidor. Aquí lo que importa es que el cliente vea de un vistazo QUÉ pedir y
 * SI LO HAY, que es a lo que vino.
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
  alConectar: (ok: boolean) => void;
  /** Cambia al volver la red: la pantalla se pone al día sola (#42). */
  recarga: number;
}

export function PantallaResultados({ config, cache, impresora, busquedaId, alVolver, alTocar, alConectar, recarga }: Props) {
  const [productos, setProductos] = useState<ProductoCompatible[] | null>(null);
  const [guardadoEn, setGuardadoEn] = useState<number | null>(null);
  const [fallo, setFallo] = useState<string | null>(null);

  useEffect(() => {
    let vigente = true;
    void (async () => {
      const r = await compatiblesConCache(config, cache, impresora.id, busquedaId, alConectar);
      if (!vigente) return;
      if (r.ok) {
        setProductos(r.datos);
        setGuardadoEn(r.desdeCache ? r.guardadoEn : null);
        setFallo(null);
      } else {
        setFallo(
          r.motivo === 'red'
            ? 'Sin conexión, y esta impresora no la habíamos consultado antes. Pregunta en el mostrador.'
            : 'No pudimos consultarlo ahora mismo.',
        );
      }
    })();
    return () => {
      vigente = false;
    };
    // `recarga` cambia cuando vuelve la red: se vuelve a pedir lo mismo, en vivo.
  }, [config, cache, impresora.id, busquedaId, alConectar, recarga]);

  return (
    <View style={estilos.todo} onTouchStart={alTocar}>
      <View style={estilos.cabecera}>
        <View style={{ flex: 1 }}>
          <Text style={estilos.para}>Para tu</Text>
          <Text style={estilos.impresora}>
            {impresora.marca} {impresora.nombre}
          </Text>
        </View>
        <Pressable style={estilos.volver} onPress={alVolver} accessibilityRole="button">
          <Text style={estilos.textoVolver}>Buscar otra</Text>
        </Pressable>
      </View>

      {!productos && !fallo && <ActivityIndicator size="large" color={TEMA.color.acento} style={{ marginTop: TEMA.espacio.xl }} />}
      {fallo && <Text style={estilos.fallo}>{fallo}</Text>}

      {productos && productos.length === 0 && (
        <Text style={estilos.fallo}>Todavía no tenemos cargado qué tóner le sirve a esta impresora. Pregunta en el mostrador.</Text>
      )}

      {productos && productos.length > 0 && (
        <ScrollView contentContainerStyle={{ gap: TEMA.espacio.s }} onScrollBeginDrag={alTocar}>
          {guardadoEn !== null && <AvisoDatosGuardados guardadoEn={guardadoEn} />}
          {productos.map((p) => (
            <Pressable
              key={p.id}
              style={estilos.tarjeta}
              onPress={() => {
                alTocar();
                // Sin conexión no se registra: el clic se perderia y no merece
                // una cola que sobreviva a la sesión (#41).
                if (guardadoEn === null) registrarClic(config, busquedaId, p.id);
              }}
              accessibilityRole="button"
            >
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={estilos.nombre}>{p.nombre}</Text>
                <Text style={estilos.detalle}>
                  {p.tipo === 'original' ? 'Original' : 'Compatible'}
                  {p.cartuchos.length > 0 ? ` · ${p.cartuchos.map((c) => c.codigo).join(', ')}` : ''}
                  {p.sku ? ` · ${p.sku}` : ''}
                </Text>
              </View>
              <View style={[estilos.estado, { backgroundColor: colorDeStock(p.stock) }]}>
                <Text style={estilos.textoEstado}>{textoDeStock(p.stock)}</Text>
              </View>
            </Pressable>
          ))}
          <Text style={estilos.pie}>Enseña esta pantalla en el mostrador para que te lo preparen.</Text>
        </ScrollView>
      )}
    </View>
  );
}

const estilos = StyleSheet.create({
  todo: { flex: 1, padding: TEMA.espacio.l, gap: TEMA.espacio.m },
  cabecera: { flexDirection: 'row', alignItems: 'center', gap: TEMA.espacio.m },
  para: { color: TEMA.color.textoTenue, fontSize: TEMA.texto.etiqueta },
  impresora: { color: TEMA.color.texto, fontSize: TEMA.texto.titulo, fontWeight: '700' },
  volver: {
    height: TEMA.alturaBoton,
    paddingHorizontal: TEMA.espacio.m,
    borderRadius: TEMA.radio,
    borderWidth: 2,
    borderColor: TEMA.color.acento,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textoVolver: { color: TEMA.color.acento, fontSize: TEMA.texto.cuerpo, fontWeight: '600' },
  tarjeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: TEMA.espacio.m,
    backgroundColor: TEMA.color.superficie,
    borderRadius: TEMA.radio,
    padding: TEMA.espacio.m,
    minHeight: TEMA.alturaBoton + 16,
  },
  nombre: { color: TEMA.color.texto, fontSize: TEMA.texto.subtitulo, fontWeight: '600' },
  detalle: { color: TEMA.color.textoTenue, fontSize: TEMA.texto.etiqueta },
  estado: { borderRadius: TEMA.radio, paddingHorizontal: TEMA.espacio.m, paddingVertical: TEMA.espacio.xs },
  textoEstado: { color: TEMA.color.fondo, fontSize: TEMA.texto.etiqueta, fontWeight: '700' },
  fallo: { color: TEMA.color.bajo, fontSize: TEMA.texto.cuerpo, marginTop: TEMA.espacio.l },
  pie: { color: TEMA.color.textoTenue, fontSize: TEMA.texto.etiqueta, marginTop: TEMA.espacio.m, textAlign: 'center' },
});
