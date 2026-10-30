# Corrección: no aparecen los nombres en pantalla

## Problema detectado
La versión anterior solo ejecutaba `connectLambda(event)` si `event.blobs` existía. En funciones Lambda compatibles, Netlify Blobs requiere `connectLambda(event)` antes de `getStore`. Si fallaba el almacenamiento, el código continuaba usando un archivo local de una instancia aislada. El celular, el panel y la pantalla podían leer datos distintos, produciendo `Registro no disponible`, `Pantalla desconectada` y `En espera: 0`.

## Cambios
1. Inicialización de `connectLambda(event)` antes de acceder a Blobs en funciones Netlify.
2. El almacenamiento en producción es **solo Netlify Blobs**, con lecturas fuertes.
3. Los errores de conexión y escritura se muestran como error de API y se registran en Functions logs; **ya no se confirma falsamente un registro**.
4. Archivos locales únicamente en desarrollo/pruebas.

## Publicación
1. Descomprimir ZIP y reemplazar contenidos en la raíz del repositorio GitHub.
2. Commit: `fix: corregir persistencia compartida y conexión de proyección`.
3. Esperar que Netlify muestre `Published` en el nuevo despliegue.
4. Abrir `/screen` y después `/join`. Registrar dos nombres distintos; deben aparecer por orden y 15 segundos cada uno.
5. Si aparece `500`, ir a Netlify > Logs > Functions y buscar `Halloween/Blobs`; compartir **solo el mensaje de error**, sin tokens ni contraseñas.

## Limitación
Esta corrección elimina la falsa persistencia local y corrige la inicialización Lambda. Netlify Blobs no es una base de datos transaccional: envíos o lecturas-escrituras muy simultáneas aún podrían sobrescribirse. Si se requieren garantías estrictas para eventos concurridos, se necesita un almacenamiento transaccional o un mecanismo robusto de control de concurrencia.
