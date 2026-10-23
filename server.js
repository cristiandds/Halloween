const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
const SCREEN_TOKEN = process.env.SCREEN_TOKEN || "CAMBIA-ESTE-TOKEN";
const DISPLAY_SECONDS = 15;

app.use(express.json({ limit: "2kb" }));
app.use(express.static(path.join(__dirname, "public")));

const queue = [];
let active = null;
let timer = null;
let nextId = 1;

const phrases = [
  "La oscuridad ya conoce tu nombre.",
  "Esta noche, las sombras te han elegido.",
  "No mires detrás de ti.",
  "Tu destino acaba de despertar.",
  "Alguien susurra tu nombre en la oscuridad.",
  "La sangre recuerda lo que los vivos olvidan.",
  "Has cruzado una puerta que no debías abrir.",
  "Esta historia apenas acaba de comenzar.",
  "El silencio sabe algo que tú ignoras.",
  "No todas las almas encuentran el camino de regreso."
];

function publicState() {
  return {
    active,
    waiting: queue.length,
    queuePreview: queue.slice(0, 5).map(item => item.name),
    displaySeconds: DISPLAY_SECONDS
  };
}

function broadcast() {
  io.emit("state", publicState());
}

function startNext() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }

  if (queue.length === 0) {
    active = null;
    broadcast();
    return;
  }

  const next = queue.shift();
  const candidates = phrases.filter(p => p !== next.previousPhrase);
  const phrasePool = candidates.length ? candidates : phrases;
  const phrase = phrasePool[Math.floor(Math.random() * phrasePool.length)];

  active = {
    id: next.id,
    name: next.name,
    phrase,
    startedAt: Date.now(),
    durationMs: DISPLAY_SECONDS * 1000
  };

  broadcast();
  timer = setTimeout(startNext, DISPLAY_SECONDS * 1000);
}

app.get("/join", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "join.html"));
});

app.get("/api/config", (req, res) => {
  const forwardedProto = req.get("x-forwarded-proto");
  const protocol = forwardedProto ? forwardedProto.split(",")[0] : req.protocol;
  const host = req.get("x-forwarded-host") || req.get("host");
  res.json({
    joinUrl: `${protocol}://${host}/join`,
    displaySeconds: DISPLAY_SECONDS
  });
});

app.get("/api/state", (req, res) => {
  res.json(publicState());
});

app.post("/api/submit", (req, res) => {
  const rawName = typeof req.body.name === "string" ? req.body.name : "";
  const name = rawName.replace(/\s+/g, " ").trim();

  if (name.length < 2 || name.length > 32) {
    return res.status(400).json({ error: "Escribe un nombre de 2 a 32 caracteres." });
  }
  if (!/^[\p{L}\p{M}0-9 .'-]+$/u.test(name)) {
    return res.status(400).json({ error: "Usa solo letras, números, espacios, punto, apóstrofe o guion." });
  }
  if (queue.length >= 100) {
    return res.status(429).json({ error: "La cola está llena por ahora. Inténtalo en un momento." });
  }

  queue.push({ id: nextId++, name });
  const position = queue.length + (active ? 1 : 0);
  if (!active) startNext();
  else broadcast();

  res.json({
    ok: true,
    message: "¡Tu nombre fue enviado!",
    position,
    estimatedWaitSeconds: Math.max(0, position - 1) * DISPLAY_SECONDS
  });
});

app.get("/screen", (req, res) => {
  if (req.query.token !== SCREEN_TOKEN) {
    return res.status(403).send("Acceso denegado. Abre la pantalla con el token de control correcto.");
  }
  res.sendFile(path.join(__dirname, "public", "screen.html"));
});

io.on("connection", socket => {
  socket.emit("state", publicState());
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Sistema QR de terror activo en el puerto ${PORT}`);
  console.log(`Token de pantalla configurado: ${SCREEN_TOKEN === "CAMBIA-ESTE-TOKEN" ? "CAMBIA EL TOKEN ANTES DE PUBLICAR" : "personalizado"}`);
});