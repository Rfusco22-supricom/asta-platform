import { join } from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // shared-types se publica como fuente TypeScript, sin build previo.
  // Sin esto, Next no sabe transpilarlo y falla al importar el contrato.
  transpilePackages: ['@asta/shared-types'],

  /**
   * Para el contenedor de producción.
   *
   * Next copia a `.next/standalone` solo lo que la aplicación usa de verdad,
   * con su propio servidor incluido. La alternativa es meter el `node_modules`
   * entero en la imagen — cientos de megas, la mayoría herramientas de
   * desarrollo que en producción no pinta nada tener.
   *
   * En un monorepo de pnpm hay que decirle dónde está la raíz: sin eso rastrea
   * las dependencias desde `apps/web` y se deja fuera todo lo que pnpm enlaza
   * desde arriba, incluido `@asta/shared-types`.
   */
  /*
   * Solo cuando se construye para el contenedor: `BUILD_STANDALONE=1`.
   *
   * `standalone` crea enlaces simbólicos, y en Windows eso exige permisos que no
   * están puestos por defecto — el build falla con `EPERM: symlink`. Activarlo
   * siempre rompería `pnpm build` en las máquinas de desarrollo de todo el
   * equipo para servir a un caso que solo ocurre dentro de Docker.
   *
   * El Dockerfile lo enciende; en local no estorba.
   */
  ...(process.env.BUILD_STANDALONE
    ? {
        output: 'standalone' as const,
        // En un monorepo de pnpm hay que decirle dónde está la raíz: sin eso
        // rastrea desde `apps/web` y se deja fuera lo que pnpm enlaza desde
        // arriba, incluido `@asta/shared-types`.
        outputFileTracingRoot: join(import.meta.dirname, '../..'),
        // El PDF base del catálogo, sus huecos y la tipografía se leen del
        // disco en la ruta de descarga, y el rastreo no ve un `readFile` con la
        // ruta armada: sin esto no entran en la imagen y la descarga da 500
        // solo en producción.
        outputFileTracingIncludes: { '/api/catalogo/[version]': ['./privado/catalogo/**'] },
      }
    : {}),

  reactStrictMode: true,

  // El panel nunca debe anunciar con qué está hecho.
  poweredByHeader: false,

  /**
   * Cabeceras de todas las páginas, y el service worker sin caché.
   *
   *   · Ninguna web ajena puede meter el panel en un iframe (`frame-ancestors`
   *     y `X-Frame-Options`, para navegadores viejos): así nadie le pone una
   *     página falsa encima a un cliente para que pulse donde no quiere.
   *   · Al salir del panel a otra web no se manda la ruta, que puede llevar
   *     ids (`Referrer-Policy`).
   *   · El navegador no adivina tipos de archivo (`nosniff`), siempre HTTPS
   *     (`Strict-Transport-Security`, sin subdominios: no son todos nuestros) y
   *     sin cámara, micrófono ni ubicación, que el panel no usa.
   *
   * No hay CSP de scripts: Next mete scripts en línea y una política estricta
   * pide nonces en cada página. `frame-ancestors` va sola, que no toca nada más.
   *
   * El service worker de la aplicación ASTA web (`/aplicacion/sw.js`), sin
   * caché: una versión nueva tiene que llegar a las tablets en cuanto se
   * despliega.
   */
  async headers() {
    return [
      {
        source: '/:ruta*',
        headers: [
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
      { source: '/aplicacion/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache' }] },
    ];
  },

  webpack: (config) => {
    /**
     * `shared-types` importa con extensión `.js` (`./common.js`) porque el
     * middleware corre como ESM en Node, donde la extensión es obligatoria y
     * debe ser la del archivo COMPILADO, no la del fuente.
     *
     * Webpack no conoce esa convención y busca un `common.js` que no existe.
     * `extensionAlias` le enseña que un `.js` puede resolverse a `.ts`.
     *
     * La alternativa —quitar las extensiones— rompería el middleware en Node.
     * El bundler es quien tiene que adaptarse, no el paquete compartido.
     */
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
};

export default nextConfig;
