import { ROLE_LABEL, limpiarEspacios, type AppRole } from '@asta/shared-types';
import { PiramideCSS } from '@/components/PiramideCSS';
import { COLORES_CATEGORIAS } from '@/components/tres/colores';

/** El nivel de la cuenta, en el orden de las losas de la pirámide (0 = abajo). */
const LOSA: Partial<Record<AppRole, number>> = { GENERAL: 0, BRONCE: 1, PLATA: 2, GOLD: 3, DIAMANTE: 4 };

/**
 * La bienvenida del portal de clientes: quién es, su nivel de ASTA (#131) con
 * la pirámide en relieve. El nivel ya se ve en el
 * menú del usuario; aquí se ve dónde está dentro de la pirámide. Las reglas de
 * cada nivel NO se enseñan: las comunica Marketing.
 */
export function Bienvenida({ nombre, rol }: { nombre: string; rol: string }) {
  const losa = LOSA[rol as AppRole] ?? null;
  return (
    <section className="panel bienvenida">
      <div className="bienvenida-texto">
        <span className="hero-etiqueta">Portal de clientes ASTA</span>
        <h2>Hola, {limpiarEspacios(nombre)}</h2>
        {losa !== null && (
          <span className="bienvenida-nivel" style={{ '--c': COLORES_CATEGORIAS[losa] } as React.CSSProperties}>
            <i aria-hidden="true" />
            Tu nivel ASTA: <strong>{ROLE_LABEL[rol as AppRole]}</strong>
          </span>
        )}
      </div>
      <PiramideCSS activo={losa} />
    </section>
  );
}
