const { getInscriptionsStatus } = require('./lib/store');
const { json } = require('./utils');

exports.default = async () => {
  try {
    // Read-only: checking inscriptions must never advance the projection queue.
    const status = await getInscriptionsStatus();
    return json(200, status);
  } catch (err) {
    console.error('Error in inscriptions handler:', err);
    return json(500, { error: 'Error al consultar estado de inscripciones.' });
  }
};
