const fs = require('fs');
const path = require('path');

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
  if (!fs.existsSync(localDir)) {
    try {
      fs.mkdirSync(localDir, { recursive: true });
    } catch (e) {
      // Fallback to /tmp if current dir is read-only
      return path.resolve('/tmp', 'halloween-queue.json');
    }
  }
  return path.resolve(localDir, 'halloween-queue.json');
}

let cachedBlobsStore = null;
let blobsFailed = false;

function getBlobsStore() {
  if (blobsFailed) return null;
  if (cachedBlobsStore) return cachedBlobsStore;
  try {
    const { getStore } = require('@netlify/blobs');
    cachedBlobsStore = getStore('halloween-queue');
    return cachedBlobsStore;
  } catch (err) {
    blobsFailed = true;
    return null;
  }
}

function createDefaultState() {
  return {
    schemaVersion: 3,
    active: null,
    queue: [],
    history: [],
    paused: false,
    pausedRemainingMs: 0,
    inscriptionsOpen: true,
    displaySeconds: DEFAULT_DISPLAY_SECONDS,
    nextId: 1,
    updatedAt: Date.now()
  };
}

async function loadRawState() {
  const store = getBlobsStore();
  if (store) {
    try {
      const data = await store.get('event-state', { type: 'json' });
      if (data && typeof data === 'object') {
        return sanitizeLoadedState(data);
      }
    } catch (err) {
      // If Blobs fails at runtime, fallback to file
      console.warn('Blobs read fallback:', err.message);
    }
  }

  // Local file fallback
  try {
    const filePath = getLocalFilePath();
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      const data = JSON.parse(content);
      return sanitizeLoadedState(data);
    }
  } catch (err) {
    console.warn('File read error:', err.message);
  }

  return createDefaultState();
}

async function saveRawState(state) {
  state.updatedAt = Date.now();
  const store = getBlobsStore();
  let savedToBlobs = false;

  if (store) {
    try {
      await store.setJSON('event-state', state);
      savedToBlobs = true;
    } catch (err) {
      console.warn('Blobs write fallback:', err.message);
    }
  }

  // Always write to local file as well for resilience / local dev
  try {
    const filePath = getLocalFilePath();
    const tempPath = `${filePath}.tmp.${Date.now()}`;
    fs.writeFileSync(tempPath, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(tempPath, filePath);
  } catch (err) {
    if (!savedToBlobs) {
      console.error('Failed to save state to both Blobs and file:', err.message);
    }
  }
}

function sanitizeLoadedState(raw) {
  const defaults = createDefaultState();
  return {
    schemaVersion: 3,
    active: raw.active || null,
    queue: Array.isArray(raw.queue) ? raw.queue : [],
    history: Array.isArray(raw.history) ? raw.history : [],
    paused: Boolean(raw.paused),
    pausedRemainingMs: typeof raw.pausedRemainingMs === 'number' ? raw.pausedRemainingMs : 0,
    inscriptionsOpen: raw.inscriptionsOpen !== false,
    displaySeconds: typeof raw.displaySeconds === 'number' ? raw.displaySeconds : DEFAULT_DISPLAY_SECONDS,
    nextId: typeof raw.nextId === 'number' ? raw.nextId : (raw.queue?.length || 0) + 1,
    updatedAt: raw.updatedAt || Date.now()
  };
}

function pickHorrorPhrase(avoidPhrase = null) {
  const pool = HORROR_PHRASES.filter(p => p !== avoidPhrase);
  const candidates = pool.length > 0 ? pool : HORROR_PHRASES;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

/**
 * Core state machine progression:
 * Called whenever state is queried. Advances active participant if 15s elapsed.
 */
async function getAndAdvanceState() {
  const state = await loadRawState();
  const now = Date.now();
  let stateModified = false;

  const durationMs = (state.displaySeconds || DEFAULT_DISPLAY_SECONDS) * 1000;

  if (!state.paused) {
    if (state.active) {
      const startedAt = state.active.startedAt || now;
      const elapsed = now - startedAt;
      const participantDuration = state.active.durationMs || durationMs;

      if (elapsed >= participantDuration) {
        // Current participant finished!
        const finishedParticipant = {
          ...state.active,
          finishedAt: now
        };
        state.history.unshift(finishedParticipant);
        if (state.history.length > MAX_HISTORY_LENGTH) {
          state.history.length = MAX_HISTORY_LENGTH;
        }

        // Advance to next if available
        if (state.queue.length > 0) {
          const next = state.queue.shift();
          state.active = {
            id: next.id,
            name: next.name,
            phrase: next.phrase || pickHorrorPhrase(finishedParticipant.phrase),
            startedAt: now,
            durationMs: durationMs
          };
        } else {
          // Queue is empty, return to QR mode!
          state.active = null;
        }
        stateModified = true;
      }
    } else {
      // No active participant, but queue has items
      if (state.queue.length > 0) {
        const next = state.queue.shift();
        const lastPhrase = state.history[0]?.phrase || null;
        state.active = {
          id: next.id,
          name: next.name,
          phrase: next.phrase || pickHorrorPhrase(lastPhrase),
          startedAt: now,
          durationMs: durationMs
        };
        stateModified = true;
      }
    }
  }

  if (stateModified) {
    await saveRawState(state);
  }

  // Calculate live remaining time for consumer
  let remainingMs = 0;
  if (state.active) {
    if (state.paused) {
      remainingMs = Math.max(0, state.pausedRemainingMs);
    } else {
      const elapsed = now - (state.active.startedAt || now);
      const participantDuration = state.active.durationMs || durationMs;
      remainingMs = Math.max(0, participantDuration - elapsed);
    }
  }

  return {
    state,
    remainingMs
  };
}

/**
 * Add a new participant from /join
 */
async function addParticipant(rawName, ip = null) {
  if (!checkRateLimit(ip)) {
    return {
      ok: false,
      status: 429,
      error: "Has enviado demasiadas solicitudes. Por favor espera un momento."
    };
  }

  const { state } = await getAndAdvanceState();

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

  const durationMs = (state.displaySeconds || DEFAULT_DISPLAY_SECONDS) * 1000;
  const now = Date.now();

  const participant = {
    id: newId,
    name,
    phrase,
    registeredAt: now
  };

  // If there is no active participant and queue is not paused, activate immediately
  if (!state.active && !state.paused) {
    state.active = {
      ...participant,
      startedAt: now,
      durationMs: durationMs
    };
    await saveRawState(state);
    return {
      ok: true,
      id: newId,
      name,
      position: 1,
      isActive: true,
      estimatedWaitSeconds: 0
    };
  }

  // Otherwise, append to queue
  state.queue.push(participant);
  await saveRawState(state);

  const position = state.queue.length + (state.active ? 1 : 0);
  const remainingActiveSeconds = state.active ? Math.ceil(((state.active.startedAt + (state.active.durationMs || durationMs)) - now) / 1000) : 0;
  const estimatedWaitSeconds = Math.max(0, remainingActiveSeconds + (state.queue.length - 1) * (state.displaySeconds || DEFAULT_DISPLAY_SECONDS));

  return {
    ok: true,
    id: newId,
    name,
    position,
    isActive: false,
    estimatedWaitSeconds
  };
}

/**
 * Admin action: Pause projection
 */
async function pauseQueue() {
  const { state, remainingMs } = await getAndAdvanceState();
  if (state.paused) {
    return { ok: true, paused: true };
  }
  state.paused = true;
  state.pausedRemainingMs = remainingMs;
  await saveRawState(state);
  return { ok: true, paused: true, remainingMs };
}

/**
 * Admin action: Resume projection
 */
async function resumeQueue() {
  const { state } = await getAndAdvanceState();
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
  await saveRawState(state);
  return { ok: true, paused: false };
}

/**
 * Admin action: Skip to next participant
 */
async function nextParticipant() {
  const state = await loadRawState();
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

  state.pausedRemainingMs = durationMs;
  await saveRawState(state);
  return { ok: true, active: state.active };
}

/**
 * Admin action: Clear waiting queue
 */
async function clearQueue() {
  const state = await loadRawState();
  state.queue = [];
  state.active = null;
  state.paused = false;
  state.pausedRemainingMs = 0;
  await saveRawState(state);
  return { ok: true, message: "Cola vaciada exitosamente." };
}

/**
 * Admin action: Toggle inscriptions
 */
async function toggleInscriptions(open = null) {
  const state = await loadRawState();
  state.inscriptionsOpen = open !== null ? Boolean(open) : !state.inscriptionsOpen;
  await saveRawState(state);
  return { ok: true, inscriptionsOpen: state.inscriptionsOpen };
}

/**
 * Get participant status for mobile tracking
 */
async function getParticipantStatus(participantId) {
  const { state, remainingMs } = await getAndAdvanceState();
  const pid = Number(participantId);

  if (state.active && state.active.id === pid) {
    return {
      found: true,
      state: 'active',
      name: state.active.name,
      phrase: state.active.phrase,
      position: 1,
      estimatedWaitSeconds: 0,
      remainingSeconds: Math.ceil(remainingMs / 1000)
    };
  }

  const qIndex = state.queue.findIndex(p => p.id === pid);
  if (qIndex >= 0) {
    const position = qIndex + (state.active ? 2 : 1);
    const duration = state.displaySeconds || DEFAULT_DISPLAY_SECONDS;
    const estimatedWait = Math.ceil(remainingMs / 1000) + (qIndex * duration);
    return {
      found: true,
      state: 'waiting',
      name: state.queue[qIndex].name,
      position,
      estimatedWaitSeconds: estimatedWait
    };
  }

  const historyMatch = state.history.find(p => p.id === pid);
  if (historyMatch) {
    return {
      found: true,
      state: 'completed',
      name: historyMatch.name,
      position: null,
      estimatedWaitSeconds: null
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
  getParticipantStatus
};
