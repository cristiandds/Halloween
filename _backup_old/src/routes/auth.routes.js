const express = require("express");

const { noStore } = require("../middleware/security");

function safeNextPath(value) {
  return value === "/screen" || value === "/admin" ? value : "/admin";
}

function createAuthRoutes({
  config,
  sessions,
  passwordVerifier,
  loginRateLimiter,
  requireAuth,
  requireCsrf,
  onSessionDestroyed
}) {
  const router = express.Router();

  router.get("/login", (req, res) => {
    noStore(req, res, () => {});
    if (req.session) {
      return res.redirect(302, safeNextPath(req.query.next));
    }
    return res.sendFile(config.LOGIN_HTML);
  });

  router.post("/api/auth/login", (req, res) => {
    noStore(req, res, () => {});

    const rateCheck = loginRateLimiter.check(req);
    if (!rateCheck.allowed) {
      res.set("Retry-After", String(rateCheck.retryAfterSeconds || 60));
      return res.status(429).json({ error: "Demasiados intentos. Inténtalo de nuevo más tarde." });
    }

    const password = req.body && typeof req.body.password === "string" ? req.body.password : "";
    if (!passwordVerifier.verify(password)) {
      loginRateLimiter.fail(req);
      return res.status(401).json({ error: "Credenciales inválidas." });
    }

    loginRateLimiter.reset(req);

    if (req.session) {
      const previousSessionId = req.session.id;
      sessions.destroy(previousSessionId);
      if (typeof onSessionDestroyed === "function") {
        onSessionDestroyed(previousSessionId);
      }
    }

    const session = sessions.create();
    sessions.setCookie(res, req, session.id);

    return res.json({
      ok: true,
      csrfToken: session.csrfToken,
      expiresAt: session.expiresAt
    });
  });

  router.get("/api/auth/session", (req, res) => {
    noStore(req, res, () => {});
    if (!req.session) {
      return res.status(401).json({ authenticated: false, error: "No autorizado." });
    }
    return res.json({
      authenticated: true,
      csrfToken: req.session.csrfToken,
      expiresAt: req.session.expiresAt
    });
  });

  router.post("/api/auth/logout", requireAuth(), requireCsrf, (req, res) => {
    noStore(req, res, () => {});
    const sessionId = req.session.id;
    sessions.destroy(sessionId);
    if (typeof onSessionDestroyed === "function") {
      onSessionDestroyed(sessionId);
    }
    sessions.clearCookie(res, req);
    return res.json({ ok: true });
  });

  return router;
}

module.exports = {
  createAuthRoutes,
  safeNextPath
};
