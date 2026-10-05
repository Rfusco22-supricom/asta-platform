/**
 * Tareas periódicas que corre el propio middleware.
 */

export interface Programacion {
  parar: () => void;
}

/**
 * Corre `pasada` cada `cadaMs`, sin solaparse: si una tarda más que el
 * intervalo (Odoo lento), la siguiente se salta en vez de amontonarse. Un error
 * se escribe y no para el programador: la próxima pasada lo vuelve a intentar.
 *
 * La primera, al cabo de `primeraEnMs`, no al arrancar: un despliegue no tiene
 * por qué empezar golpeando a Odoo ni mandando un correo.
 *
 * Existe porque EasyPanel no tiene programador de tareas para el servicio: lo
 * que estaba pensado para un cron (las alertas de #46, el sync de clientes) no
 * tenía dónde correr, y el sync llevaba desde el 1 de octubre sin pasar.
 */
export function programarCada(
  nombre: string,
  pasada: () => Promise<string>,
  opciones: { cadaMs: number; primeraEnMs: number; escribir?: (linea: string) => void },
): Programacion {
  const escribir = opciones.escribir ?? ((l: string) => console.log(l));
  let enCurso = false;
  const correr = async () => {
    if (enCurso) {
      escribir(`${nombre}: la pasada anterior sigue en curso; esta se salta`);
      return;
    }
    enCurso = true;
    try {
      escribir(await pasada());
    } catch (error) {
      escribir(`${nombre}: la pasada falló: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      enCurso = false;
    }
  };
  let intervalo: ReturnType<typeof setInterval> | undefined;
  const primera = setTimeout(() => {
    void correr();
    intervalo = setInterval(() => void correr(), opciones.cadaMs);
    intervalo.unref?.();
  }, opciones.primeraEnMs);
  primera.unref?.();
  return {
    parar: () => {
      clearTimeout(primera);
      if (intervalo) clearInterval(intervalo);
    },
  };
}
