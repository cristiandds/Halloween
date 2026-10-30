const { getParticipantStatus } = require('./lib/store');
const { json, getSearchParams } = require('./utils');

exports.default = async (request) => {
  const query = getSearchParams(request);
  const id = query.get('id') || query.get('participantId');

  if (!id) {
    return json(400, { error: 'Se requiere el parámetro "id".' });
  }

  try {
    const status = await getParticipantStatus(id);

    if (!status.found) {
      return json(404, { error: 'No se encontró registro para este participante.' });
    }

    return json(200, status);
  } catch (err) {
    console.error('Error fetching participant status:', err);
    return json(500, { error: 'Error al consultar estado del participante.' });
  }
};
