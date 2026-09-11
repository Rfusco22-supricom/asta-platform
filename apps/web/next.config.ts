import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // shared-types se publica como fuente TypeScript, sin build previo.
  // Sin esto, Next no sabe transpilarlo y falla al importar el contrato.
  transpilePackages: ['@asta/shared-types'],

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
