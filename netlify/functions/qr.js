const QRCode = require('qrcode');
const { json, getBaseUrl } = require('./utils');

exports.default = async (request) => {
  try {
    const baseUrl = getBaseUrl(request);
    const joinUrl = baseUrl ? `${baseUrl}/join` : '/join';

    // Generate high quality SVG QR code
    const svg = await QRCode.toString(joinUrl, {
      type: 'svg',
      margin: 1,
      width: 400,
      color: {
        dark: '#000000',
        light: '#ffffff'
      },
      errorCorrectionLevel: 'M'
    });

    return json(200, {
      joinUrl,
      svg
    });
  } catch (err) {
    console.error('Error generating QR code:', err);
    return json(500, { error: 'No se pudo generar el código QR.' });
  }
};
