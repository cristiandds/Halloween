const crypto = require("crypto");
const { safeEqualStrings } = require("../security/password");

const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function parseCookieHeader(header) {
  const cookies = Object.create(null);
  if (typeof header !== "string" || header.length === 0) {
    return cookies;
  }

  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) {
      continue;
    }

    const name = part.slice(0, separator).trim();
    if (!name || Object.prototype.hasOwnProperty.call(cookies, name)) {
      continue;
    }

    let value = part.slice(separator + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }

    try {
      cookies[name] = decodeURIComponent(value);
    } catch (error) {
      cookies[name] = value;
    }
  }

  return cookies;
}

function createSessionService({ ttlMs, cookieName, secret, secureCookies = false }) {
  const sessions = new Map();
  const signingKey = crypto.createHash("sha256").update(secret).digest();

  function sign(sessionId) {
    return crypto
      .createHmac("sha256", signingKey)
      .update(sessionId)
      .digest("base64url");
  }

  function serialize(sessionId) {
    return `${sessionId}.${sign(sessionId)}`;
  }

  function readSignedToken(token) {
    if (typeof token !== "string") {
      return null;
    }

    const separator = token.lastIndexOf(".");
    if (separator <= 0) {
      return null;
    }

    const sessionId = token.slice(0, separator);
    const signature = token.slice(separator + 1);

    if (!SESSION_ID_PATTERN.test(sessionId) || !SESSION_ID_PATTERN.test(signature)) {
      return null;
    }
    if (!safeEqualStrings(signature, sign(sessionId))) {
      return null;
    }

    return sessionId;
  }

  function isSecureRequest(req) {
    if (secureCookies) {
      return true;
    }
    if (!req || !req.headers) {
      return false;
    }

    const forwardedProto = req.headers["x-forwarded-proto"];
    if (typeof forwardedProto === "string") {
      const first = forwardedProto.split(",")[0].trim().toLowerCase();
      if (first === "https") {
        return true;
      }
    }

    return Boolean(req.secure);
  }

  function cookieOptions(req, includeMaxAge) {
    const options = {
      httpOnly: true,
      sameSite: "strict",
      secure: isSecureRequest(req),
      path: "/"
    };
    if (includeMaxAge) {
      options.maxAge = ttlMs;
    }
    return options;
  }

  function create() {
    const now = Date.now();
    const session = {
      id: crypto.randomBytes(32).toString("base64url"),
      csrfToken: crypto.randomBytes(32).toString("base64url"),
      createdAt: now,
      expiresAt: now + ttlMs
    };
    sessions.set(session.id, session);
    return session;
  }

  function getById(sessionId) {
    if (typeof sessionId !== "string") {
      return null;
    }

    const session = sessions.get(sessionId);
    if (!session) {
      return null;
    }
    if (session.expiresAt <= Date.now()) {
      sessions.delete(sessionId);
      return null;
    }
    return session;
  }

  function getFromToken(token) {
    const sessionId = readSignedToken(token);
    return sessionId ? getById(sessionId) : null;
  }

  function getFromCookieHeader(header) {
    const cookies = parseCookieHeader(header);
    return getFromToken(cookies[cookieName]);
  }

  function getFromRequest(req) {
    return getFromCookieHeader(req.headers ? req.headers.cookie : "");
  }

  function setCookie(res, req, sessionId) {
    res.cookie(cookieName, serialize(sessionId), cookieOptions(req, true));
  }

  function clearCookie(res, req) {
    res.clearCookie(cookieName, cookieOptions(req, false));
  }

  function destroy(sessionId) {
    return sessions.delete(sessionId);
  }

  function stopCleanup() {
    if (cleanupTimer) {
      clearInterval(cleanupTimer);
      cleanupTimer = null;
    }
  }

  function cleanup() {
    const now = Date.now();
    for (const [sessionId, session] of sessions) {
      if (session.expiresAt <= now) {
        sessions.delete(sessionId);
      }
    }
  }

  let cleanupTimer = setInterval(cleanup, Math.min(ttlMs, 60 * 1000));
  if (typeof cleanupTimer.unref === "function") {
    cleanupTimer.unref();
  }

  return {
    cookieName,
    ttlMs,
    create,
    getById,
    getFromToken,
    getFromCookieHeader,
    getFromRequest,
    setCookie,
    clearCookie,
    destroy,
    cleanup,
    stopCleanup
  };
}

module.exports = {
  parseCookieHeader,
  createSessionService
};
