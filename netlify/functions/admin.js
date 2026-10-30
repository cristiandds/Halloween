const {
  getAndAdvanceState,
  pauseQueue,
  resumeQueue,
  nextParticipant,
  clearQueue,
  toggleInscriptions
} = require('./lib/store');
const { json, verifyAdmin, getAdminPassword } = require('./utils');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return json(200, { ok: true });
  }

  const path = event.path || '';
  const action = path.split('/').filter(Boolean).pop() || '';

  // Login endpoint
  if (action === 'login' && event.httpMethod === 'POST') {
    let body = {};
    try {
      body = JSON.parse(event.body || '{}');
    } catch (e) {}

    const password = body.password || '';
    const expected = getAdminPassword();

    if (password === expected) {
      return json(200, {
        ok: true,
        message: 'Acceso autorizado.',
        token: expected
      }, {
        'Set-Cookie': `admin_token=${encodeURIComponent(expected)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`
      });
    }

    return json(401, { error: 'Contraseña de administrador incorrecta.' });
  }

  // All other endpoints require admin auth
  if (!verifyAdmin(event)) {
    return json(401, { error: 'No autorizado. Se requiere contraseña de administrador.' });
  }

  try {
    // Action routing
    if (action === 'pause' || action === 'queue-pause') {
      const res = await pauseQueue(event);
      return json(200, res);
    }

    if (action === 'resume' || action === 'queue-resume') {
      const res = await resumeQueue(event);
      return json(200, res);
    }

    if (action === 'next' || action === 'queue-next') {
      const res = await nextParticipant(event);
      return json(200, res);
    }

    if (action === 'clear' || action === 'queue-clear' || action === 'empty') {
      const res = await clearQueue(event);
      return json(200, res);
    }

    if (action === 'toggle' || action === 'inscriptions-toggle') {
      let body = {};
      try { body = JSON.parse(event.body || '{}'); } catch (e) {}
      const res = await toggleInscriptions(body.open, event);
      return json(200, res);
    }

    // Default: return full admin state
    const { state, remainingMs, screenConnected } = await getAndAdvanceState({
      isScreen: false,
      event
    });

    return json(200, {
      ok: true,
      active: state.active,
      queue: state.queue,
      history: state.history,
      waiting: state.queue.length,
      paused: state.paused,
      remainingMs,
      timeRemaining: Math.ceil(remainingMs / 1000),
      inscriptionsOpen: state.inscriptionsOpen,
      displaySeconds: state.displaySeconds || 15,
      screenConnected
    });
  } catch (err) {
    console.error('Error in admin handler:', err);
    return json(500, { error: 'Error interno en el panel de administración.' });
  }
};
