const { addParticipant } = require('./lib/store');
const { json, getClientIp, parseJsonBody } = require('./utils');

exports.default = async (request) => {
  if (request.method === 'OPTIONS') {
    return json(200, { ok: true });
  }

  if (request.method !== 'POST') {
    return json(405, { error: 'Método no permitido. Utiliza POST.' });
  }

  try {
    const parsed = await parseJsonBody(request);
    if (!parsed.ok) {
      return json(400, { error: 'Formato de datos no válido (JSON requerido).' });
    }

    const body = parsed.body || {};
    const name = body.name || '';
    const ip = getClientIp(request);

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
      isActive: false, // In queue, never active immediately at submit
      status: 'waiting',
      screenConnected: result.screenConnected,
      estimatedWaitSeconds: result.estimatedWaitSeconds
    });
  } catch (err) {
    console.error('Error in submit handler:', err);
    return json(500, { error: 'Error interno del servidor al procesar la invocación.' });
  }
};
