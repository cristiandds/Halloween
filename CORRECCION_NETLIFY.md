# Corrección: Netlify Blobs y sincronización de participantes

## Problema detectado
En producción aparecía este error al registrar o consultar el estado:

```text
BlobsConsistencyError: missing uncachedEdgeURL when reading with strong consistency
```

La causa era la combinación de dos cosas:

1. Las funciones usaban el formato clásico `exports.handler(event)` (Lambda compatibility).
2. En ese formato se llamaba a `connectLambda(event)`, que solo configura `edgeURL`.
3. Las lecturas con consistencia fuerte (`consistency: 'strong'`) necesitan además `uncachedEdgeURL`.

Netlify Functions v2 entrega el contexto de Blobs mediante `NETLIFY_BLOBS_CONTEXT`, que sí incluye `edgeURL` y `uncachedEdgeURL`. Las funciones clásicas no reciben ese contexto de la misma forma, por eso el SDK lanzaba el error.

## Cambios aplicados

1. **Funciones migradas a Netlify Functions v2**
   - Cada entrada usa `exports.default = async (request) => Response`.
   - Se eliminó `exports.handler` para que Netlify detecte el runtime API v2.
   - `server.js` adapta peticiones Node a `Request`/`Response` para seguir funcionando en local.

2. **Conexión correcta a Netlify Blobs**
   - Se eliminó `connectLambda(event)` y la dependencia de pasar el evento a cada función.
   - El almacenamiento se obtiene con:
     ```js
     getStore({ name: 'halloween-queue', consistency: 'strong' })
     ```
   - El SDK toma el contexto ambiental inyectado por Netlify Functions v2, incluyendo `uncachedEdgeURL`.
   - Se mantiene la consistencia fuerte; no se degradó a consistencia eventual.

3. **Escrituras concurrentes sin perder registros**
   - El estado se lee con `getWithMetadata()` para obtener su ETag.
   - Las escrituras usan `onlyIfNew` o `onlyIfMatch`.
   - Si otra petición gana la carrera, se relee el estado y se reintenta la operación.
   - Esto evita que dos celulares registrándose al mismo tiempo se sobrescriban.

4. **Inscripciones de solo lectura**
   - `/api/inscriptions/status` usa `getInscriptionsStatus()`.
   - Ya no llama a `getAndAdvanceState()`, por lo que consultar inscripciones no avanza ni modifica la cola.

5. **Persistencia compartida real**
   - En Netlify se usa **solo Netlify Blobs**.
   - El archivo local (`.data/halloween-queue.json` o `HALLOWEEN_DATA_FILE`) queda únicamente para desarrollo/pruebas fuera de Netlify.
   - `/join`, `/screen` y `/admin` leen y escriben el mismo estado.

6. **Runtime Node 22**
   - `netlify.toml` fija `NODE_VERSION = "22"`, que es el runtime requerido por `@netlify/blobs` v11.

## Verificación realizada

- `npm test`: **69 pruebas aprobadas**.
- Prueba específica de Blobs con un contexto v2 simulado:
  - confirma que todas las lecturas usan `uncachedEdgeURL`;
  - confirma que se envían `If-None-Match` e `If-Match`;
  - confirma que 15 registros simultáneos se conservan completos.
- Flujo completo verificado en local: varios nombres entran en orden, cada uno dura 15 segundos y la pantalla vuelve al QR.
- Endpoints locales comprobados: `/join`, `/screen`, `/admin`, `/api/state`, `/api/submit`, `/api/participant/status`, `/api/inscriptions/status` y `/api/admin/*`.
- Empaquetado con `zip-it-and-ship-it`: todas las funciones de entrada se detectan como `runtimeAPIVersion=2`.

## Publicación

1. Subir los cambios a la rama `main`.
2. Esperar a que Netlify muestre `Published` en el nuevo despliegue.
3. Abrir `/screen` y después `/join`.
4. Registrar dos nombres distintos y confirmar que aparecen por orden, 15 segundos cada uno, y que luego vuelve el QR.
5. Si aparece un error `500`, revisar **Netlify > Logs > Functions** y buscar `Halloween/Blobs`.

## Limitación

Netlify Blobs no es una base de datos transaccional. El control de concurrencia con ETag evita pérdidas silenciosas y reintenta automáticamente, pero en un pico extremo de escrituras simultáneas una petición podría recibir un error claro para reintentar en lugar de confirmar un registro que no se guardó.
