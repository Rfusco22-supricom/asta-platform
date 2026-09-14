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
      }
    : {}),

  reactStrictMode: true,

  // El panel nunca debe anunciar con qué está hecho.
  poweredByHeader: false,

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
