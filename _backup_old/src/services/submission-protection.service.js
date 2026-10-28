const crypto = require("crypto");

function getClientIp(req) {
  if (!req) {
    return "unknown";
  }
  if (req.ip) {
    return req.ip;
  }
  const forwarded = req.headers ? req.headers["x-forwarded-for"] : null;
  if (typeof forwarded === "string" && forwarded.length > 0) {
    const first = forwarded.split(",")[0].trim();
    if (first) {
      return first;
    }
  }
  const realIp = req.headers ? req.headers["x-real-ip"] : null;
  if (typeof realIp === "string" && realIp.trim()) {
    return realIp.trim();
  }
  return req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : "unknown";
}

function createSubmissionProtection({ 
  ipWindowMs = 60000, 
  ipMax = 10,
  participantWindowMs = 60000,
  participantMax = 2,
  globalWindowMs = 60000,
  globalMax = 100,
  duplicateTtlMs = 10 * 60 * 1000,
  cookieName = "halloween_pid",
  cookieTtlMs = 24 * 60 * 60 * 1000,
  secureCookies = false
} = {}) {
  const ipRecords = new Map(); // ip -> list of timestamps
  const participantRecords = new Map(); // participantId -> list of timestamps
  const globalRecords = [];
  const recentNamesByParticipant = new Map(); // participantId -> {nameHash, expiresAt}
  const usedNameHashes = new Map(); // nameHash -> {participantId, expiresAt} - to detect duplicates by same participant? 
  // "Evita envíos duplicados del mismo participante mediante una identificación anónima segura y una cookie HttpOnly" 
  // So same participant (same cookie/id) cannot submit duplicate - but different people can have same name
  const participantLastSubmit = new Map(); // participantId -> {hash, expiresAt}
  
  let cleanupTimer = setInterval(() => {
    const now = Date.now();
    // cleanup ip
    for (const [ip, timestamps] of ipRecords) {
      const filtered = timestamps.filter(ts => now - ts < Math.max(ipWindowMs, participantWindowMs, globalWindowMs));
      if (filtered.length === 0) {
        ipRecords.delete(ip);
      } else {
        ipRecords.set(ip, filtered);
      }
    }
    // cleanup participants
    for (const [pid, timestamps] of participantRecords) {
      const filtered = timestamps.filter(ts => now - ts < Math.max(ipWindowMs, participantWindowMs, globalWindowMs));
      if (filtered.length === 0) {
        participantRecords.delete(pid);
      } else {
        participantRecords.set(pid, filtered);
      }
    }
    // cleanup global
    while (globalRecords.length > 0 && now - globalRecords[0] > Math.max(ipWindowMs, participantWindowMs, globalWindowMs)) {
      globalRecords.shift();
    }
    // cleanup duplicates
    for (const [pid, rec] of participantLastSubmit) {
      if (rec.expiresAt <= now) {
        participantLastSubmit.delete(pid);
      }
    }
  }, 60000);
  if (typeof cleanupTimer.unref === "function") {
    cleanupTimer.unref();
  }
  
  function hashName(name) {
    return crypto.createHash("sha256").update(name).digest("hex");
  }
  
  function getOrCreateParticipantId(req, res) {
    // Try to get from cookie
    const cookies = parseCookies(req);
    if (cookies[cookieName]) {
      // Basic validation of cookie format
      if (/^[A-Za-z0-9_-]{32,64}$/.test(cookies[cookieName])) {
        return cookies[cookieName];
      }
    }
    // Create new anonymous id
    const participantId = crypto.randomBytes(32).toString("base64url");
    setParticipantCookie(res, req, participantId);
    return participantId;
  }
  
  function parseCookies(req) {
    const cookies = Object.create(null);
    const header = req.headers ? req.headers.cookie : "";
    if (typeof header !== "string" || header.length === 0) {
      return cookies;
    }
    for (const part of header.split(";")) {
      const separator = part.indexOf("=");
      if (separator < 1) continue;
      const name = part.slice(0, separator).trim();
      if (!name || Object.prototype.hasOwnProperty.call(cookies, name)) continue;
      let value = part.slice(separator + 1).trim();
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }
      try {
        cookies[name] = decodeURIComponent(value);
      } catch (e) {
        cookies[name] = value;
      }
    }
    return cookies;
  }
  
  function isSecureRequest(req) {
    if (secureCookies) return true;
    if (!req || !req.headers) return false;
    const forwardedProto = req.headers["x-forwarded-proto"];
    if (typeof forwardedProto === "string") {
      const first = forwardedProto.split(",")[0].trim().toLowerCase();
      if (first === "https") return true;
    }
    return Boolean(req.secure);
  }
  
  function setParticipantCookie(res, req, participantId) {
    res.cookie(cookieName, participantId, {
      httpOnly: true,
      sameSite: "lax", // allow for form submissions
      secure: isSecureRequest(req),
      path: "/",
      maxAge: cookieTtlMs
    });
  }
  
  function checkRateLimit(req, participantId) {
    const now = Date.now();
    const ip = getClientIp(req);
    
    // Clean old entries
    const ipList = ipRecords.get(ip) || [];
    const filteredIp = ipList.filter(ts => now - ts < ipWindowMs);
    ipRecords.set(ip, filteredIp);
    if (filteredIp.length >= ipMax) {
      const err = new Error("Demasiadas solicitudes desde esta conexión. Inténtalo más tarde.");
      err.status = 429;
      throw err;
    }
    
    // Participant rate limit
    const pList = participantRecords.get(participantId) || [];
    const filteredP = pList.filter(ts => now - ts < participantWindowMs);
    participantRecords.set(participantId, filteredP);
    if (filteredP.length >= participantMax) {
      const err = new Error("Has enviado demasiadas solicitudes. Espera un momento antes de volver a intentarlo.");
      err.status = 429;
      throw err;
    }
    
    // Global rate limit (optional but reasonable)
    while (globalRecords.length > 0 && now - globalRecords[0] > globalWindowMs) {
      globalRecords.shift();
    }
    if (globalRecords.length >= globalMax) {
      const err = new Error("El sistema está temporalmente sobrecargado. Inténtalo más tarde.");
      err.status = 503;
      throw err;
    }
  }
  
  function recordSubmission(ip, participantId) {
    const now = Date.now();
    // Record IP
    const ipList = ipRecords.get(ip) || [];
    ipList.push(now);
    ipRecords.set(ip, ipList);
    // Record participant
    const pList = participantRecords.get(participantId) || [];
    pList.push(now);
    participantRecords.set(participantId, pList);
    // Record global
    globalRecords.push(now);
  }
  
  function checkDuplicate(participantId, name) {
    const now = Date.now();
    const nameHash = hashName(name);
    const last = participantLastSubmit.get(participantId);
    if (last && last.expiresAt > now && last.hash === nameHash) {
      const err = new Error("Ya has enviado este nombre anteriormente.");
      err.status = 409;
      throw err;
    }
  }
  
  function recordSubmissionName(participantId, name) {
    const now = Date.now();
    participantLastSubmit.set(participantId, {
      hash: hashName(name),
      expiresAt: now + duplicateTtlMs
    });
  }
  
  function stopCleanup() {
    if (cleanupTimer) {
      clearInterval(cleanupTimer);
      cleanupTimer = null;
    }
  }
  
  return {
    getOrCreateParticipantId,
    checkRateLimit,
    recordSubmission,
    checkDuplicate,
    recordSubmissionName,
    stopCleanup,
    cookieName
  };
}

module.exports = { createSubmissionProtection, getClientIp };
