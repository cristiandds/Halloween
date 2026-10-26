# Sistema QR de terror para eventos

Aplicación web de ejemplo: el invitado escanea un QR, escribe su nombre y el sistema lo pone en una cola. La pantalla de proyección muestra cada nombre y una frase aleatoria durante 15 segundos. Cuando no hay más nombres, vuelve al QR.

## Importante antes de usarlo en un evento real

- Este proyecto es una base funcional para pruebas, no un servicio ya desplegado.
- Para que los celulares funcionen desde cualquier lugar, debes publicar la aplicación en un servicio de hosting.
- La cola se guarda en memoria: si el servidor se reinicia, la cola se pierde.
- Cambia `SCREEN_TOKEN` por una contraseña larga y privada en el hosting.
- Añade límites y protección contra abuso antes de usarlo en un evento público grande.
- La dirección del QR se genera usando la dirección pública del hosting. No funcionará para invitados si lo abres solo como `localhost`.

## A. Instalar herramientas en Windows

1. Instala Node.js LTS: https://nodejs.org/en/download
2. Instala Visual Studio Code: https://code.visualstudio.com/
3. Descomprime el ZIP en una carpeta sencilla, por ejemplo `C:\\QR-Terror`.
4. Abre VS Code y selecciona **File > Open Folder**. Abre la carpeta `QR-Terror`.
5. En VS Code, abre **Terminal > New Terminal**.

## B. Ejecutarlo localmente para probar

### Instalar dependencias
```bash
npm install
```

### Configurar variables de entorno (opcional)
Copia el archivo de ejemplo y ajusta los valores si lo necesitas:

```bash
cp .env.example .env
```

En Windows (PowerShell):
```powershell
Copy-Item .env.example .env
```

### Ejecutar
```bash
npm start
```

O en modo desarrollo:
```bash
npm run dev
```

Para configurar el token de pantalla, puedes usar variables de entorno. En cmd:
```bash
set SCREEN_TOKEN=mi-token-largo-privado
npm start
```

En PowerShell:
```powershell
$env:SCREEN_TOKEN="mi-token-largo-privado"
npm start
```

Abre la pantalla de control en tu navegador:
`http://localhost:3000/screen?token=mi-token-largo-privado`

Para probar el formulario en la misma laptop:
`http://localhost:3000/join`

Puedes enviar varios nombres desde pestañas diferentes y comprobar que aparecen uno por uno, 15 segundos cada uno. En local, el QR apunta a `localhost`, por lo que no funcionará en otros celulares.

## C. Publicarlo para usar celulares reales

Necesitas desplegar esta carpeta como una aplicación web Node.js en un proveedor que permita ejecutar un servidor persistente con WebSockets, por ejemplo Render:

1. Crea una cuenta en https://render.com/
2. Sube esta carpeta a un repositorio privado de GitHub.
3. En Render crea un **Web Service** conectado al repositorio.
4. Build Command: `npm install`
5. Start Command: `npm start`
6. En Environment Variables añade `SCREEN_TOKEN` con un valor largo y difícil de adivinar.
7. Despliega y espera a que el servicio esté activo.
8. Abre la URL pública que te dé Render y añade `/screen?token=TU_TOKEN`.
9. El QR que aparece en la pantalla contendrá la dirección pública `/join`. Escanéalo con un celular que use datos móviles para probarlo.

No compartas el enlace `/screen?token=...`: es la pantalla de control. Comparte solamente el QR para invitados. No publiques contraseñas en el código ni en repositorios.

## D. Personalizar las frases

Abre `server.js` y busca el arreglo `const phrases = [...]`. Cambia o añade frases entre comillas, separadas por comas. No incluyas contenido que pueda poner en riesgo o humillar a los invitados.

## E. Cambiar los 15 segundos

En `server.js`, cambia:
```js
const DISPLAY_SECONDS = 15;
```
Por la duración deseada, por ejemplo `12` o `20`.

## F. Proyección con Resolume Arena

1. Abre la URL `/screen?token=TU_TOKEN` en Chrome o Edge.
2. Pulsa F11 para pantalla completa.
3. En Resolume, captura esa ventana o pantalla con la fuente de captura disponible en tu configuración.
4. Configura la salida de Resolume hacia la pantalla LED.
5. Prueba la lectura del QR desde un celular antes del evento.

## Limitaciones conocidas

- La cola es volátil y no persiste tras reiniciar el servidor.
- El QR necesita internet para cargar la librería que lo dibuja.
- Esta versión no tiene panel administrativo ni bloqueo de envíos repetidos.
- El token protege la ruta de proyección de forma básica; para una instalación pública profesional conviene añadir autenticación, moderación, límites de frecuencia y persistencia.
