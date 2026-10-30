const { getAndAdvanceState } = require('./lib/store');
const { json, getHeader, getSearchParams } = require('./utils');

exports.default = async (request) => {
  try {
    const query = getSearchParams(request);
    // Identify if the request comes from the projection screen
    const isScreen = query.get('role') === 'screen' ||
      query.get('screen') === '1' ||
      getHeader(request, 'x-screen-role') === 'screen';

    const { state, remainingMs, screenConnected } = await getAndAdvanceState({
      isScreen
    });

    const isActive = Boolean(state.active);
    const activeName = state.active ? state.active.name : null;
    const activePhrase = state.active ? state.active.phrase : null;
    const queuePreview = state.queue.map(p => p.name);

    return json(200, {
      status: isActive ? 'active' : 'qr',
      mode: isActive ? 'active' : 'qr',
      active: state.active,
      activeName,
      activePhrase,
      waiting: state.queue.length,
      pendingCount: state.queue.length,
      queuePreview,
      remainingMs,
      timeRemaining: Math.ceil(remainingMs / 1000),
      paused: state.paused,
      displaySeconds: state.displaySeconds || 15,
      inscriptionsOpen: state.inscriptionsOpen,
      screenConnected,
      serverTime: Date.now()
    });
  } catch (err) {
    console.error('Error in state handler:', err);
    return json(500, { error: 'Error interno al consultar el estado de la invocación.' });
  }
};
