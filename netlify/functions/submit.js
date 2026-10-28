const { addParticipant } = require('./lib/store');
const { json, getClientIp } = require('./utils');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return json(200, { ok: true });
  }

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Método no permitido. Utiliza POST.' });
  }

  try {
    let body = {};
    if (event.body) {
      try {
        body = JSON.parse(event.body);
      } catch (e) {
        return json(400, { error: 'Formato de datos no válido (JSON requerido).' });
      }
    }

    const name = body.name || '';
    const ip = getClientIp(event);

    const result = await addParticipant(name, ip);

    if (!result.ok) {
      return json(result.status || 400, { error: result.error });
    }

    return json(200, {
      ok: true,
      message: '¡Tu nombre ha sido invocado en las sombras!',
      id: result.id,
      name: result.name,
      position: result.position,
      isActive: result.isActive,
      estimatedWaitSeconds: result.estimatedWaitSeconds
    });
  } catch (err) {
    console.error('Error in submit handler:', err);
    return json(500, { error: 'Error interno del servidor al procesar la invocación.' });
  }
};
