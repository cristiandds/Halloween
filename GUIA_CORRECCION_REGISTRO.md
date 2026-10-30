# Halloween QR — Corrección de registro múltiple

## Problema encontrado
`public/join.html` solo tenía el botón «Volver a intentar» en el panel de error.
Después de registrar un participante, `public/js/join.js` mostraba el panel de seguimiento,
pero no permitía regresar al formulario. Además, un error 404 o 500 podía dejar
un mensaje «EN PANTALLA» obsoleto.

## Correcciones
- Nuevo botón **+ Registrar otro nombre** visible en el seguimiento.
- Al pulsarlo, se borra **únicamente el seguimiento local** del navegador y
  reaparece el formulario vacío. El registro anterior **no se elimina del servidor**.
- Cuando un turno finaliza o la API devuelve 404, se muestra un mensaje claro
  y el mismo botón permite continuar.
- Si falla la API o la pantalla está desconectada, el móvil no anuncia erróneamente
  «EN PANTALLA».
- Se invalida la caché del JavaScript del formulario usando `?v=4`.
- Se añadió un comando `npm run build` inocuo por compatibilidad con Netlify.
- Pruebas automatizadas de registro múltiple y seguimiento incluidas en `tests/join-ui.test.js`.

## Publicar en Netlify
1. **Descomprime este ZIP** y sube los archivos de su interior a la **raíz**
   del repositorio GitHub `Halloween`, reemplazando los anteriores. No subas
   el ZIP o el RAR directamente al repositorio.
2. Haz un commit: `fix: permitir registrar varios nombres y recuperar formulario`.
3. Netlify iniciará un nuevo despliegue desde la rama `main`.
4. En Netlify: **Publish directory = `public`** y
   **Functions directory = `netlify/functions`**.
   El campo Build command puede quedar vacío o contener `npm run build`.
5. Comprueba que el nuevo deploy sea **Published**.
6. Abre `/screen` en una computadora, luego `/join` desde un celular.
   Registra «Ana», presiona «+ Registrar otro nombre», registra «Luis».
   Confirma que se proyecten por orden y regresen al QR.
7. Si ves la versión anterior, actualiza con Ctrl+Shift+R o prueba en ventana privada.

## Notas de fiabilidad
Esta corrección soluciona el bloqueo de la interfaz y sus estados obsoletos;
no garantiza que Netlify Blobs nunca tenga problemas de sincronización.
Si `/screen` no recibe nombres, revisa los logs de Netlify Functions y `/api/state`.
El almacenamiento compartido de Blobs no ofrece transacciones para colas
con muchos participantes simultáneos.
