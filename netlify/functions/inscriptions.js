const { getAndAdvanceState } = require('./lib/store');
const { json } = require('./utils');

exports.handler = async () => {
  try {
    const { state } = await getAndAdvanceState();
    return json(200, {
      open: Boolean(state.inscriptionsOpen),
      paused: !state.inscriptionsOpen
    });
  } catch (err) {
    return json(500, { error: 'Error al consultar estado de inscripciones.' });
  }
};
