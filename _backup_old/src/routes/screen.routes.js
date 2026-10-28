const express = require("express");

const { noStore } = require("../middleware/security");

function createScreenRoutes({ config, requireAuth }) {
  const router = express.Router();

  router.get("/screen", requireAuth({ redirectToLogin: true }), (req, res) => {
    noStore(req, res, () => {});
    res.sendFile(config.SCREEN_HTML);
  });

  router.get(["/screen.html", "/screen/index.html"], (req, res) => {
    res.status(404).type("text/plain").send("No encontrado.");
  });

  return router;
}

module.exports = { createScreenRoutes };
