const express = require("express");

const { noStore } = require("../middleware/security");

function parseId(value) {
  const id = typeof value === "number" ? value : Number.parseInt(value, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function createAdminRoutes({ config, state, queueService, requireAuth, requireCsrf }) {
  const router = express.Router();

  router.get("/admin", requireAuth({ redirectToLogin: true }), (req, res) => {
    noStore(req, res, () => {});
    res.sendFile(config.ADMIN_HTML);
  });

  router.get(["/admin.html", "/admin/index.html"], (req, res) => {
    res.status(404).type("text/plain").send("No encontrado.");
  });

  router.get("/api/admin/state", requireAuth(), (req, res) => {
    noStore(req, res, () => {});
    res.json(state.privateState());
  });

  function respond(res, extra = {}) {
    res.json({ ok: true, state: state.privateState(), ...extra });
  }

  function command(handler) {
    return async (req, res, next) => {
      try {
        const result = await handler(req);
        respond(res, result && result.extra ? result.extra : {});
      } catch (error) {
        if (error.status) {
          return res.status(error.status).json({ error: error.message });
        }
        next(error);
      }
    };
  }

  const operators = [requireAuth(), requireCsrf];

  router.post(
    "/api/admin/queue/add",
    ...operators,
    command(async (req) => {
      const name = typeof req.body?.name === "string" ? req.body.name : "";
      const requireApproval = req.body?.requireApproval === true;
      const entry = await queueService.addParticipant(
        name,
        requireApproval
          ? { state: queueService.PARTICIPANT_STATES.PENDING_APPROVAL }
          : { state: queueService.PARTICIPANT_STATES.WAITING }
      );
      return { extra: { entry } };
    })
  );

  router.post(
    "/api/admin/queue/approve",
    ...operators,
    command(async (req) => {
      const id = parseId(req.body?.id);
      if (!id) {
        const error = new Error("Falta el identificador del participante.");
        error.status = 400;
        throw error;
      }
      await queueService.approveParticipant(id);
      return {};
    })
  );

  router.post(
    "/api/admin/queue/reject",
    ...operators,
    command(async (req) => {
      const id = parseId(req.body?.id);
      if (!id) {
        const error = new Error("Falta el identificador del participante.");
        error.status = 400;
        throw error;
      }
      await queueService.rejectParticipant(id);
      return {};
    })
  );

  router.post(
    "/api/admin/queue/skip",
    ...operators,
    command(async (req) => {
      const id = parseId(req.body?.id);
      await queueService.skipParticipant(id === null ? undefined : id);
      return {};
    })
  );

  router.post(
    "/api/admin/queue/next",
    ...operators,
    command(async () => {
      await queueService.startNext();
      return {};
    })
  );

  router.post(
    "/api/admin/queue/pause",
    ...operators,
    command(async () => {
      await queueService.pause();
      return {};
    })
  );

  router.post(
    "/api/admin/queue/resume",
    ...operators,
    command(async () => {
      await queueService.resume();
      return {};
    })
  );

  router.post(
    "/api/admin/queue/finish",
    ...operators,
    command(async (req) => {
      const id = parseId(req.body?.id);
      await queueService.finishParticipant(id === null ? undefined : id);
      return {};
    })
  );

  return router;
}

module.exports = { createAdminRoutes };
