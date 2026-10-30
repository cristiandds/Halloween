const { getParticipantStatus } = require('./lib/store');
const { json } = require('./utils');

exports.handler = async (event) => {
  const query = event?.queryStringParameters || {};
  const id = query.id || query.participantId;

  if (!id) {
    return json(400, { error: 'Se requiere el parámetro "id".' });
  }

  try {
    const status = await getParticipantStatus(id, event);

    if (!status.found) {
      return json(404, { error: 'No se encontró registro para este participante.' });
    }

    return json(200, status);
  } catch (err) {
    console.error('Error fetching participant status:', err);
    return json(500, { error: 'Error al consultar estado del participante.' });
  }
};
