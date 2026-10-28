function createLoginRateLimiter({
  maxAttempts = 5,
  windowMs = 15 * 60 * 1000,
  blockMs = 15 * 60 * 1000
} = {}) {
  const entries = new Map();

  function keyFor(req) {
    return req.ip || (req.socket && req.socket.remoteAddress) || "unknown";
  }

  function getEntry(key, now) {
    const entry = entries.get(key);
    if (!entry) {
      return null;
    }
    if (now - entry.firstAttemptAt > windowMs && (!entry.blockedUntil || entry.blockedUntil <= now)) {
      entries.delete(key);
      return null;
    }
    return entry;
  }

  function check(req) {
    const now = Date.now();
    const key = keyFor(req);
    const entry = getEntry(key, now);

    if (!entry) {
      return { allowed: true };
    }
    if (entry.blockedUntil && entry.blockedUntil > now) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((entry.blockedUntil - now) / 1000))
      };
    }
    if (entry.attempts >= maxAttempts) {
      entry.blockedUntil = now + blockMs;
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil(blockMs / 1000))
      };
    }

    return { allowed: true };
  }

  function fail(req) {
    const now = Date.now();
    const key = keyFor(req);
    let entry = getEntry(key, now);

    if (!entry) {
      entry = { attempts: 0, firstAttemptAt: now, blockedUntil: 0 };
      entries.set(key, entry);
    }

    entry.attempts += 1;
    if (entry.attempts >= maxAttempts) {
      entry.blockedUntil = now + blockMs;
    }
  }

  function reset(req) {
    entries.delete(keyFor(req));
  }

  function cleanup() {
    const now = Date.now();
    for (const [key, entry] of entries) {
      const expiredWindow = now - entry.firstAttemptAt > windowMs;
      const blockExpired = !entry.blockedUntil || entry.blockedUntil <= now;
      if (expiredWindow && blockExpired) {
        entries.delete(key);
      }
    }
  }

  const cleanupTimer = setInterval(cleanup, Math.min(windowMs, 60 * 1000));
  if (typeof cleanupTimer.unref === "function") {
    cleanupTimer.unref();
  }

  return {
    check,
    fail,
    reset,
    stopCleanup() {
      clearInterval(cleanupTimer);
    }
  };
}

module.exports = { createLoginRateLimiter };
