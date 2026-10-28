const { safeEqualStrings } = require("../security/password");

function createAuthMiddleware({ sessions }) {
  function attachSession(req, res, next) {
    const session = sessions.getFromRequest(req);
    req.session = session;

    if (!session && req.headers.cookie) {
      const sentCookie = sessions.getFromCookieHeader(req.headers.cookie);
      if (!sentCookie) {
        sessions.clearCookie(res, req);
      }
    }

    next();
  }

  function requireAuth({ redirectToLogin = false } = {}) {
    return function requireAuthMiddleware(req, res, next) {
      if (req.session) {
        return next();
      }

      if (redirectToLogin) {
        const requested = req.originalUrl || "/";
        const nextPath = requested.startsWith("/") && !requested.startsWith("//") ? requested : "/";
        return res.redirect(302, `/login?next=${encodeURIComponent(nextPath)}`);
      }

      return res.status(401).json({ error: "No autorizado." });
    };
  }

  function requireCsrf(req, res, next) {
    const suppliedToken = req.get("x-csrf-token");
    if (!req.session || !safeEqualStrings(suppliedToken || "", req.session.csrfToken)) {
      return res.status(403).json({ error: "Token CSRF inválido o ausente." });
    }
    next();
  }

  return {
    attachSession,
    requireAuth,
    requireCsrf
  };
}

module.exports = { createAuthMiddleware };
