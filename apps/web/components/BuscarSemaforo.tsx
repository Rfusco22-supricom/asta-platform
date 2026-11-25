'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { empezarCarga } from '@/components/CargaGlobal';

/**
 * El buscador del semáforo de clientes. Filtra mientras se escribe, pero en el
 * SERVIDOR (`?q=`): la tabla enseña los primeros 200, y buscar solo entre esos
 * no encontraría al resto. Conserva el color, el tamaño y la sede.
 */

const PAUSA_MS = 400;

export function BuscarSemaforo({ inicial, conVendedor, cuenta }: { inicial: string; conVendedor: boolean; cuenta: string }) {
  const router = useRouter();
  const ruta = usePathname();
  const params = useSearchParams();
  const [texto, setTexto] = useState(inicial);
  const ultimo = useRef(inicial);

  useEffect(() => {
    const q = texto.trim();
    if (q === ultimo.current) return;
    const t = setTimeout(() => {
      ultimo.current = q;
      const nuevos = new URLSearchParams(params.toString());
      if (q) nuevos.set('q', q);
      else nuevos.delete('q');
      const s = nuevos.toString();
      empezarCarga();
      router.replace(s ? `${ruta}?${s}` : ruta, { scroll: false });
    }, PAUSA_MS);
    return () => clearTimeout(t);
  }, [texto, params, ruta, router]);

  return (
    <div className="toolbar">
      <input
        className="input semaforo-buscar"
        type="search"
        placeholder={conVendedor ? 'Buscar cliente o vendedor…' : 'Buscar cliente…'}
        aria-label="Buscar en el semáforo"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
      />
      <span className="count">{cuenta}</span>
    </div>
  );
}
