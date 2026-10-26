const express = require("express");

const { noStore } = require("../middleware/security");

function createAdminRoutes({ config, state, requireAuth }) {
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

  return router;
}

module.exports = { createAdminRoutes };
