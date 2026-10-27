const express = require("express");
const { generateQrSvg } = require("../services/qr.service");

function buildJoinUrl(publicBaseUrl) {
  if (!publicBaseUrl) {
    return null;
  }
  try {
    const url = new URL("/join", publicBaseUrl);
    return url.toString();
  } catch (error) {
    return null;
  }
}

function createQrRoutes({ config }) {
  const router = express.Router();

  router.get("/api/qr.svg", async (req, res) => {
    try {
      const joinUrl = buildJoinUrl(config.PUBLIC_BASE_URL);
      if (!joinUrl) {
        console.error("Error generando QR: PUBLIC_BASE_URL no configurada o inválida");
        return res.status(500).type("text/plain").send("Error al generar el código QR.");
      }

      const svg = await generateQrSvg(joinUrl, {
        type: "svg",
        margin: 4,
        color: {
          dark: "#000000",
          light: "#FFFFFF"
        },
        errorCorrectionLevel: "M",
        width: 300
      });

      res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
      res.setHeader("Pragma", "no-cache");
      return res.status(200).send(svg);
    } catch (error) {
      console.error("Error generando QR SVG:", error);
      return res.status(500).type("text/plain").send("Error al generar el código QR.");
    }
  });

  router.get("/api/qr", async (req, res) => {
    try {
      const joinUrl = buildJoinUrl(config.PUBLIC_BASE_URL);
      if (!joinUrl) {
        console.error("Error generando QR: PUBLIC_BASE_URL no configurada o inválida");
        return res.status(500).json({ error: "Error al generar el código QR." });
      }
      const svg = await generateQrSvg(joinUrl, {
        type: "svg",
        margin: 4,
        color: {
          dark: "#000000",
          light: "#FFFFFF"
        },
        errorCorrectionLevel: "M",
        width: 300
      });
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
      res.setHeader("Pragma", "no-cache");
      return res.status(200).json({ svg, joinUrl });
    } catch (error) {
      console.error("Error generando QR:", error);
      return res.status(500).json({ error: "Error al generar el código QR." });
    }
  });

  return router;
}

module.exports = { createQrRoutes };
