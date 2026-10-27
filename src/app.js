const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const config = require("./config");
const { createQueueService } = require("./services/queue.service");
const { selectPhrase } = require("./services/phrase.service");
const { createState } = require("./utils/state");
const { createPublicRoutes } = require("./routes/public.routes");
const { createAuthRoutes } = require("./routes/auth.routes");
const { createScreenRoutes } = require("./routes/screen.routes");
const { createAdminRoutes } = require("./routes/admin.routes");
const { createSessionService } = require("./services/session.service");
const { createLoginRateLimiter } = require("./services/login-rate-limit.service");
const { createPasswordVerifier } = require("./security/password");
const { createOriginGuard } = require("./security/origin");
const { createAuthMiddleware } = require("./middleware/auth");
const { securityHeaders, noStore } = require("./middleware/security");
const { setupSockets } = require("./sockets");
const { createSubmissionProtection } = require("./services/submission-protection.service");

function createApp() {
  config.assertValidConfig();

  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, {
    maxHttpBufferSize: 100 * 1024
  });

  if (config.TRUST_PROXY) {
    app.set("trust proxy", 1);
  }
  app.disable("x-powered-by");
  app.set("io", io);

  app.use(securityHeaders);

  app.use((req, res, next) => {
    let pathname;
    try {
      pathname = decodeURIComponent(req.path).toLowerCase();
    } catch (error) {
      return res.status(404).type("text/plain").send("No encontrado.");
    }

    if (
      pathname.endsWith("/screen.html") ||
      pathname === "/screen/index.html" ||
      pathname.endsWith("/admin.html") ||
      pathname === "/admin/index.html"
    ) {
      return res.status(404).type("text/plain").send("No encontrado.");
    }

    return next();
  });

  app.use(express.json({ limit: "2kb" }));

  const queueService = createQueueService({ displaySeconds: config.DISPLAY_SECONDS, maxLength: config.QUEUE_MAX_LENGTH });

  const state = createState({
    queueService,
    phraseService: { selectPhrase },
    displaySeconds: config.DISPLAY_SECONDS
  });

  const handlers = {
    onStart: (next) => {
      const active = queueService.getActive();
      const previousPhrase = active ? active.phrase : null;
      const phrase = selectPhrase(previousPhrase);
      return { phrase };
    },
    onFinish: () => {
      state.broadcast(io);
    }
  };

  state._handlers = handlers;

  const sessions = createSessionService({
    ttlMs: config.SESSION_TTL_MS,
    cookieName: config.SESSION_COOKIE_NAME,
    secret: config.SESSION_SECRET,
    secureCookies: config.COOKIE_SECURE
  });
  const passwordVerifier = createPasswordVerifier(config.ADMIN_PASSWORD);
  const loginRateLimiter = createLoginRateLimiter();
  const auth = createAuthMiddleware({ sessions });
  const submissionProtection = createSubmissionProtection({
    ipWindowMs: config.SUBMIT_IP_WINDOW_MS,
    ipMax: config.SUBMIT_IP_MAX,
    participantWindowMs: config.SUBMIT_PARTICIPANT_WINDOW_MS,
    participantMax: config.SUBMIT_PARTICIPANT_MAX,
    globalWindowMs: config.SUBMIT_GLOBAL_WINDOW_MS,
    globalMax: config.SUBMIT_GLOBAL_MAX,
    duplicateTtlMs: config.SUBMIT_DUPLICATE_TTL_MS,
    cookieName: config.PARTICIPANT_COOKIE_NAME,
    secureCookies: config.COOKIE_SECURE
  });
 
  const socketHub = setupSockets(io, { state, sessions, config });

  app.use(auth.attachSession);
  app.use("/api", createOriginGuard({ publicBaseUrl: config.PUBLIC_BASE_URL }));
  app.use((req, res, next) => {
    const pathname = req.path.toLowerCase();
    if (
      pathname === "/screen" ||
      pathname.startsWith("/screen/") ||
      pathname === "/admin" ||
      pathname.startsWith("/admin/") ||
      pathname.startsWith("/api/auth") ||
      pathname.startsWith("/api/admin")
    ) {
      return noStore(req, res, next);
    }
    return next();
  });

  app.use((req, res, next) => {
    req.queueService = queueService;
    req.io = io;
    req.submissionProtection = submissionProtection;
    next();
  });

  app.use(createPublicRoutes({ config, queueService, state }));
  app.use(createAuthRoutes({
    config,
    sessions,
    passwordVerifier,
    loginRateLimiter,
    requireAuth: auth.requireAuth,
    requireCsrf: auth.requireCsrf,
    onSessionDestroyed: socketHub.disconnectSession
  }));
  app.use(createScreenRoutes({ config, requireAuth: auth.requireAuth }));
  app.use(createAdminRoutes({ config, state, requireAuth: auth.requireAuth }));

  app.use(express.static(config.PUBLIC_DIR, { index: false, dotfiles: "ignore" }));

  app.use((req, res) => {
    if (req.path.startsWith("/api/")) {
      return res.status(404).json({ error: "No encontrado." });
    }
    return res.status(404).type("text/plain").send("No encontrado.");
  });

  app.use((err, req, res, next) => {
    if (res.headersSent) {
      return next(err);
    }
    const status = Number.isInteger(err.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
    const message = status >= 500
      ? "Error interno del servidor."
      : (err.type === "entity.parse.failed" ? "Solicitud inválida." : err.message);
    res.status(status).json({ error: message });
  });

  return { app, server, io, queueService, state, sessions, config, submissionProtection };
}

module.exports = { createApp };
