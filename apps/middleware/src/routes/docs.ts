import { Router, type Request } from 'express';
import { construirOpenApi } from '../openapi/especificacion.js';
import { paginaDocumentacion } from '../openapi/pagina.js';

/**
 * Documentación pública de la API (#35). Sin autenticación: quien todavía no
 * tiene una key es precisamente quien más la necesita.
 *
 *   GET /api/v1/docs               página navegable
 *   GET /api/v1/docs/openapi.json  especificación OpenAPI 3.1
 *
 * Los ejemplos llevan la URL de ESTE servidor, sacada de la petición: así el
 * `curl` de la página se puede copiar tal cual. `trust proxy` ya está puesto en
 * `server.ts`, de modo que detrás de EasyPanel sale `https` y el dominio público.
 */

function baseDe(req: Request): string {
  return `${req.protocol}://${req.get('host') ?? 'localhost'}`;
}

export function crearDocsRouter(): Router {
  const router = Router();

  router.get('/', (req, res) => {
    res.set('Cache-Control', 'public, max-age=300');
    res.type('html').send(paginaDocumentacion(baseDe(req)));
  });

  router.get('/openapi.json', (req, res) => {
    // La especificación es pública, y la abren visores y generadores de clientes
    // desde otros orígenes. No lleva nada que no esté ya en la página.
    res.set({ 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=300' });
    res.json(construirOpenApi(baseDe(req)));
  });

  return router;
}
