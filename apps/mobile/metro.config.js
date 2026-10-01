// Configuración de Metro para la app del kiosco dentro del monorepo.
//
// El código importa con extensión `.js` (`import App from './App.js'`), la
// convención de TypeScript con módulos ES que también entiende Vitest, aunque el
// fichero real sea `App.tsx`. Metro no hace esa traducción y fallaba con
// «Unable to resolve module ./App.js»: la app no llegaba a empaquetarse.
//
// Para cada import relativo que acaba en `.js` se prueba primero sin la
// extensión, que Metro resuelve a `.ts`/`.tsx`, y si no hay nada se cae al
// resolvedor normal (por si algún día hay un `.js` de verdad).
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith('.') && moduleName.endsWith('.js')) {
    try {
      return context.resolveRequest(context, moduleName.slice(0, -3), platform);
    } catch {
      // Sin equivalente .ts/.tsx: se intenta tal cual.
    }
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
