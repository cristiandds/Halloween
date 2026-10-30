const {
  getAndAdvanceState,
  pauseQueue,
  resumeQueue,
  nextParticipant,
  clearQueue,
  toggleInscriptions
} = require('./lib/store');
const {
  json,
  getAdminPassword,
  getPathname,
  parseJsonBody,
  verifyAdmin
} = require('./utils');

exports.default = async (request) => {
  if (request.method === 'OPTIONS') {
    return json(200, { ok: true });
  }

  const pathname = getPathname(request);
  const action = pathname.split('/').filter(Boolean).pop() || '';

  const parsed = await parseJsonBody(request);
  const body = parsed.ok && parsed.body && typeof parsed.body === 'object' ? parsed.body : {};

  // Login endpoint
  if (action === 'login' && request.method === 'POST') {
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
  if (!verifyAdmin(request, body)) {
    return json(401, { error: 'No autorizado. Se requiere contraseña de administrador.' });
  }

  try {
    // Action routing
    if (action === 'pause' || action === 'queue-pause') {
      const res = await pauseQueue();
      return json(200, res);
    }

    if (action === 'resume' || action === 'queue-resume') {
      const res = await resumeQueue();
      return json(200, res);
    }

    if (action === 'next' || action === 'queue-next') {
      const res = await nextParticipant();
      return json(200, res);
    }

    if (action === 'clear' || action === 'queue-clear' || action === 'empty') {
      const res = await clearQueue();
      return json(200, res);
    }

    if (action === 'toggle' || action === 'inscriptions-toggle') {
      const res = await toggleInscriptions(body.open);
      return json(200, res);
    }

    // Default: return full admin state
    const { state, remainingMs, screenConnected } = await getAndAdvanceState({
      isScreen: false
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
