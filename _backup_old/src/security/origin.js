function parseOrigin(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.origin;
  } catch (error) {
    return null;
  }
}

function getAllowedOrigins(host, publicBaseUrl) {
  const origins = new Set();

  if (typeof publicBaseUrl === "string" && publicBaseUrl.trim().length > 0) {
    const publicOrigin = parseOrigin(publicBaseUrl);
    if (publicOrigin) {
      origins.add(publicOrigin);
    }
  }

  if (typeof host === "string" && host.trim().length > 0) {
    origins.add(`http://${host}`);
    origins.add(`https://${host}`);
  }

  return origins;
}

function isAllowedOrigin(origin, { host, publicBaseUrl }) {
  if (typeof origin !== "string" || origin.length === 0) {
    return true;
  }
  if (origin === "null") {
    return false;
  }

  const parsedOrigin = parseOrigin(origin);
  if (!parsedOrigin) {
    return false;
  }

  return getAllowedOrigins(host, publicBaseUrl).has(parsedOrigin);
}

function createOriginGuard({ publicBaseUrl }) {
  const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

  return function originGuard(req, res, next) {
    if (safeMethods.has(req.method)) {
      return next();
    }

    const host = req.get("host");
    const origin = req.get("origin");

    if (origin) {
      if (!isAllowedOrigin(origin, { host, publicBaseUrl })) {
        return res.status(403).json({ error: "Origen no permitido." });
      }
      return next();
    }

    const referer = req.get("referer");
    if (referer) {
      const refererOrigin = parseOrigin(referer);
      if (!refererOrigin || !isAllowedOrigin(refererOrigin, { host, publicBaseUrl })) {
        return res.status(403).json({ error: "Origen no permitido." });
      }
    }

    return next();
  };
}

module.exports = {
  parseOrigin,
  getAllowedOrigins,
  isAllowedOrigin,
  createOriginGuard
};
