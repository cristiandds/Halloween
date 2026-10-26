# Sistema QR de terror para eventos

Aplicación web de ejemplo: el invitado escanea un QR, escribe su nombre y el sistema lo pone en una cola. La pantalla de proyección muestra cada nombre y una frase aleatoria durante 15 segundos. Cuando no hay más nombres, vuelve al QR.

## Importante antes de usarlo en un evento real

- Este proyecto es una base funcional para pruebas, no un servicio ya desplegado.
- Para que los celulares funcionen desde cualquier lugar, debes publicar la aplicación en un servicio de hosting.
- La cola se guarda en memoria: si el servidor se reinicia, la cola se pierde.
- Define `ADMIN_PASSWORD` y `SESSION_SECRET` con valores largos y privados en el hosting.
- El acceso a la pantalla y al panel privado requiere iniciar sesión en `/login`.
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

Para configurar la contraseña administrativa y el secreto de sesión, puedes usar variables de entorno. En cmd:
```bash
set ADMIN_PASSWORD=una-contraseña-larga-y-privada
set SESSION_SECRET=un-secreto-aleatorio-de-32-o-mas-caracteres
npm start
```

En PowerShell:
```powershell
$env:ADMIN_PASSWORD="una-contraseña-larga-y-privada"
$env:SESSION_SECRET="un-secreto-aleatorio-de-32-o-mas-caracteres"
npm start
```

Abre el acceso privado en tu navegador:
`http://localhost:3000/login`

Después de iniciar sesión podrás abrir `/screen` (proyección) y `/admin` (panel). La pantalla ya no se autentica con `?token=` en la URL: usa una cookie de sesión `HttpOnly` y `SameSite=Strict`. Las sesiones caducan y se invalidan al cerrar sesión.

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
6. En Environment Variables añade `ADMIN_PASSWORD` y `SESSION_SECRET` con valores largos, aleatorios y difíciles de adivinar. Añade también `NODE_ENV=production`, `PUBLIC_BASE_URL=https://tu-dominio` y `TRUST_PROXY=1`.
7. Despliega y espera a que el servicio esté activo.
8. Abre la URL pública `https://tu-dominio/login` e inicia sesión.
9. El QR que aparece en la pantalla contendrá la dirección pública `/join`. Escanéalo con un celular que use datos móviles para probarlo.

No compartas la sesión ni la contraseña administrativa: `/screen` y `/admin` son privados. Comparte solamente el QR para invitados. No publiques contraseñas ni secretos en el código ni en repositorios.

## D. Seguridad y variables relevantes

- `/screen`, `/admin`, `/api/admin/state` y `/api/auth/session` requieren sesión.
- `/screen.html` y otras rutas de archivo equivalentes no están disponibles.
- La sesión usa una cookie opaca, aleatoria, `HttpOnly`, `SameSite=Strict` y `Secure` cuando la petición es HTTPS.
- `ADMIN_PASSWORD` se compara con `scrypt` y tiempo constante. No hay usuario; solo contraseña de administrador.
- El inicio de sesión tiene límite de intentos por IP y respuestas genéricas ante credenciales erróneas.
- Las operaciones privadas que cambian estado exigen origen permitido y token CSRF.
- Socket.IO rechaza conexiones sin sesión y solo envía nombres/frases a clientes autenticados.
- `GET /api/state` devuelve únicamente estado público: si hay alguien en pantalla y cuántos esperan.
- En producción la aplicación rechaza `ADMIN_PASSWORD` o `SESSION_SECRET` ausentes, débiles o de ejemplo.
- Ejecuta `npm test` para comprobar las pruebas funcionales y de seguridad.

Variables principales: `PORT`, `DISPLAY_SECONDS`, `ADMIN_PASSWORD`, `SESSION_SECRET`, `SESSION_TTL_MINUTES`, `PUBLIC_BASE_URL`, `TRUST_PROXY` y `COOKIE_SECURE`.

## E. Personalizar las frases

Abre `src/services/phrase.service.js` y busca el arreglo `const PHRASES = [...]`. Cambia o añade frases entre comillas, separadas por comas. No incluyas contenido que pueda poner en riesgo o humillar a los invitados.

## F. Cambiar los 15 segundos

En `src/config/index.js` puedes cambiar `DISPLAY_SECONDS`, o definirlo con la variable de entorno `DISPLAY_SECONDS`. Por ejemplo:
```bash
set DISPLAY_SECONDS=12
```
Por defecto son 15 segundos.

## G. Proyección con Resolume Arena

1. Inicia sesión en `/login` y abre `/screen` en Chrome o Edge.
2. Pulsa F11 para pantalla completa.
3. En Resolume, captura esa ventana o pantalla con la fuente de captura disponible en tu configuración.
4. Configura la salida de Resolume hacia la pantalla LED.
5. Prueba la lectura del QR desde un celular antes del evento.

## Limitaciones conocidas

- La cola es volátil y no persiste tras reiniciar el servidor.
- El QR necesita internet para cargar la librería que lo dibuja.
- Las sesiones y el límite de intentos se guardan en memoria del proceso.
- La pantalla y el panel privado requieren autenticación; el formulario público sigue abierto.
- Para una instalación pública profesional conviene añadir moderación, límites de frecuencia en los envíos y persistencia.
