const QRCode = require("qrcode");

function generateQrSvg(text, options = {}) {
  const opts = Object.assign(
    {
      type: "svg",
      margin: 4,
      color: {
        dark: "#000000",
        light: "#FFFFFF"
      },
      errorCorrectionLevel: "M",
      width: 300
    },
    options
  );

  // qrcode.toString for SVG
  return QRCode.toString(text, opts);
}

function generateQrDataUrl(text, options = {}) {
  const opts = Object.assign(
    {
      type: "image/png",
      margin: 4,
      color: {
        dark: "#000000",
        light: "#FFFFFF"
      },
      errorCorrectionLevel: "M",
      width: 300
    },
    options
  );
  return QRCode.toDataURL(text, opts);
}

module.exports = {
  generateQrSvg,
  generateQrDataUrl
};
