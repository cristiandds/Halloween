const { isAllowedOrigin } = require("../security/origin");
const { PRIVATE_ROOM } = require("../utils/rooms");

function setupSockets(io, { state, sessions, config }) {
  const sessionSockets = new Map();

  io.use((socket, next) => {
    const origin = socket.handshake.headers.origin;
    const host = socket.handshake.headers.host;

    if (origin && !isAllowedOrigin(origin, { host, publicBaseUrl: config.PUBLIC_BASE_URL })) {
      return next(new Error("unauthorized"));
    }

    const session = sessions.getFromCookieHeader(socket.handshake.headers.cookie);
    if (!session) {
      return next(new Error("unauthorized"));
    }

    socket.data.session = session;
    next();
  });

  io.on("connection", (socket) => {
    const sessionId = socket.data.session.id;
    socket.join(PRIVATE_ROOM);

    if (!sessionSockets.has(sessionId)) {
      sessionSockets.set(sessionId, new Set());
    }
    sessionSockets.get(sessionId).add(socket);

    const snapshot = state.privateState();
    socket.emit("state", snapshot);
    socket.emit("state:private", snapshot);

    const remainingMs = Math.max(0, socket.data.session.expiresAt - Date.now());
    const expiryTimer = setTimeout(() => {
      socket.disconnect(true);
    }, remainingMs);
    if (typeof expiryTimer.unref === "function") {
      expiryTimer.unref();
    }

    socket.on("disconnect", () => {
      clearTimeout(expiryTimer);
      const sockets = sessionSockets.get(sessionId);
      if (!sockets) {
        return;
      }
      sockets.delete(socket);
      if (sockets.size === 0) {
        sessionSockets.delete(sessionId);
      }
    });
  });

  function disconnectSession(sessionId) {
    const sockets = sessionSockets.get(sessionId);
    if (!sockets) {
      return;
    }
    for (const socket of sockets) {
      socket.disconnect(true);
    }
    sessionSockets.delete(sessionId);
  }

  return {
    disconnectSession
  };
}

module.exports = { setupSockets };
