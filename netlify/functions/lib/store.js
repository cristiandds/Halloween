const fs = require('fs');
const path = require('path');
const os = require('os');

const HORROR_PHRASES = [
  "El eco de tus pasos no te pertenece...",
  "La oscuridad conoce tu verdadero nombre.",
  "No mires hacia atrás. Ya está demasiado cerca.",
  "Algo respira a tu lado en la penumbra.",
  "Tus pesadillas ya encontraron el camino.",
  "Bienvenido al ritual. Nadie sale ileso.",
  "Un susurro helado reclama tu alma.",
  "La puerta se cerró. Quedaste atrapado.",
  "Los ojos de la sombra no parpadean.",
  "Tu destino quedó sellado esta noche.",
  "El espejo reflejó lo que nunca debiste ver.",
  "La campana de medianoche dobló por ti.",
  "Siente el frío rozando tu cuello...",
  "Esta noche los muertos no caminan solos.",
  "Un escalofrío te avisa que ya no estás solo."
];

const DEFAULT_DISPLAY_SECONDS = 15;
const MAX_QUEUE_LENGTH = 100;
const MAX_HISTORY_LENGTH = 50;
const SCREEN_TIMEOUT_MS = 6000; // Screen polls every ~1.2s; 6s is ~4-5 missed polls

// Rate limit memory cache for IP submissions
const ipRateLimits = new Map();

function cleanOldRateLimits() {
  const now = Date.now();
  for (const [ip, data] of ipRateLimits.entries()) {
    if (now - data.timestamp > 60000) {
      ipRateLimits.delete(ip);
    }
  }
}

function checkRateLimit(ip) {
  if (!ip) return true;
  cleanOldRateLimits();
  const now = Date.now();
  const entry = ipRateLimits.get(ip);
  if (!entry) {
    ipRateLimits.set(ip, { count: 1, timestamp: now });
    return true;
  }
  if (now - entry.timestamp > 30000) {
    ipRateLimits.set(ip, { count: 1, timestamp: now });
    return true;
  }
  if (entry.count >= 5) {
    return false;
  }
  entry.count += 1;
  return true;
}

// Local file fallback path
function getLocalFilePath() {
  const localDir = path.resolve(process.cwd(), '.data');
  try {
    if (!fs.existsSync(localDir)) {
      fs.mkdirSync(localDir, { recursive: true });
    }
    return path.resolve(localDir, 'halloween-queue.json');
  } catch (e) {
    // Fallback to OS tmp directory if current dir is read-only (e.g. AWS Lambda without Blobs)
    return path.resolve(os.tmpdir(), 'halloween-queue.json');
  }
}

/**
 * Detect production Lambda/Netlify Functions. Files in /tmp are NOT shared
 * between serverless instances and must never be used as production storage.
 */
function isNetlifyRuntime() {
  return process.env.NETLIFY === 'true' ||
    process.env.NETLIFY_DEV === 'true' ||
    Boolean(process.env.NETLIFY_SITE_ID || process.env.SITE_ID || process.env.DEPLOY_ID || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

function initBlobs(event = null) {
  // Classic handler(event) = Lambda compatibility mode. The Blobs SDK requires
  // connectLambda(event) to be called before every getStore operation.
  if (!isNetlifyRuntime()) return;
  if (!event) {
    throw new Error('Netlify Blobs: falta el evento de la función Lambda.');
  }
  const { connectLambda } = require('@netlify/blobs');
  connectLambda(event);
}

function getBlobsStore(event = null) {
  if (!isNetlifyRuntime()) return null;
  initBlobs(event);
  const { getStore } = require('@netlify/blobs');
  return getStore({ name: 'halloween-queue', consistency: 'strong' });
}

function createDefaultState() {
  return {
    schemaVersion: 4,
    active: null,
    queue: [],
    history: [],
    paused: false,
    pausedRemainingMs: 0,
    inscriptionsOpen: true,
    displaySeconds: DEFAULT_DISPLAY_SECONDS,
    nextId: 1,
    lastScreenPing: 0,
    updatedAt: Date.now()
  };
}

function isScreenConnected(state, now = Date.now()) {
  return typeof state.lastScreenPing === 'number' && (now - state.lastScreenPing) < SCREEN_TIMEOUT_MS;
}

function sanitizeLoadedState(raw) {
  const defaults = createDefaultState();
  return {
    schemaVersion: 4,
    active: raw.active && typeof raw.active === 'object' ? {
      id: raw.active.id,
      name: raw.active.name,
      phrase: raw.active.phrase,
      startedAt: raw.active.startedAt,
      durationMs: raw.active.durationMs,
      frozenRemainingMs: typeof raw.active.frozenRemainingMs === 'number' ? raw.active.frozenRemainingMs : undefined
    } : null,
    queue: Array.isArray(raw.queue) ? raw.queue : [],
    history: Array.isArray(raw.history) ? raw.history : [],
    paused: Boolean(raw.paused),
    pausedRemainingMs: typeof raw.pausedRemainingMs === 'number' ? raw.pausedRemainingMs : 0,
    inscriptionsOpen: raw.inscriptionsOpen !== false,
    displaySeconds: typeof raw.displaySeconds === 'number' ? raw.displaySeconds : DEFAULT_DISPLAY_SECONDS,
    nextId: typeof raw.nextId === 'number' ? raw.nextId : ((raw.queue?.length || 0) + (raw.history?.length || 0) + 1),
    lastScreenPing: typeof raw.lastScreenPing === 'number' ? raw.lastScreenPing : 0,
    updatedAt: raw.updatedAt || Date.now()
  };
}

async function loadRawState(event = null) {
  if (isNetlifyRuntime()) {
    // Fail visibly instead of silently reading an unrelated instance's /tmp.
    try {
      const store = getBlobsStore(event);
      const data = await store.get('event-state', { type: 'json', consistency: 'strong' });
      return data && typeof data === 'object' ? sanitizeLoadedState(data) : createDefaultState();
    } catch (err) {
      console.error('[Halloween/Blobs] Error al LEER estado compartido:', err);
      throw new Error('Almacenamiento compartido no disponible: verifica Netlify Blobs y Functions logs.');
    }
  }

  // Only local development may use a local file.
  try {
    const filePath = getLocalFilePath();
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return sanitizeLoadedState(data);
    }
  } catch (err) {
    console.warn('[Halloween/local] No se pudo leer el archivo local:', err.message);
  }
  return createDefaultState();
}

async function saveRawState(state, event = null) {
  state.updatedAt = Date.now();
  if (isNetlifyRuntime()) {
    try {
      const store = getBlobsStore(event);
      await store.setJSON('event-state', state);
      return;
    } catch (err) {
      console.error('[Halloween/Blobs] Error al GUARDAR estado compartido:', err);
      throw new Error('No se pudo guardar en el almacenamiento compartido. Registro cancelado.');
    }
  }

  // Local-only persistence for Node.js dev/tests.
  const filePath = getLocalFilePath();
  try {
    const tempPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
    fs.writeFileSync(tempPath, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(tempPath, filePath);
  } catch (err) {
    console.error('[Halloween/local] No se pudo persistir estado:', err);
    throw err;
  }
}

function pickHorrorPhrase(avoidPhrase = null) {
  const pool = HORROR_PHRASES.filter(p => p !== avoidPhrase);
  const candidates = pool.length > 0 ? pool : HORROR_PHRASES;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

/**
 * Core state machine progression:
 * Advances active participant when duration elapses IF screen is connected.
 * Keeps participants in queue if screen is disconnected.
 */
async function getAndAdvanceState(options = {}) {
  const event = options.event || null;
  const state = await loadRawState(event);
  const now = Date.now();
  let stateModified = false;

  let isScreen = Boolean(options.isScreen);
  if (!isScreen && event) {
    const q = event.queryStringParameters || {};
    const h = event.headers || {};
    if (q.role === 'screen' || q.screen === '1' || h['x-screen-role'] === 'screen') {
      isScreen = true;
    }
  }

  // If this request comes from the screen projection, update last ping
  if (isScreen) {
    state.lastScreenPing = now;
    stateModified = true;
  }

  const durationMs = (state.displaySeconds || DEFAULT_DISPLAY_SECONDS) * 1000;
  const screenActive = isScreenConnected(state, now);

  if (!state.paused) {
    if (screenActive) {
      // Screen is CONNECTED
      if (state.active) {
        // If active was frozen while screen was disconnected, unfreeze and adjust startedAt
        if (typeof state.active.frozenRemainingMs === 'number') {
          const remaining = Math.max(1000, state.active.frozenRemainingMs);
          state.active.startedAt = now - (state.active.durationMs - remaining);
          delete state.active.frozenRemainingMs;
          stateModified = true;
        }

        const startedAt = state.active.startedAt || now;
        const elapsed = now - startedAt;
        const participantDuration = state.active.durationMs || durationMs;

        if (elapsed >= participantDuration) {
          // Current participant finished their 15 seconds!
          const finishedParticipant = {
            ...state.active,
            finishedAt: now
          };
          state.history.unshift(finishedParticipant);
          if (state.history.length > MAX_HISTORY_LENGTH) {
            state.history.length = MAX_HISTORY_LENGTH;
          }

          // Advance to next if queue has waiting participants (Requirement 4)
          if (state.queue.length > 0) {
            const next = state.queue.shift();
            state.active = {
              id: next.id,
              name: next.name,
              phrase: next.phrase || pickHorrorPhrase(finishedParticipant.phrase),
              startedAt: now, // 15 SECONDS REAL TIME START RIGHT NOW! (Requirement 3)
              durationMs: durationMs
            };
          } else {
            // Queue is empty -> return to QR mode! (Requirement 5)
            state.active = null;
          }
          stateModified = true;
        }
      } else {
        // No active participant, but screen is connected: activate next from queue
        if (state.queue.length > 0) {
          const next = state.queue.shift();
          const lastPhrase = state.history[0]?.phrase || null;
          state.active = {
            id: next.id,
            name: next.name,
            phrase: next.phrase || pickHorrorPhrase(lastPhrase),
            startedAt: now, // 15 SECONDS REAL TIME START RIGHT NOW! (Requirement 3)
            durationMs: durationMs
          };
          stateModified = true;
        }
      }
    } else {
      // Screen is DISCONNECTED (Requirement 7)
      // Do not advance queue. If someone was currently active, freeze their remaining time.
      if (state.active && typeof state.active.frozenRemainingMs !== 'number') {
        const elapsed = now - (state.active.startedAt || now);
        const participantDuration = state.active.durationMs || durationMs;
        state.active.frozenRemainingMs = Math.max(1000, participantDuration - elapsed);
        stateModified = true;
      }
    }
  }

  if (stateModified) {
    await saveRawState(state, event);
  }

  // Calculate live remaining time for consumer
  let remainingMs = 0;
  if (state.active) {
    if (state.paused) {
      remainingMs = Math.max(0, state.pausedRemainingMs);
    } else if (typeof state.active.frozenRemainingMs === 'number') {
      remainingMs = state.active.frozenRemainingMs;
    } else {
      const elapsed = now - (state.active.startedAt || now);
      const participantDuration = state.active.durationMs || durationMs;
      remainingMs = Math.max(0, participantDuration - elapsed);
    }
  }

  return {
    state,
    remainingMs,
    screenConnected: screenActive
  };
}

/**
 * Add a new participant from /join
 * Always places in queue so participant never appears "EN PANTALLA" incorrectly
 */
async function addParticipant(rawName, ip = null, event = null) {
  if (!checkRateLimit(ip)) {
    return {
      ok: false,
      status: 429,
      error: "Has enviado demasiadas solicitudes. Por favor espera un momento."
    };
  }

  const state = await loadRawState(event);
  const now = Date.now();

  if (!state.inscriptionsOpen) {
    return {
      ok: false,
      status: 403,
      error: "Las inscripciones para el ritual están cerradas temporalmente."
    };
  }

  const name = typeof rawName === 'string' ? rawName.trim().replace(/\s+/g, ' ') : '';

  if (name.length < 2 || name.length > 32) {
    return {
      ok: false,
      status: 400,
      error: "El nombre debe tener entre 2 y 32 caracteres."
    };
  }

  // Sanitize: disallow dangerous HTML or injection characters
  if (/[<>]/.test(name) || /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2060\uFEFF\u202A-\u202E]/.test(name)) {
    return {
      ok: false,
      status: 400,
      error: "El nombre contiene caracteres no permitidos."
    };
  }

  if (state.queue.length >= MAX_QUEUE_LENGTH) {
    return {
      ok: false,
      status: 429,
      error: "La cola del ritual está llena. Espera unos momentos antes de reintentar."
    };
  }

  // Duplicate check: check active and waiting queue (case insensitive)
  const normalizedLower = name.toLowerCase();
  const isActiveMatch = state.active && state.active.name.toLowerCase() === normalizedLower;
  const isQueueMatch = state.queue.some(p => p.name.toLowerCase() === normalizedLower);

  if (isActiveMatch || isQueueMatch) {
    return {
      ok: false,
      status: 409,
      error: "Este nombre ya está en la invocación o esperando en la cola."
    };
  }

  const newId = state.nextId++;
  const lastPhrase = state.active?.phrase || state.history[0]?.phrase || null;
  const phrase = pickHorrorPhrase(lastPhrase);

  const participant = {
    id: newId,
    name,
    phrase,
    registeredAt: now
  };

  // Always append to queue (Requirement 4, 6)
  state.queue.push(participant);
  await saveRawState(state, event);

  const durationSec = state.displaySeconds || DEFAULT_DISPLAY_SECONDS;
  const position = state.queue.length; // Position in waiting queue

  let remainingActiveSec = 0;
  if (state.active) {
    remainingActiveSec = Math.max(0, Math.ceil(((state.active.startedAt + (state.active.durationMs || durationSec * 1000)) - now) / 1000));
  }
  const estimatedWaitSeconds = remainingActiveSec + ((position - 1) * durationSec);

  return {
    ok: true,
    id: newId,
    name,
    position,
    isActive: false, // Never active immediately on submit (Requirement 6)
    status: 'waiting',
    screenConnected: isScreenConnected(state, now),
    estimatedWaitSeconds: Math.max(0, estimatedWaitSeconds)
  };
}

/**
 * Admin action: Pause projection
 */
async function pauseQueue(event = null) {
  const state = await loadRawState(event);
  if (state.paused) {
    return { ok: true, paused: true };
  }
  const now = Date.now();
  const durationMs = (state.displaySeconds || DEFAULT_DISPLAY_SECONDS) * 1000;
  let remainingMs = 0;
  if (state.active) {
    const elapsed = now - (state.active.startedAt || now);
    remainingMs = Math.max(0, (state.active.durationMs || durationMs) - elapsed);
  }
  state.paused = true;
  state.pausedRemainingMs = remainingMs;
  await saveRawState(state, event);
  return { ok: true, paused: true, remainingMs };
}

/**
 * Admin action: Resume projection
 */
async function resumeQueue(event = null) {
  const state = await loadRawState(event);
  if (!state.paused) {
    return { ok: true, paused: false };
  }
  state.paused = false;
  const now = Date.now();
  const durationMs = (state.displaySeconds || DEFAULT_DISPLAY_SECONDS) * 1000;

  if (state.active) {
    const remaining = typeof state.pausedRemainingMs === 'number' ? state.pausedRemainingMs : durationMs;
    state.active.startedAt = now - (durationMs - remaining);
    state.active.durationMs = durationMs;
    delete state.active.frozenRemainingMs;
  } else if (state.queue.length > 0) {
    const next = state.queue.shift();
    state.active = {
      id: next.id,
      name: next.name,
      phrase: next.phrase || pickHorrorPhrase(),
      startedAt: now,
      durationMs: durationMs
    };
  }

  state.pausedRemainingMs = 0;
  await saveRawState(state, event);
  return { ok: true, paused: false };
}

/**
 * Admin action: Skip to next participant
 */
async function nextParticipant(event = null) {
  const state = await loadRawState(event);
  const now = Date.now();
  const durationMs = (state.displaySeconds || DEFAULT_DISPLAY_SECONDS) * 1000;

  if (state.active) {
    state.history.unshift({
      ...state.active,
      finishedAt: now
    });
    if (state.history.length > MAX_HISTORY_LENGTH) {
      state.history.length = MAX_HISTORY_LENGTH;
    }
  }

  if (state.queue.length > 0) {
    const next = state.queue.shift();
    state.active = {
      id: next.id,
      name: next.name,
      phrase: next.phrase || pickHorrorPhrase(),
      startedAt: now,
      durationMs: durationMs
    };
  } else {
    state.active = null;
  }

  state.pausedRemainingMs = 0;
  await saveRawState(state, event);
  return { ok: true, active: state.active };
}

/**
 * Admin action: Clear waiting queue
 */
async function clearQueue(event = null) {
  const state = await loadRawState(event);
  state.queue = [];
  state.active = null;
  state.paused = false;
  state.pausedRemainingMs = 0;
  await saveRawState(state, event);
  return { ok: true, message: "Cola vaciada exitosamente." };
}

/**
 * Admin action: Toggle inscriptions
 */
async function toggleInscriptions(open = null, event = null) {
  const state = await loadRawState(event);
  state.inscriptionsOpen = open !== null ? Boolean(open) : !state.inscriptionsOpen;
  await saveRawState(state, event);
  return { ok: true, inscriptionsOpen: state.inscriptionsOpen };
}

/**
 * Get participant status for mobile tracking
 * Read-only status query: does not mutate or advance projection queue
 */
async function getParticipantStatus(participantId, event = null) {
  const state = await loadRawState(event);
  const pid = Number(participantId);
  const now = Date.now();
  const durationSec = state.displaySeconds || DEFAULT_DISPLAY_SECONDS;
  const durationMs = durationSec * 1000;
  const screenActive = isScreenConnected(state, now);

  // Check 1: Is this participant currently active?
  if (state.active && state.active.id === pid) {
    let remainingSec = 0;
    if (state.paused) {
      remainingSec = Math.ceil((state.pausedRemainingMs || 0) / 1000);
    } else if (typeof state.active.frozenRemainingMs === 'number') {
      remainingSec = Math.ceil(state.active.frozenRemainingMs / 1000);
    } else {
      const elapsed = now - (state.active.startedAt || now);
      remainingSec = Math.max(0, Math.ceil((durationMs - elapsed) / 1000));
    }

    return {
      found: true,
      state: 'active',
      name: state.active.name,
      phrase: state.active.phrase,
      position: 1,
      estimatedWaitSeconds: 0,
      remainingSeconds: remainingSec,
      screenConnected: screenActive
    };
  }

  // Check 2: Is this participant waiting in queue?
  const qIndex = state.queue.findIndex(p => p.id === pid);
  if (qIndex >= 0) {
    const position = qIndex + 1; // 1-based position in waiting queue
    let remainingActiveSec = 0;
    if (state.active) {
      if (typeof state.active.frozenRemainingMs === 'number') {
        remainingActiveSec = Math.ceil(state.active.frozenRemainingMs / 1000);
      } else {
        const elapsed = now - (state.active.startedAt || now);
        remainingActiveSec = Math.max(0, Math.ceil((durationMs - elapsed) / 1000));
      }
    }

    const estimatedWait = remainingActiveSec + (qIndex * durationSec);
    return {
      found: true,
      state: 'waiting',
      name: state.queue[qIndex].name,
      position,
      estimatedWaitSeconds: estimatedWait,
      screenConnected: screenActive
    };
  }

  // Check 3: Is this participant in history (completed)?
  const historyMatch = state.history.find(p => p.id === pid);
  if (historyMatch) {
    return {
      found: true,
      state: 'completed',
      name: historyMatch.name,
      position: null,
      estimatedWaitSeconds: null,
      screenConnected: screenActive
    };
  }

  return {
    found: false,
    state: null
  };
}

module.exports = {
  HORROR_PHRASES,
  pickHorrorPhrase,
  getAndAdvanceState,
  addParticipant,
  pauseQueue,
  resumeQueue,
  nextParticipant,
  clearQueue,
  toggleInscriptions,
  getParticipantStatus,
  isScreenConnected,
  loadRawState,
  saveRawState
};
