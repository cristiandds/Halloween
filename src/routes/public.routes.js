const express = require("express");
const { StorageError } = require("../services/storage.service");

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

  router.post("/api/submit", async (req, res, next) => {
    try {
      const protection = req.submissionProtection;
      if (!protection) {
        return res.status(503).json({ error: "Servicio temporalmente no disponible." });
      }

      // Get or create participant ID (anonymous, secure cookie)
      const participantId = protection.getOrCreateParticipantId(req, res);

      const rawName = typeof req.body && typeof req.body.name === "string" ? req.body.name : "";
      
      // Check for control characters before normalization
      // Reject control chars (C0, C1 controls except maybe none)
      for (let i = 0; i < rawName.length; i++) {
        const code = rawName.charCodeAt(i);
        // C0 controls 0x00-0x1F, C1 controls 0x7F-0x9F
        if ((code <= 0x1F && code !== 0x09 && code !== 0x0A && code !== 0x0D) || code === 0x7F || (code >= 0x80 && code <= 0x9F)) {
          return res.status(400).json({ error: "La información proporcionada no es válida." });
        }
      }
      
      // Check for HTML tags
      if (/<[a-zA-Z/!][^>]*>/.test(rawName) || rawName.includes("</") || rawName.includes("<!") || rawName.includes("<?")) {
        return res.status(400).json({ error: "La información proporcionada no es válida." });
      }
      
      // Check for dangerous invisible characters (zero width, BOM, etc.)
      // Reject zero-width space, zero-width non-joiner, zero-width joiner, BOM, etc.
      if (/[\u200B-\u200F\u2060\uFEFF\u202A-\u202E]/.test(rawName)) {
        return res.status(400).json({ error: "La información proporcionada no es válida." });
      }
      
      // Normalize whitespace
      const name = rawName.replace(/\s+/g, " ").trim();

      if (name.length === 0) {
        return res.status(400).json({ error: "Escribe un nombre de 2 a 32 caracteres." });
      }
      if (name.length < 2 || name.length > 32) {
        return res.status(400).json({ error: "Escribe un nombre de 2 a 32 caracteres." });
      }
      
      // Only allow letters (unicode), marks, numbers, spaces, dot, apostrophe, hyphen
      if (!/^[\p{L}\p{M}0-9 .'-]+$/u.test(name)) {
        return res.status(400).json({ error: "Usa solo letras, números, espacios, punto, apóstrofe o guion." });
      }
      
      // Check rate limits
      try {
        protection.checkRateLimit(req, participantId);
      } catch (rateErr) {
        if (rateErr.status) {
          return res.status(rateErr.status).json({ error: rateErr.message });
        }
        throw rateErr;
      }
      
      // Check for duplicate submission by same participant
      try {
        protection.checkDuplicate(participantId, name);
      } catch (dupErr) {
        if (dupErr.status) {
          return res.status(dupErr.status).json({ error: dupErr.message });
        }
        throw dupErr;
      }
      
      // Check queue limit - the queue service validates atomically inside its
      // operation lock and persists before resolving.
      let entry;
      try {
        entry = await queueService.addParticipant(name, {
          state: config.REQUIRE_APPROVAL
            ? queueService.PARTICIPANT_STATES.PENDING_APPROVAL
            : queueService.PARTICIPANT_STATES.WAITING
        });
      } catch (qErr) {
        if (qErr.status) {
          return res.status(qErr.status).json({ error: qErr.message });
        }
        throw qErr;
      }

      // Record after successful enqueue
      protection.recordSubmission(req.ip || req.connection?.remoteAddress, participantId);
      protection.recordSubmissionName(participantId, name);

      const pendingApproval = entry.state === queueService.PARTICIPANT_STATES.PENDING_APPROVAL;
      const position = pendingApproval ? null : entry.position;
      const estimatedWaitSeconds = pendingApproval ? null : entry.estimatedWaitSeconds;

      res.json({
        ok: true,
        message: pendingApproval
          ? "¡Tu nombre fue enviado! Espera la aprobación del organizador."
          : "¡Tu nombre fue enviado!",
        position,
        estimatedWaitSeconds,
        pendingApproval
      });
    } catch (err) {
      if (err.status) {
        return res.status(err.status).json({ error: err.message });
      }
      if (err instanceof StorageError) {
        return res.status(503).json({
          error: "No se pudo guardar la información del evento. Inténtalo de nuevo."
        });
      }
      next(err);
    }
  });

  return router;
}

module.exports = { createPublicRoutes };
