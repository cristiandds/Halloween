const express = require("express");

function createPublicRoutes({ config, queueService, state }) {
  const router = express.Router();
  const { JOIN_HTML } = config;

  router.get("/health", (req, res) => {
    res.json({ status: "ok" });
  });

  router.get("/join", (req, res) => {
    res.sendFile(JOIN_HTML);
  });

  router.get("/api/config", (req, res) => {
    const forwardedProto = req.get("x-forwarded-proto");
    const protocol = forwardedProto ? forwardedProto.split(",")[0].trim() : req.protocol;
    const host = req.get("host");

    let joinUrl = `${protocol}://${host}/join`;
    if (config.PUBLIC_BASE_URL) {
      try {
        joinUrl = new URL("/join", config.PUBLIC_BASE_URL).toString();
      } catch (error) {
        joinUrl = `${protocol}://${host}/join`;
      }
    }

    res.json({
      joinUrl,
      displaySeconds: config.DISPLAY_SECONDS
    });
  });

  router.get("/api/state", (req, res) => {
    res.json(state.publicState());
  });

  router.get("/api/public/state", (req, res) => {
    res.json(state.publicState());
  });

  router.post("/api/submit", (req, res, next) => {
    try {
      const rawName = typeof req.body.name === "string" ? req.body.name : "";
      const name = rawName.replace(/\s+/g, " ").trim();

      if (name.length < 2 || name.length > 32) {
        return res.status(400).json({ error: "Escribe un nombre de 2 a 32 caracteres." });
      }
      if (!/^[\p{L}\p{M}0-9 .'-]+$/u.test(name)) {
        return res.status(400).json({ error: "Usa solo letras, números, espacios, punto, apóstrofe o guion." });
      }

      queueService.enqueue(name);

      const position = queueService.getQueueLength() + (queueService.getActive() ? 1 : 0);
      if (!queueService.getActive()) {
        if (typeof queueService.ensureRunning === "function") {
          queueService.ensureRunning(state._handlers || {});
        } else {
          if (typeof queueService.startNext === "function") {
            queueService.startNext(state._handlers || {});
          }
        }
      } else {
        state.broadcast(req.app.get("io"));
      }

      res.json({
        ok: true,
        message: "¡Tu nombre fue enviado!",
        position,
        estimatedWaitSeconds: Math.max(0, position - 1) * config.DISPLAY_SECONDS
      });
    } catch (err) {
      if (err.status) {
        return res.status(err.status).json({ error: err.message });
      }
      next(err);
    }
  });

  return router;
}

module.exports = { createPublicRoutes };
