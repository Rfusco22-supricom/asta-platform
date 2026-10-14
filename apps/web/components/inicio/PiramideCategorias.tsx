'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PiramideCristal } from '../tres/PiramideCristal';

/**
 * La pirámide de categorías de ASTA del Inicio: el 3D y su leyenda, juntos.
 *
 * Las dos piezas se señalan la una a la otra: pasar por una lámina resalta su
 * fila en la leyenda y enseña su ficha; pasar por una fila resalta la lámina.
 * Pulsar cualquiera de las dos abre la lista de clientes de esa categoría.
 *
 * La leyenda son enlaces normales: es lo que leen los lectores de pantalla y lo
 * que funciona sin WebGL. El 3D es la forma rápida de verlo, no la única.
 *
 * Las cifras llegan ya escritas desde el servidor: formatearlas aquí daría
 * textos distintos en el servidor y en el navegador, y la hidratación fallaría.
 */

export interface NivelPiramide {
  clave: string;
  nombre: string;
  color: string;
  /** «4 de 12», o «260» sin meta. */
  clientes: string;
  /** «7.053 USD/mes». */
  compra: string;
  /** «meta 24.000 USD/mes». */
  meta: string;
  /** «≥ 1.500/mes y 3 de 4 meses». */
  regla: string;
  /** Avance hacia la meta de clientes, 0–100, o `null` sin meta. */
  avance: number | null;
  href: string;
}

/** `niveles` va de abajo arriba: Cliente general primero, Diamante el último. */
export function PiramideCategorias({ niveles }: { niveles: NivelPiramide[] }) {
  const router = useRouter();
  const [desdeLeyenda, setDesdeLeyenda] = useState<number | null>(null);
  const [desde3D, setDesde3D] = useState<number | null>(null);
  const foco = desde3D ?? desdeLeyenda;
  const ficha = foco === null ? null : niveles[foco];

  return (
    <div className="piramide">
      <div className="piramide-escena">
        <PiramideCristal
          className="piramide-lienzo"
          colores={niveles.map((n) => n.color)}
          centroY={0.7}
          acercar={0.78}
          activo={desdeLeyenda}
          alSenalar={setDesde3D}
          alElegir={(i) => router.push(niveles[i]!.href)}
        />
        {ficha ? (
          <div className="piramide-ficha" style={{ '--c': ficha.color } as React.CSSProperties}>
            <strong>
              <i aria-hidden="true" />
              {ficha.nombre}
            </strong>
            <span className="piramide-ficha-cifra">{ficha.clientes}</span>
            <span>{ficha.compra}</span>
            <small>{ficha.meta}</small>
            <small>{ficha.regla}</small>
          </div>
        ) : (
          <p className="piramide-pista" aria-hidden="true">
            Pasa el ratón por un nivel · arrástrala para girarla
          </p>
        )}
      </div>

      <ol className="piramide-leyenda" aria-label="Categorías de ASTA">
        {niveles
          .map((n, i) => (
            <li key={n.clave}>
              <Link
                href={n.href}
                className={foco === i ? 'activa' : undefined}
                style={{ '--c': n.color } as React.CSSProperties}
                onMouseEnter={() => setDesdeLeyenda(i)}
                onMouseLeave={() => setDesdeLeyenda(null)}
                onFocus={() => setDesdeLeyenda(i)}
                onBlur={() => setDesdeLeyenda(null)}
              >
                <i aria-hidden="true" />
                <span className="piramide-nombre">{n.nombre}</span>
                <span className="piramide-clientes">{n.clientes}</span>
                {n.avance !== null && (
                  <span className="piramide-barra" aria-hidden="true">
                    <span style={{ width: `${n.avance}%` }} />
                  </span>
                )}
                <span className="piramide-compra">{n.compra}</span>
              </Link>
            </li>
          ))
          .reverse()}
      </ol>
    </div>
  );
}
