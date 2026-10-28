# 🎃 Halloween QR • Sistema de Invocación y Proyección en Pantalla LED

Sistema web cinematográfico de terror para eventos en vivo de Halloween. Los invitados escanean un código QR desde cualquier celular, invocan su nombre y este aparece proyectado en una pantalla gigante (o capturado vía **Resolume Arena**) junto a una frase espeluznante durante **15 segundos**, avanzando automáticamente en orden de llegada y regresando al código QR cuando la cola se vacía.

Diseñado con **HTML5, CSS3 y JavaScript nativo**, optimizado para el plan **Netlify Free** y con soporte completo de captura para VJs y pantallas LED.

---

## 🚀 Características Principales

1. **100% Nativo y Ligero:** Sin React, Vue, Angular, TypeScript ni Tailwind. Código limpio, modular y ultrarrápido.
2. **Generación Local de QR:** Sin dependencias de CDN externas. Genera el QR automáticamente con el dominio real de producción (`https://DOMINIO.netlify.app/join`) o la red local.
3. **Formulario Móvil Adaptado (`/join`):** Interfaz táctil de alto contraste diseñada para teléfonos en ambientes oscuros. Validación estricta, anti-spam y botón **INVOCAR MI NOMBRE**. Seguimiento en vivo de tu turno y aviso cuando apareces en pantalla.
4. **Proyección Cinematográfica (`/screen`):**
   - Frases aleatorias de terror seleccionadas sin repetición consecutiva.
   - Temporizador de **15 segundos** con barra de energía carmesí.
   - Retorno automático e impecable al código QR cuando la cola está vacía.
   - Efectos CSS optimizados: niebla espectral flotante, ascuas incandescentes y resplandores de sangre.
5. **Compatibilidad Nativa con Resolume Arena:**
   - Modo pantalla completa con la tecla `F` o doble clic.
   - Modo limpio para pantallas LED: oculta la barra HUD presionando `H` o agregando `?clean=1` en la URL.
   - Ocultamiento automático del puntero del ratón tras 2.5 segundos de inactividad.
   - Escalado fluido y nítido para resoluciones **HD (720p), Full HD (1080p), 2K y 4K (2160p)** sin barras de desplazamiento.
6. **Panel Administrativo Protegido (`/admin`):**
   - Acceso con contraseña (configurable mediante `ADMIN_PASSWORD`).
   - Visualización de la cola ordenada en tiempo real.
   - Controles inmediatos: **Pausar / Reanudar proyección**, **Siguiente participante**, **Vaciar cola** y **Pausar inscripciones**.
7. **Netlify Free & Persistencia Gratuita:**
   - Funciona sobre Netlify Functions y almacenamiento persistente mediante **Netlify Blobs** (incluido gratis en todas las cuentas de Netlify).
   - Modo dual: si se ejecuta en local, persiste automáticamente en `.data/halloween-queue.json`.

---

## 📁 Estructura del Proyecto

```text
├── netlify/
│   └── functions/
│       ├── lib/
│       │   └── store.js          # Motor de cola, frases de terror y persistencia
│       ├── state.js              # GET /api/state (estado en vivo y avance automático)
│       ├── submit.js             # POST /api/submit (validación y encolado de nombres)
│       ├── config.js             # GET /api/config (URL canónica y configuración)
│       ├── qr.js                 # GET /api/qr (generación local de código QR en SVG)
│       ├── participant.js        # GET /api/participant/status (seguimiento móvil)
│       ├── inscriptions.js       # GET /api/inscriptions/status (estado de apertura)
│       ├── admin.js              # Endpoints privados protegidos con contraseña
│       └── utils.js              # Utilidades de red, IP y autenticación
├── public/
│   ├── index.html                # Portal de bienvenida y accesos directos
│   ├── join.html                 # Formulario móvil de invocación
│   ├── screen.html               # Pantalla de proyección cinematográfica para LED
│   ├── admin.html                # Panel de control protegido
│   ├── css/
│   │   ├── screen.css            # Estilos de terror cinematográfico y animación
│   │   ├── join.css              # Estilos responsivos táctiles para celulares
│   │   └── admin.css             # Estilos oscuros del panel administrativo
│   ├── js/
│   │   ├── screen.js             # Controlador de pantalla, QR, 15s y Resolume
│   │   ├── join.js               # Controlador de validación, envío y seguimiento
│   │   └── admin.js              # Controlador del panel de control
│   └── vendor/
│       └── qrcode.min.js         # Generador local offline de códigos QR
├── server.js                     # Servidor local Node.js para desarrollo y pruebas
├── netlify.toml                  # Configuración de despliegue y redirecciones Netlify
├── package.json
└── README.md
```

---

## 🛠️ Instalación y Desarrollo Local

### Requisitos
- Node.js 20 o superior.

### Pasos
1. Clona el repositorio o abre la carpeta del proyecto.
2. Instala las dependencias:
   ```bash
   npm install
   ```
3. Inicia el servidor de desarrollo local:
   ```bash
   npm start
   ```
4. Abre en tu navegador:
   - **Portal principal:** [http://localhost:3000](http://localhost:3000)
   - **Formulario móvil:** [http://localhost:3000/join](http://localhost:3000/join)
   - **Pantalla de proyección:** [http://localhost:3000/screen](http://localhost:3000/screen)
   - **Panel administrativo:** [http://localhost:3000/admin](http://localhost:3000/admin) (Contraseña predeterminada: `halloween2026`)

---

## 🌐 Despliegue en Netlify Free (Paso a Paso)

El proyecto está 100 % configurado para publicarse en el plan gratuito de Netlify en menos de 2 minutos:

1. **Subir a Git:** Asegúrate de tener tu código en un repositorio de GitHub, GitLab o Bitbucket.
2. **Importar en Netlify:**
   - Entra en [Netlify.com](https://www.netlify.com/) e inicia sesión.
   - Haz clic en **"Add new site"** > **"Import an existing project"**.
   - Selecciona tu repositorio de Halloween.
3. **Configuración de Build:**
   - Netlify detectará automáticamente el archivo `netlify.toml`.
   - **Build command:** *(dejar vacío)*
   - **Publish directory:** `public`
   - **Functions directory:** `netlify/functions`
4. **Variables de Entorno (Opcionales):**
   En Netlify ve a **Site configuration** > **Environment variables**:
   - `ADMIN_PASSWORD`: Contraseña para entrar al panel `/admin` (por defecto: `halloween2026`).
   - `DISPLAY_SECONDS`: Duración de cada nombre en pantalla en segundos (por defecto: `15`).
   - `PUBLIC_BASE_URL`: Dominio real si usas dominio personalizado (por ejemplo `https://tu-evento.netlify.app`). Si no se define, se detecta automáticamente de la petición HTTP.
5. **Listo:** Haz clic en **Deploy Site**. Tu web estará en vivo con HTTPS automático.

### Límites del Plan Gratuito (Netlify Free Tier)
- **Netlify Functions:** 125,000 peticiones al mes y 100 horas de ejecución gratuitas.
- **Netlify Blobs (Persistencia):** 100,000 lecturas/mes, 10,000 escrituras/mes y 5 GB de almacenamiento incluidos gratis sin tarjeta de crédito.
- **Ancho de banda:** 100 GB mensuales.
*Suficiente para cubrir con holgura múltiples fiestas y eventos con cientos de invitados escaneando al mismo tiempo.*

---

## 🎥 Integración con Resolume Arena

Para proyectar en pantallas LED o videowalls utilizando Resolume Arena:

1. **Captura de Fuente en Resolume:**
   - Abre Resolume Arena.
   - Puedes capturar la ventana del navegador mediante **Screen Capture**, **Spout/NDI**, u OBS Virtual Camera.
   - Si cuentas con el plugin de navegador web para Resolume, puedes introducir directamente la URL:
     ```text
     https://tu-sitio.netlify.app/screen?clean=1
     ```
2. **Atajos de Teclado en Pantalla (`/screen`):**
   - **`F`** o **Doble Clic:** Activa/desactiva la **Pantalla Completa** sin marcos del navegador.
   - **`H`:** Muestra u oculta la barra HUD de estado para dejar la pantalla completamente limpia.
   - **`?clean=1`:** Parámetro de URL que arranca la pantalla con la barra HUD oculta desde el primer segundo.
   - **Cursor automático:** El ratón desaparece automáticamente tras 2.5 segundos sin movimiento.

---

## 🧪 Pruebas Automáticas

El proyecto cuenta con una batería completa de pruebas unitarias y de integración nativas con Node.js Test Runner:

```bash
npm test
```

Verifica:
- Generación local de SVG del QR.
- Reglas de validación, anti-spam y caracteres maliciosos.
- Orden de llegada FIFO y no duplicación de nombres.
- Temporización de 15 segundos y retorno automático al QR cuando no hay cola.
- Acciones administrativas (pausar, reanudar, saltar, vaciar).
- Servidor HTTP local y compatibilidad con Netlify Functions.

---

## 🔒 Seguridad y Estabilidad

- **Anti-Spam:** Limitación por IP y longitud máxima de cola (hasta 100 participantes simultáneos).
- **Sanitización:** Rechazo de inyecciones HTML, caracteres de control e invisibles.
- **Tolerancia a Fallos:** Reintentos automáticos en caso de pérdida momentánea de conexión a internet con indicador de reconexión.
- **Persistencia en Frío:** La cola y el participante activo no se pierden aunque se recargue la página o la función serverless se suspenda.
