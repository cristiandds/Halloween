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
const STORE_NAME = 'halloween-queue';
const STATE_KEY = 'event-state';
const MAX_MUTATION_ATTEMPTS = 30;

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

// Local file fallback path (development/tests only).
function getLocalFilePath() {
  const override = process.env.HALLOWEEN_DATA_FILE;
  if (override && override.trim()) {
    return path.resolve(override.trim());
  }
  const localDir = path.resolve(process.cwd(), '.data');
  try {
    if (!fs.existsSync(localDir)) {
      fs.mkdirSync(localDir, { recursive: true });
    }
    return path.resolve(localDir, 'halloween-queue.json');
  } catch (e) {
    // Fallback to OS tmp directory if current dir is read-only.
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
    process.env.NETLIFY_LOCAL === 'true' ||
    Boolean(process.env.NETLIFY_BLOBS_CONTEXT) ||
    Boolean(process.env.NETLIFY_SITE_ID || process.env.SITE_ID || process.env.DEPLOY_ID || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

/**
 * Netlify Functions v2 inject the Blobs context (including uncachedEdgeURL)
 * through NETLIFY_BLOBS_CONTEXT. The SDK reads that ambient context itself,
 * so no event/connectLambda wiring is needed or compatible here.
 */
function getBlobsStore() {
  if (!isNetlifyRuntime()) return null;
  const { getStore } = require('@netlify/blobs');
  return getStore({ name: STORE_NAME, consistency: 'strong' });
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

function readLocalState() {
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

function writeLocalState(state) {
  const filePath = getLocalFilePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tempPath, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tempPath, filePath);
}

// Serializes read-modify-write cycles inside a single local Node process.
let localWriteChain = Promise.resolve();

function withLocalLock(task) {
  const result = localWriteChain.then(task, task);
  localWriteChain = result.then(() => undefined, () => undefined);
  return result;
}

async function readBlobsState(store) {
  try {
    const entry = await store.getWithMetadata(STATE_KEY, {
      type: 'json',
      consistency: 'strong'
    });
    if (!entry) {
      return { state: createDefaultState(), etag: null };
    }
    const data = entry.data;
    return {
      state: data && typeof data === 'object' ? sanitizeLoadedState(data) : createDefaultState(),
      etag: entry.etag || null
    };
  } catch (err) {
    console.error('[Halloween/Blobs] Error al LEER estado compartido:', err);
    throw new Error('Almacenamiento compartido no disponible: verifica Netlify Blobs y Functions logs.');
  }
}

async function writeBlobsState(store, state, condition) {
  try {
    // undefined = unconditional write; null = create only; string = compare ETag.
    const options = condition === undefined
      ? undefined
      : condition === null
        ? { onlyIfNew: true }
        : { onlyIfMatch: condition };
    return await store.setJSON(STATE_KEY, state, options);
  } catch (err) {
    console.error('[Halloween/Blobs] Error al GUARDAR estado compartido:', err);
    throw new Error('No se pudo guardar en el almacenamiento compartido. Registro cancelado.');
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Atomic read-modify-write. On Netlify, writes use ETag preconditions and are
 * retried when another request wins the race. Locally, an in-process lock
 * serializes mutations so concurrent registrations are not lost.
 */
async function mutateState(mutator) {
  if (isNetlifyRuntime()) {
    const store = getBlobsStore();
    for (let attempt = 0; attempt < MAX_MUTATION_ATTEMPTS; attempt += 1) {
      const { state, etag } = await readBlobsState(store);
      const outcome = await mutator(state);
      if (!outcome || outcome.modified === false) {
        return { state, result: outcome ? outcome.result : undefined };
      }
      state.updatedAt = Date.now();
      const write = await writeBlobsState(store, state, etag);
      if (write.modified) {
        return { state, result: outcome.result, etag: write.etag || null };
      }
      await delay(15 + Math.floor(Math.random() * 35));
    }
    throw new Error('El ritual está recibiendo demasiadas solicitudes al mismo tiempo. Intenta de nuevo.');
  }

  return withLocalLock(async () => {
    const state = readLocalState();
    const outcome = await mutator(state);
    if (!outcome || outcome.modified === false) {
      return { state, result: outcome ? outcome.result : undefined };
    }
    state.updatedAt = Date.now();
    writeLocalState(state);
    return { state, result: outcome.result };
  });
}

async function loadRawState() {
  if (isNetlifyRuntime()) {
    const { state } = await readBlobsState(getBlobsStore());
    return state;
  }
  return readLocalState();
}

async function saveRawState(state) {
  state.updatedAt = Date.now();
  if (isNetlifyRuntime()) {
    await writeBlobsState(getBlobsStore(), state, undefined);
    return;
  }
  await withLocalLock(async () => {
    writeLocalState(state);
  });
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
  const isScreen = Boolean(options.isScreen);

  const { state } = await mutateState((draft) => {
    const now = Date.now();
    let stateModified = false;

    // If this request comes from the screen projection, update last ping
    if (isScreen) {
      draft.lastScreenPing = now;
      stateModified = true;
    }

    const durationMs = (draft.displaySeconds || DEFAULT_DISPLAY_SECONDS) * 1000;
    const screenActive = isScreenConnected(draft, now);

    if (!draft.paused) {
      if (screenActive) {
        // Screen is CONNECTED
        if (draft.active) {
          // If active was frozen while screen was disconnected, unfreeze and adjust startedAt
          if (typeof draft.active.frozenRemainingMs === 'number') {
            const remaining = Math.max(1000, draft.active.frozenRemainingMs);
            draft.active.startedAt = now - (draft.active.durationMs - remaining);
            delete draft.active.frozenRemainingMs;
            stateModified = true;
          }

          const startedAt = draft.active.startedAt || now;
          const elapsed = now - startedAt;
          const participantDuration = draft.active.durationMs || durationMs;

          if (elapsed >= participantDuration) {
            // Current participant finished their 15 seconds!
            const finishedParticipant = {
              ...draft.active,
              finishedAt: now
            };
            draft.history.unshift(finishedParticipant);
            if (draft.history.length > MAX_HISTORY_LENGTH) {
              draft.history.length = MAX_HISTORY_LENGTH;
            }

            // Advance to next if queue has waiting participants
            if (draft.queue.length > 0) {
              const next = draft.queue.shift();
              draft.active = {
                id: next.id,
                name: next.name,
                phrase: next.phrase || pickHorrorPhrase(finishedParticipant.phrase),
                startedAt: now, // 15 SECONDS REAL TIME START RIGHT NOW!
                durationMs: durationMs
              };
            } else {
              // Queue is empty -> return to QR mode!
              draft.active = null;
            }
            stateModified = true;
          }
        } else {
          // No active participant, but screen is connected: activate next from queue
          if (draft.queue.length > 0) {
            const next = draft.queue.shift();
            const lastPhrase = draft.history[0]?.phrase || null;
            draft.active = {
              id: next.id,
              name: next.name,
              phrase: next.phrase || pickHorrorPhrase(lastPhrase),
              startedAt: now, // 15 SECONDS REAL TIME START RIGHT NOW!
              durationMs: durationMs
            };
            stateModified = true;
          }
        }
      } else {
        // Screen is DISCONNECTED: do not advance. Freeze remaining time.
        if (draft.active && typeof draft.active.frozenRemainingMs !== 'number') {
          const elapsed = now - (draft.active.startedAt || now);
          const participantDuration = draft.active.durationMs || durationMs;
          draft.active.frozenRemainingMs = Math.max(1000, participantDuration - elapsed);
          stateModified = true;
        }
      }
    }

    return { modified: stateModified };
  });

  const now = Date.now();
  const durationMs = (state.displaySeconds || DEFAULT_DISPLAY_SECONDS) * 1000;
  const screenConnected = isScreenConnected(state, now);

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
    screenConnected
  };
}

/**
 * Add a new participant from /join
 * Always places in queue so participant never appears "EN PANTALLA" incorrectly
 */
async function addParticipant(rawName, ip = null) {
  if (!checkRateLimit(ip)) {
    return {
      ok: false,
      status: 429,
      error: "Has enviado demasiadas solicitudes. Por favor espera un momento."
    };
  }

  const { result } = await mutateState((draft) => {
    const now = Date.now();

    if (!draft.inscriptionsOpen) {
      return {
        modified: false,
        result: {
          ok: false,
          status: 403,
          error: "Las inscripciones para el ritual están cerradas temporalmente."
        }
      };
    }

    const name = typeof rawName === 'string' ? rawName.trim().replace(/\s+/g, ' ') : '';

    if (name.length < 2 || name.length > 32) {
      return {
        modified: false,
        result: {
          ok: false,
          status: 400,
          error: "El nombre debe tener entre 2 y 32 caracteres."
        }
      };
    }

    // Sanitize: disallow dangerous HTML or injection characters
    if (/[<>]/.test(name) || /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2060\uFEFF\u202A-\u202E]/.test(name)) {
      return {
        modified: false,
        result: {
          ok: false,
          status: 400,
          error: "El nombre contiene caracteres no permitidos."
        }
      };
    }

    if (draft.queue.length >= MAX_QUEUE_LENGTH) {
      return {
        modified: false,
        result: {
          ok: false,
          status: 429,
          error: "La cola del ritual está llena. Espera unos momentos antes de reintentar."
        }
      };
    }

    // Duplicate check: check active and waiting queue (case insensitive)
    const normalizedLower = name.toLowerCase();
    const isActiveMatch = draft.active && draft.active.name.toLowerCase() === normalizedLower;
    const isQueueMatch = draft.queue.some(p => p.name.toLowerCase() === normalizedLower);

    if (isActiveMatch || isQueueMatch) {
      return {
        modified: false,
        result: {
          ok: false,
          status: 409,
          error: "Este nombre ya está en la invocación o esperando en la cola."
        }
      };
    }

    const newId = draft.nextId++;
    const lastPhrase = draft.active?.phrase || draft.history[0]?.phrase || null;
    const phrase = pickHorrorPhrase(lastPhrase);

    const participant = {
      id: newId,
      name,
      phrase,
      registeredAt: now
    };

    // Always append to queue
    draft.queue.push(participant);

    const durationSec = draft.displaySeconds || DEFAULT_DISPLAY_SECONDS;
    const position = draft.queue.length; // Position in waiting queue

    let remainingActiveSec = 0;
    if (draft.active) {
      remainingActiveSec = Math.max(0, Math.ceil(((draft.active.startedAt + (draft.active.durationMs || durationSec * 1000)) - now) / 1000));
    }
    const estimatedWaitSeconds = remainingActiveSec + ((position - 1) * durationSec);

    return {
      modified: true,
      result: {
        ok: true,
        id: newId,
        name,
        position,
        isActive: false, // Never active immediately on submit
        status: 'waiting',
        screenConnected: isScreenConnected(draft, now),
        estimatedWaitSeconds: Math.max(0, estimatedWaitSeconds)
      }
    };
  });

  return result;
}

/**
 * Admin action: Pause projection
 */
async function pauseQueue() {
  const { result } = await mutateState((draft) => {
    if (draft.paused) {
      return { modified: false, result: { ok: true, paused: true } };
    }
    const now = Date.now();
    const durationMs = (draft.displaySeconds || DEFAULT_DISPLAY_SECONDS) * 1000;
    let remainingMs = 0;
    if (draft.active) {
      const elapsed = now - (draft.active.startedAt || now);
      remainingMs = Math.max(0, (draft.active.durationMs || durationMs) - elapsed);
    }
    draft.paused = true;
    draft.pausedRemainingMs = remainingMs;
    return { modified: true, result: { ok: true, paused: true, remainingMs } };
  });
  return result;
}

/**
 * Admin action: Resume projection
 */
async function resumeQueue() {
  const { result } = await mutateState((draft) => {
    if (!draft.paused) {
      return { modified: false, result: { ok: true, paused: false } };
    }
    draft.paused = false;
    const now = Date.now();
    const durationMs = (draft.displaySeconds || DEFAULT_DISPLAY_SECONDS) * 1000;

    if (draft.active) {
      const remaining = typeof draft.pausedRemainingMs === 'number' ? draft.pausedRemainingMs : durationMs;
      draft.active.startedAt = now - (durationMs - remaining);
      draft.active.durationMs = durationMs;
      delete draft.active.frozenRemainingMs;
    } else if (draft.queue.length > 0) {
      const next = draft.queue.shift();
      draft.active = {
        id: next.id,
        name: next.name,
        phrase: next.phrase || pickHorrorPhrase(),
        startedAt: now,
        durationMs: durationMs
      };
    }

    draft.pausedRemainingMs = 0;
    return { modified: true, result: { ok: true, paused: false } };
  });
  return result;
}

/**
 * Admin action: Skip to next participant
 */
async function nextParticipant() {
  const { result } = await mutateState((draft) => {
    const now = Date.now();
    const durationMs = (draft.displaySeconds || DEFAULT_DISPLAY_SECONDS) * 1000;

    if (draft.active) {
      draft.history.unshift({
        ...draft.active,
        finishedAt: now
      });
      if (draft.history.length > MAX_HISTORY_LENGTH) {
        draft.history.length = MAX_HISTORY_LENGTH;
      }
    }

    if (draft.queue.length > 0) {
      const next = draft.queue.shift();
      draft.active = {
        id: next.id,
        name: next.name,
        phrase: next.phrase || pickHorrorPhrase(),
        startedAt: now,
        durationMs: durationMs
      };
    } else {
      draft.active = null;
    }

    draft.pausedRemainingMs = 0;
    return { modified: true, result: { ok: true, active: draft.active } };
  });
  return result;
}

/**
 * Admin action: Clear waiting queue
 */
async function clearQueue() {
  const { result } = await mutateState((draft) => {
    draft.queue = [];
    draft.active = null;
    draft.paused = false;
    draft.pausedRemainingMs = 0;
    return { modified: true, result: { ok: true, message: "Cola vaciada exitosamente." } };
  });
  return result;
}

/**
 * Admin action: Toggle inscriptions
 */
async function toggleInscriptions(open = null) {
  const { result } = await mutateState((draft) => {
    draft.inscriptionsOpen = open !== null && open !== undefined ? Boolean(open) : !draft.inscriptionsOpen;
    return { modified: true, result: { ok: true, inscriptionsOpen: draft.inscriptionsOpen } };
  });
  return result;
}

/**
 * Get participant status for mobile tracking
 * Read-only status query: does not mutate or advance projection queue
 */
async function getParticipantStatus(participantId) {
  const state = await loadRawState();
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

/**
 * Read-only inscriptions status. It must never advance or mutate the queue.
 */
async function getInscriptionsStatus() {
  const state = await loadRawState();
  return {
    open: Boolean(state.inscriptionsOpen),
    paused: !state.inscriptionsOpen
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
  getInscriptionsStatus,
  isScreenConnected,
  loadRawState,
  saveRawState
};
