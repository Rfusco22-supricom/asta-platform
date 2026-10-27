import { limpiarEspacios, reglaDe, type AppRole, type ClaveCategoria } from '@asta/shared-types';
import { PiramideCSS } from '@/components/PiramideCSS';
import { COLORES_CATEGORIAS } from '@/components/tres/colores';

/** El nivel, en el orden de las losas de la pirámide (0 = abajo). */
const LOSA: Record<ClaveCategoria, number> = { GENERAL: 0, BRONCE: 1, PLATA: 2, ORO: 3, DIAMANTE: 4 };

/** La categoría que corresponde al rol de la cuenta, para cuando no se pudo calcular. */
const DEL_ROL: Partial<Record<AppRole, ClaveCategoria>> = { GENERAL: 'GENERAL', BRONCE: 'BRONCE', PLATA: 'PLATA', GOLD: 'ORO', DIAMANTE: 'DIAMANTE' };

/**
 * La bienvenida del portal de clientes: quién es y su nivel de ASTA (#131) en
 * la pirámide en relieve.
 *
 * El nivel es el del programa (`categoria`), el mismo del bloque «Tu nivel
 * ASTA» de más abajo. El rol de la cuenta lo pone una pasada diaria, y entre una
 * vez y otra los dos podían decir cosas distintas en la misma pantalla. El rol
 * queda para cuando el programa no se pudo leer.
 */
export function Bienvenida({ nombre, rol, categoria }: { nombre: string; rol: string; categoria: ClaveCategoria | null }) {
  const nivel = categoria ?? DEL_ROL[rol as AppRole] ?? null;
  const losa = nivel ? LOSA[nivel] : null;
  return (
    <section className="panel bienvenida">
      <div className="bienvenida-texto">
        <span className="hero-etiqueta">Portal de clientes ASTA</span>
        <h2>Hola, {limpiarEspacios(nombre)}</h2>
        {nivel && losa !== null && (
          <span className="bienvenida-nivel" style={{ '--c': COLORES_CATEGORIAS[losa] } as React.CSSProperties}>
            <i aria-hidden="true" />
            Tu nivel ASTA: <strong>{reglaDe(nivel).nombre}</strong>
          </span>
        )}
      </div>
      <PiramideCSS activo={losa} />
    </section>
  );
}
