'use client';

import { useEffect, useRef } from 'react';
import { COLORES_CATEGORIAS } from './colores';

/**
 * La pirámide de categorías de ASTA, en 3D: cinco láminas de vidrio de color,
 * de Cliente general abajo a Diamante arriba (#131), que giran despacio y se
 * inclinan siguiendo al ratón. Se puede arrastrar para girarla.
 *
 * ── Por qué three.js aquí y en ningún otro sitio ─────────────────────────────
 *
 * El 3D de verdad —luz, reflejos, profundidad— solo está en el acceso y en el
 * Inicio. El resto del panel usa relieve con CSS, que no pesa nada. three.js se
 * importa DENTRO del efecto: va en su propio trozo de JavaScript, se descarga
 * después de pintar la página y nunca entra en las pantallas que no lo usan.
 *
 * ── Lo que hace para no estorbar ─────────────────────────────────────────────
 *
 *   · Se detiene cuando no se ve (otra pestaña, o fuera de la pantalla).
 *   · Con «reducir movimiento» pinta una imagen quieta y no anima.
 *   · Sin WebGL no pinta nada: el fondo de la página sigue ahí.
 *   · Al desmontarse libera la GPU: geometrías, materiales y el contexto.
 *
 * Es decoración: va oculta a los lectores de pantalla.
 */

export function PiramideCristal({
  colores = COLORES_CATEGORIAS,
  desplazamiento = 0,
  centroY = 0.9,
  className,
}: {
  colores?: string[];
  /** Cuánto se corre la pirámide a la derecha (en unidades de la escena), para dejar sitio a un texto. */
  desplazamiento?: number;
  /** A qué altura mira la cámara: más bajo sube la pirámide en el cuadro. */
  centroY?: number;
  className?: string;
}) {
  const caja = useRef<HTMLDivElement>(null);
  const clave = colores.join(',');

  useEffect(() => {
    const cont = caja.current;
    if (!cont) return;
    let vivo = true;
    let limpiar = () => {};

    (async () => {
      const THREE = await import('three');
      const [{ RoomEnvironment }, { RoundedBoxGeometry }] = await Promise.all([
        import('three/examples/jsm/environments/RoomEnvironment.js'),
        import('three/examples/jsm/geometries/RoundedBoxGeometry.js'),
      ]);
      if (!vivo) return;

      let renderer: InstanceType<typeof THREE.WebGLRenderer>;
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
      } catch {
        return; // Sin WebGL: se queda el fondo.
      }

      const quieto = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.NeutralToneMapping;
      renderer.toneMappingExposure = 1;
      cont.appendChild(renderer.domElement);

      const escena = new THREE.Scene();
      const pmrem = new THREE.PMREMGenerator(renderer);
      const entorno = pmrem.fromScene(new RoomEnvironment(), 0.04);
      escena.environment = entorno.texture;

      const camara = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
      const objetivo = new THREE.Vector3(0, centroY, 0);

      escena.add(new THREE.HemisphereLight(0xffffff, 0xb8c8ff, 0.8));
      const sol = new THREE.DirectionalLight(0xffffff, 1.3);
      sol.position.set(4, 8, 6);
      escena.add(sol);

      const piramide = new THREE.Group();
      piramide.position.x = desplazamiento;
      escena.add(piramide);

      const desechables: { dispose: () => void }[] = [entorno, pmrem];

      // Las cinco láminas.
      const lados = [3.0, 2.45, 1.9, 1.35, 0.8];
      const alto = 0.32;
      const hueco = 0.16;
      lados.forEach((lado, i) => {
        const color = new THREE.Color(colores[i] ?? '#ffffff');
        const geo = new RoundedBoxGeometry(lado, alto, lado, 4, 0.07);
        const mat = new THREE.MeshPhysicalMaterial({
          color,
          roughness: 0.22,
          metalness: 0,
          clearcoat: 1,
          clearcoatRoughness: 0.12,
          transparent: true,
          opacity: 0.92,
          emissive: color,
          emissiveIntensity: i === lados.length - 1 ? 0.55 : 0.22,
          envMapIntensity: 0.75,
        });
        const lamina = new THREE.Mesh(geo, mat);
        lamina.position.y = i * (alto + hueco);
        piramide.add(lamina);
        desechables.push(geo, mat);
      });

      // Un brillo cian sobre el Diamante: es la meta, y se ve desde lejos.
      const brillo = new THREE.PointLight(0x7fdbff, 6, 4);
      brillo.position.set(0, (lados.length - 1) * (alto + hueco) + 0.8, 0);
      piramide.add(brillo);

      // La sombra en el suelo: un degradado radial, sin luces de sombra que pesen.
      const lienzo = document.createElement('canvas');
      lienzo.width = lienzo.height = 128;
      const ctx = lienzo.getContext('2d')!;
      const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0, 'rgba(18,52,96,0.32)');
      g.addColorStop(1, 'rgba(18,52,96,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 128, 128);
      const texSombra = new THREE.CanvasTexture(lienzo);
      const geoSombra = new THREE.PlaneGeometry(5.4, 5.4);
      const matSombra = new THREE.MeshBasicMaterial({ map: texSombra, transparent: true, depthWrite: false });
      const sombra = new THREE.Mesh(geoSombra, matSombra);
      sombra.rotation.x = -Math.PI / 2;
      sombra.position.set(desplazamiento, -0.45, 0);
      escena.add(sombra);
      desechables.push(texSombra, geoSombra, matSombra);

      // Cubitos de vidrio que orbitan: dan profundidad a la escena.
      const geoCubo = new RoundedBoxGeometry(1, 1, 1, 3, 0.18);
      desechables.push(geoCubo);
      const tonos = ['#ffffff', '#27a9f1', '#7c5cff', '#ff5c93', '#ffffff', '#7fdbff'];
      const cubos = Array.from({ length: 14 }, (_, i) => {
        const mat = new THREE.MeshPhysicalMaterial({
          color: tonos[i % tonos.length],
          roughness: 0.1,
          clearcoat: 1,
          transparent: true,
          opacity: 0.75,
          envMapIntensity: 1.4,
        });
        desechables.push(mat);
        const m = new THREE.Mesh(geoCubo, mat);
        const escala = 0.1 + ((i * 37) % 10) / 70;
        m.scale.setScalar(escala);
        piramide.add(m);
        return {
          m,
          radio: 2.4 + ((i * 53) % 13) / 10,
          angulo: (i / 14) * Math.PI * 2,
          altura: -0.2 + ((i * 29) % 25) / 10,
          velocidad: 0.08 + ((i * 17) % 7) / 60,
        };
      });

      // Tamaño: el del contenedor, y la cámara se aleja si es estrecho.
      const ajustar = () => {
        const w = cont.clientWidth || 1;
        const h = cont.clientHeight || 1;
        renderer.setSize(w, h, false);
        renderer.domElement.style.width = '100%';
        renderer.domElement.style.height = '100%';
        camara.aspect = w / h;
        const distancia = Math.max(12.5, 10 / Math.min(camara.aspect, 1.25));
        camara.position.set(desplazamiento * 0.6, 3.4, distancia);
        camara.lookAt(objetivo.x + desplazamiento * 0.6, objetivo.y, objetivo.z);
        camara.updateProjectionMatrix();
      };
      ajustar();
      const alCambiarTamano = new ResizeObserver(() => {
        ajustar();
        if (quieto) pintar(0);
      });
      alCambiarTamano.observe(cont);

      // El ratón inclina; arrastrar gira.
      let inclX = 0;
      let inclY = 0;
      let suaveX = 0;
      let suaveY = 0;
      let giro = 0.6;
      let arrastre: { x: number; giro: number } | null = null;
      const lienzoGL = renderer.domElement;
      const mover = (e: PointerEvent) => {
        const r = cont.getBoundingClientRect();
        const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
        const ny = ((e.clientY - r.top) / r.height) * 2 - 1;
        inclY = nx * 0.35;
        inclX = ny * 0.12;
        if (arrastre) giro = arrastre.giro + (e.clientX - arrastre.x) * 0.008;
      };
      const bajar = (e: PointerEvent) => {
        arrastre = { x: e.clientX, giro };
        lienzoGL.setPointerCapture(e.pointerId);
      };
      const subir = () => {
        arrastre = null;
      };
      lienzoGL.addEventListener('pointermove', mover);
      lienzoGL.addEventListener('pointerdown', bajar);
      lienzoGL.addEventListener('pointerup', subir);
      lienzoGL.addEventListener('pointercancel', subir);

      function pintar(t: number) {
        const s = t / 1000;
        suaveX += (inclX - suaveX) * 0.05;
        suaveY += (inclY - suaveY) * 0.05;
        piramide.rotation.y = giro + suaveY;
        piramide.rotation.x = suaveX;
        piramide.position.y = quieto ? 0 : Math.sin(s * 0.8) * 0.08;
        for (const c of cubos) {
          const a = c.angulo + (quieto ? 0 : s * c.velocidad);
          c.m.position.set(Math.cos(a) * c.radio, c.altura + (quieto ? 0 : Math.sin(s + c.radio) * 0.12), Math.sin(a) * c.radio);
          c.m.rotation.set(s * 0.3 + c.radio, s * 0.2 + c.altura, 0);
        }
        renderer.render(escena, camara);
      }

      // El bucle, solo mientras se ve.
      let marco = 0;
      let visible = true;
      let ultimo = performance.now();
      const bucle = (t: number) => {
        if (!arrastre) giro += ((t - ultimo) / 1000) * 0.18;
        ultimo = t;
        pintar(t);
        marco = requestAnimationFrame(bucle);
      };
      const arrancar = () => {
        if (quieto || marco || !visible || document.hidden) return;
        ultimo = performance.now();
        marco = requestAnimationFrame(bucle);
      };
      const parar = () => {
        cancelAnimationFrame(marco);
        marco = 0;
      };
      const alVer = new IntersectionObserver(([e]) => {
        visible = e.isIntersecting;
        if (visible) arrancar();
        else parar();
      });
      alVer.observe(cont);
      const alCambiarPestana = () => (document.hidden ? parar() : arrancar());
      document.addEventListener('visibilitychange', alCambiarPestana);

      // Un primer fotograma siempre, aunque la pestaña empiece en segundo plano:
      // si no, al volver se vería el hueco vacío hasta el siguiente cuadro.
      pintar(performance.now());
      arrancar();

      limpiar = () => {
        parar();
        alVer.disconnect();
        alCambiarTamano.disconnect();
        document.removeEventListener('visibilitychange', alCambiarPestana);
        lienzoGL.removeEventListener('pointermove', mover);
        lienzoGL.removeEventListener('pointerdown', bajar);
        lienzoGL.removeEventListener('pointerup', subir);
        lienzoGL.removeEventListener('pointercancel', subir);
        for (const d of desechables) d.dispose();
        renderer.dispose();
        lienzoGL.remove();
      };
    })();

    return () => {
      vivo = false;
      limpiar();
    };
    // `clave` resume `colores`: un array nuevo con los mismos colores no reinicia la escena.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave, desplazamiento, centroY]);

  return <div ref={caja} className={className} aria-hidden="true" />;
}
