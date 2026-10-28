"use strict";

const PARTICIPANT_STATES = Object.freeze({
  PENDING_APPROVAL: "pending_approval",
  WAITING: "waiting",
  ACTIVE: "active",
  COMPLETED: "completed",
  REJECTED: "rejected",
  SKIPPED: "skipped"
});

const TERMINAL_STATES = new Set([
  PARTICIPANT_STATES.COMPLETED,
  PARTICIPANT_STATES.REJECTED,
  PARTICIPANT_STATES.SKIPPED
]);

const DEFAULT_DISPLAY_SECONDS = 15;
const DEFAULT_QUEUE_MAX_LENGTH = 100;
const MAX_NAME_LENGTH = 100;

function createQueueService({
  displaySeconds,
  maxLength = DEFAULT_QUEUE_MAX_LENGTH,
  storage,
  selectPhrase,
  getPhrases,
  logger = console,
  now = Date.now
} = {}) {
  if (!storage || typeof storage.getState !== "function" || typeof storage.replace !== "function") {
    throw new Error("El servicio de cola requiere un almacenamiento persistente.");
  }

  const initialNumericDisplaySeconds = Number(displaySeconds);
  let constructorDisplaySeconds =
    Number.isFinite(initialNumericDisplaySeconds) && initialNumericDisplaySeconds > 0
      ? initialNumericDisplaySeconds
      : DEFAULT_DISPLAY_SECONDS;
  let effectiveDisplaySeconds = constructorDisplaySeconds;
  function getDisplaySeconds() {
    const n2 = Number(constructorDisplaySeconds);
    if (Number.isFinite(n2) && n2 > 0) {
      if (Number.isInteger(n2) && n2 >= 5 && n2 <= 60) {
        effectiveDisplaySeconds = n2;
        return n2;
      }
      if (n2 >= 0.1 && n2 <= 120) {
        effectiveDisplaySeconds = n2;
        return n2;
      }
    }
    try {
      const s = storage.getState ? storage.getState() : state;
      if (s && s.eventConfig && s.eventConfig.displaySeconds !== undefined && s.eventConfig.displaySeconds !== null) {
        const v = s.eventConfig.displaySeconds;
        const n = Number(v);
        if (Number.isFinite(n) && n > 0) {
          if (Number.isInteger(n) && n >= 5 && n <= 60) {
            effectiveDisplaySeconds = n;
            return n;
          }
          if (n >= 0.1 && n <= 120) {
            effectiveDisplaySeconds = n;
            return n;
          }
        }
      }
    } catch (e) {}
    return Number.isFinite(effectiveDisplaySeconds) && effectiveDisplaySeconds > 0 ? effectiveDisplaySeconds : 15;
  }
  function getDisplayMs() {
    return Math.round(getDisplaySeconds() * 1000);
  }
  const queueMaxLength =
    Number.isInteger(maxLength) && maxLength > 0 ? maxLength : DEFAULT_QUEUE_MAX_LENGTH;
  const safeLogger = logger && typeof logger.error === "function" ? logger : console;
  const clock = typeof now === "function" ? now : Date.now;

  let state = storage.getState();
  let timer = null;
  let timerActiveId = null;
  let timerEndsAt = null;
  let handlers = {};
  let operationChain = Promise.resolve();
  let closed = false;

  // ---------------------------------------------------------------------------
  // Infraestructura: serialización de operaciones y notificaciones.
  // ---------------------------------------------------------------------------

  function withLock(task) {
    const run = operationChain.then(task);
    operationChain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function notifyChange() {
    if (typeof handlers.onChange !== "function") {
      return;
    }
    try {
      handlers.onChange(getSnapshot());
    } catch (error) {
      safeLogger.error("[queue] No se pudo notificar el cambio de estado:", error.message);
    }
  }

  function createError(message, status) {
    const error = new Error(message);
    error.status = status;
    return error;
  }

  // ---------------------------------------------------------------------------
  // Utilidades de participantes.
  // ---------------------------------------------------------------------------

  function normalizeName(name) {
    if (typeof name !== "string") {
      return "";
    }
    return name.normalize("NFC").replace(/\s+/g, " ").trim();
  }

  function participantState(participant, fallback) {
    if (participant && typeof participant.state === "string" && TERMINAL_STATES.has(participant.state)) {
      return participant.state;
    }
    return fallback;
  }

  function copyParticipant(participant) {
    return {
      id: participant.id,
      externalId: participant.externalId || null,
      name: participant.name,
      phrase: typeof participant.phrase === "string" ? participant.phrase : null,
      state: participant.state,
      registeredAt: participant.registeredAt ?? participant.submittedAt ?? null
    };
  }

  function activeRecord(participant) {
    return participant ? { ...participant, state: PARTICIPANT_STATES.ACTIVE } : null;
  }

  function remainingFor(active) {
    if (!active) {
      return 0;
    }
    if (state.pauseState && state.pauseState.paused) {
      if (typeof state.pauseState.remainingMs === "number") {
        return Math.max(0, state.pauseState.remainingMs);
      }
      if (typeof active.remainingMs === "number") {
        return Math.max(0, active.remainingMs);
      }
    }
    if (typeof active.endsAt === "number") {
      return Math.max(0, active.endsAt - clock());
    }
    if (typeof active.remainingMs === "number") {
      return Math.max(0, active.remainingMs);
    }
    return 0;
  }

  function lastProjectedPhrase(draft) {
    const finished = Array.isArray(draft.finishedParticipants) ? draft.finishedParticipants : [];
    for (let index = finished.length - 1; index >= 0; index -= 1) {
      const record = finished[index];
      if (record && typeof record.phrase === "string" && record.startedAt !== null && record.startedAt !== undefined) {
        return record.phrase;
      }
    }
    return null;
  }

  function phrasePool() {
    try {
      const s = state || (storage.getState ? storage.getState() : null);
      if (s && s.eventConfig && Array.isArray(s.eventConfig.phrases)) {
        const values = s.eventConfig.phrases.filter((value) => typeof value === "string" && value.trim().length > 0);
        if (values.length > 0) {
          return values;
        }
      }
    } catch (e) {}
    if (typeof getPhrases === "function") {
      try {
        const values = getPhrases();
        if (Array.isArray(values)) {
          const filtered = values.filter((value) => typeof value === "string" && value.length > 0);
          if (filtered.length > 0) {
            return filtered;
          }
        }
      } catch (error) {
        safeLogger.error("[queue] No se pudo obtener el listado de frases:", error.message);
      }
    }
    return [];
  }

  function choosePhrase(draft) {
    const previous = lastProjectedPhrase(draft);

    if (typeof handlers.onPhrase === "function") {
      try {
        const candidate = handlers.onPhrase(previous);
        if (typeof candidate === "string") {
          if (candidate === previous) {
            const alternatives = phrasePool().filter((phrase) => phrase !== previous);
            if (alternatives.length > 0) {
              return alternatives[Math.floor(Math.random() * alternatives.length)];
            }
          }
          return candidate;
        }
      } catch (error) {
        safeLogger.error("[queue] No se pudo seleccionar una frase:", error.message);
      }
    }

    if (typeof selectPhrase === "function") {
      try {
        const candidate = selectPhrase(previous);
        if (typeof candidate === "string") {
          if (candidate === previous) {
            const alternatives = phrasePool().filter((phrase) => phrase !== previous);
            if (alternatives.length > 0) {
              return alternatives[Math.floor(Math.random() * alternatives.length)];
            }
          }
          return candidate;
        }
      } catch (error) {
        safeLogger.error("[queue] No se pudo seleccionar una frase:", error.message);
      }
    }

    const pool = phrasePool();
    if (pool.length > 0) {
      const alternatives = pool.filter((phrase) => phrase !== previous);
      const candidates = alternatives.length > 0 ? alternatives : pool;
      return candidates[Math.floor(Math.random() * candidates.length)];
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Mutaciones sobre un borrador del estado.
  // ---------------------------------------------------------------------------

  function startNextInDraft(draft, at) {
    if (!draft || draft.activeParticipant) {
      return false;
    }
    if (draft.pauseState && draft.pauseState.paused) {
      return false;
    }
    const waiting = Array.isArray(draft.pendingParticipants) ? draft.pendingParticipants : [];
    const next = waiting.shift();
    if (!next) {
      return false;
    }

    const durationMs = getDisplayMs();
    const phrase = choosePhrase(draft);
    const endsAt = at + durationMs;
    draft.activeParticipant = {
      id: next.id,
      name: next.name,
      phrase,
      state: PARTICIPANT_STATES.ACTIVE,
      registeredAt: next.registeredAt ?? next.submittedAt ?? at,
      startedAt: at,
      durationMs,
      endsAt,
      remainingMs: null
    };
    draft.timers = {
      ...(draft.timers || {}),
      projectionStartedAt: at,
      projectionEndsAt: endsAt,
      lastTickAt: at
    };
    return true;
  }

  function concludeActiveInDraft(draft, at, outcome) {
    const active = draft.activeParticipant;
    if (!active) {
      return null;
    }

    const durationMs =
      typeof active.durationMs === "number" && active.durationMs > 0 ? active.durationMs : getDisplayMs();

    const record = {
      id: active.id,
      name: active.name,
      phrase: typeof active.phrase === "string" ? active.phrase : null,
      state: outcome,
      registeredAt: active.registeredAt ?? active.submittedAt ?? active.startedAt ?? at,
      startedAt: active.startedAt ?? null,
      finishedAt: at,
      durationMs
    };

    draft.activeParticipant = null;
    draft.timers = {
      ...(draft.timers || {}),
      projectionStartedAt: null,
      projectionEndsAt: null,
      lastTickAt: at,
      lastFinishedAt: at
    };

    if (!Array.isArray(draft.finishedParticipants)) {
      draft.finishedParticipants = [];
    }
    if (!draft.finishedParticipants.some((participant) => participant && participant.id === active.id)) {
      draft.finishedParticipants.push(record);
    }
    return record;
  }

  function removeById(list, id) {
    if (!Array.isArray(list)) {
      return null;
    }
    const index = list.findIndex((participant) => participant && participant.id === id);
    if (index < 0) {
      return null;
    }
    return list.splice(index, 1)[0] || null;
  }

  function recordTerminal(draft, participant, outcome, at, { started = false } = {}) {
    if (!Array.isArray(draft.finishedParticipants)) {
      draft.finishedParticipants = [];
    }
    if (draft.finishedParticipants.some((item) => item && item.id === participant.id)) {
      return;
    }
    draft.finishedParticipants.push({
      id: participant.id,
      name: participant.name,
      phrase: typeof participant.phrase === "string" ? participant.phrase : null,
      state: outcome,
      registeredAt: participant.registeredAt ?? participant.submittedAt ?? at,
      startedAt: started ? participant.startedAt ?? at : null,
      finishedAt: at,
      durationMs: started && typeof participant.durationMs === "number" ? participant.durationMs : null
    });
  }

  function findWaiting(draft, id) {
    const waiting = Array.isArray(draft.pendingParticipants) ? draft.pendingParticipants : [];
    const index = waiting.findIndex((participant) => participant && participant.id === id);
    return index >= 0 ? { list: waiting, index, participant: waiting[index] } : null;
  }

  function findApproval(draft, id) {
    const approval = Array.isArray(draft.moderationPendingParticipants)
      ? draft.moderationPendingParticipants
      : [];
    const index = approval.findIndex((participant) => participant && participant.id === id);
    return index >= 0 ? { list: approval, index, participant: approval[index] } : null;
  }

  function startNextIfIdle(draft, at) {
    if (!draft.activeParticipant && !(draft.pauseState && draft.pauseState.paused)) {
      return startNextInDraft(draft, at);
    }
    return false;
  }

  async function persist(draft) {
    state = await storage.replace(draft);
    return state;
  }

  // ---------------------------------------------------------------------------
  // Temporizador único controlado por el servidor.
  // ---------------------------------------------------------------------------

  function clearTimer() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    timerActiveId = null;
    timerEndsAt = null;
  }

  function scheduleTimer(delayOverride) {
    clearTimer();
    if (closed || !state.activeParticipant) {
      return;
    }
    if (state.pauseState && state.pauseState.paused) {
      return;
    }

    const active = state.activeParticipant;
    const remaining = remainingFor(active);
    const delay = typeof delayOverride === "number" ? Math.max(0, delayOverride) : Math.max(0, remaining);

    timerActiveId = active.id;
    timerEndsAt = active.endsAt;
    timer = setTimeout(() => {
      timer = null;
      const expectedId = timerActiveId;
      const expectedEndsAt = timerEndsAt;
      timerActiveId = null;
      timerEndsAt = null;
      finishDue(expectedId, expectedEndsAt).catch((error) => {
        safeLogger.error("[queue] No se pudo finalizar la proyección:", error.message);
        if (closed) {
          return;
        }
        // El estado confirmado sigue intacto. Reintenta sin duplicar la
        // aparición; el temporizador principal sigue siendo único.
        scheduleTimer(2000);
      });
    }, delay);

    if (typeof timer.unref === "function") {
      timer.unref();
    }
  }

  function finishDue(expectedId, expectedEndsAt) {
    return withLock(async () => {
      if (closed) {
        return getLocalState();
      }
      const active = state.activeParticipant;
      if (!active || active.id !== expectedId) {
        return getLocalState();
      }
      if (state.pauseState && state.pauseState.paused) {
        return getLocalState();
      }

      const at = clock();
      const endsAt =
        typeof expectedEndsAt === "number"
          ? expectedEndsAt
          : typeof active.endsAt === "number"
            ? active.endsAt
            : at;

      if (at + 5 < endsAt) {
        // El temporizador se adelantó unos milisegundos: espera el resto.
        scheduleTimer(endsAt - at);
        return getLocalState();
      }

      const draft = clone(state);
      concludeActiveInDraft(draft, at, PARTICIPANT_STATES.COMPLETED);
      startNextIfIdle(draft, at);
      await persist(draft);
      scheduleTimer();
      notifyChange();
      return getLocalState();
    });
  }

  // ---------------------------------------------------------------------------
  // Recuperación después de un reinicio.
  // ---------------------------------------------------------------------------

  function recoverSynchronously() {
    const at = clock();
    const draft = clone(state);

    if (Array.isArray(draft.pendingParticipants)) {
      for (const participant of draft.pendingParticipants) {
        if (participant && participant.state !== PARTICIPANT_STATES.WAITING) {
          participant.state = PARTICIPANT_STATES.WAITING;
        }
      }
    }
    if (Array.isArray(draft.moderationPendingParticipants)) {
      for (const participant of draft.moderationPendingParticipants) {
        if (participant && participant.state !== PARTICIPANT_STATES.PENDING_APPROVAL) {
          participant.state = PARTICIPANT_STATES.PENDING_APPROVAL;
        }
      }
    }

    if (draft.pauseState && draft.pauseState.paused) {
      const active = draft.activeParticipant;
      if (active) {
        if (typeof draft.pauseState.remainingMs !== "number") {
          const fallback =
            typeof active.remainingMs === "number"
              ? active.remainingMs
              : typeof active.endsAt === "number"
                ? Math.max(0, active.endsAt - at)
                : getDisplayMs();
          draft.pauseState.remainingMs = fallback;
        }
        active.remainingMs = draft.pauseState.remainingMs;
        active.endsAt = null;
      }
    } else {
      const active = draft.activeParticipant;
      if (active) {
        if (typeof active.endsAt !== "number") {
          const projectedAt =
            typeof active.remainingMs === "number"
              ? at + active.remainingMs
              : (active.startedAt ?? at) + (active.durationMs ?? getDisplayMs());
          active.endsAt = projectedAt;
        }
        if (active.endsAt <= at) {
          concludeActiveInDraft(draft, at, PARTICIPANT_STATES.COMPLETED);
          startNextInDraft(draft, at);
        } else {
          draft.timers = {
            ...(draft.timers || {}),
            projectionStartedAt: active.startedAt,
            projectionEndsAt: active.endsAt,
            lastTickAt: at
          };
        }
      } else if (
        Array.isArray(draft.pendingParticipants) &&
        draft.pendingParticipants.length > 0
      ) {
        startNextInDraft(draft, at);
      }
    }

    const changed = JSON.stringify(state) !== JSON.stringify(draft);
    if (changed) {
      try {
        state = storage.replaceSync(draft);
      } catch (error) {
        safeLogger.error("[queue] No se pudo persistir la recuperación:", error.message);
        state = draft;
      }
    } else {
      state = draft;
    }
  }

  // ---------------------------------------------------------------------------
  // Operaciones públicas del motor.
  // ---------------------------------------------------------------------------

  function addParticipant(name, options = {}) {
    return withLock(async () => {
      const normalized = normalizeName(name);
      if (!normalized) {
        throw createError("Nombre inválido.", 400);
      }
      if (normalized.length > MAX_NAME_LENGTH) {
        throw createError("El nombre es demasiado largo.", 400);
      }

      const at = clock();
      const draft = clone(state);
      let requestedState =
        options.state === PARTICIPANT_STATES.PENDING_APPROVAL
          ? PARTICIPANT_STATES.PENDING_APPROVAL
          : PARTICIPANT_STATES.WAITING;
      try {
        const moderationEnabled = draft && draft.eventConfig && draft.eventConfig.moderationEnabled === true;
        if (moderationEnabled && options.forceNoModeration !== true) {
          requestedState = PARTICIPANT_STATES.PENDING_APPROVAL;
        } else if (options.forceModeration === true) {
          requestedState = PARTICIPANT_STATES.PENDING_APPROVAL;
        }
      } catch (e) {}

      if (options.externalId) {
        const allList = [
          ...(Array.isArray(draft.pendingParticipants) ? draft.pendingParticipants : []),
          ...(Array.isArray(draft.moderationPendingParticipants) ? draft.moderationPendingParticipants : []),
          ...(draft.activeParticipant ? [draft.activeParticipant] : [])
        ];
        const existsId = allList.find((p) => p && p.externalId === options.externalId);
        if (existsId) {
          throw createError("Ya te has inscrito anteriormente.", 409);
        }
      }

      const waiting = Array.isArray(draft.pendingParticipants) ? draft.pendingParticipants : [];
      const approval = Array.isArray(draft.moderationPendingParticipants)
        ? draft.moderationPendingParticipants
        : [];

      if (requestedState === PARTICIPANT_STATES.WAITING && waiting.length >= queueMaxLength) {
        throw createError("La cola está llena por ahora. Inténtalo en un momento.", 429);
      }
      if (
        requestedState === PARTICIPANT_STATES.PENDING_APPROVAL &&
        waiting.length + approval.length >= queueMaxLength
      ) {
        throw createError("La cola está llena por ahora. Inténtalo en un momento.", 429);
      }

      const participant = {
        id: draft.nextId,
        externalId: options.externalId || null,
        name: normalized,
        phrase: typeof options.phrase === "string" ? options.phrase : null,
        state: requestedState,
        registeredAt: at,
        submittedAt: at
      };
      draft.nextId += 1;

      if (requestedState === PARTICIPANT_STATES.PENDING_APPROVAL) {
        draft.moderationPendingParticipants = approval;
        approval.push(participant);
      } else {
        draft.pendingParticipants = waiting;
        waiting.push(participant);
        startNextIfIdle(draft, at);
      }

      await persist(draft);
      scheduleTimer();
      notifyChange();
      return getEstimate(participant.id);
    });
  }

  async function enqueue(name) {
    // Compatibilidad con la API anterior: devuelve la longitud de la cola.
    await addParticipant(name, { state: PARTICIPANT_STATES.WAITING });
    return getQueueLength();
  }

  async function ensureRunning() {
    return startNext();
  }

  function approveParticipant(id) {
    return withLock(async () => {
      const at = clock();
      const draft = clone(state);
      const found = findApproval(draft, id);
      if (found) {
        const waiting = Array.isArray(draft.pendingParticipants) ? draft.pendingParticipants : [];
        if (waiting.length >= queueMaxLength) {
          throw createError("La cola está llena por ahora. Inténtalo en un momento.", 429);
        }
        const [participant] = found.list.splice(found.index, 1);
        participant.state = PARTICIPANT_STATES.WAITING;
        draft.pendingParticipants = waiting;
        waiting.push(participant);
        startNextIfIdle(draft, at);
      }
      await persist(draft);
      scheduleTimer();
      notifyChange();
      return getLocalState();
    });
  }

  function rejectParticipant(id) {
    return withLock(async () => {
      const at = clock();
      const draft = clone(state);

      if (draft.activeParticipant && draft.activeParticipant.id === id) {
        concludeActiveInDraft(draft, at, PARTICIPANT_STATES.REJECTED);
        startNextIfIdle(draft, at);
      } else {
        const approval = findApproval(draft, id);
        const waiting = findWaiting(draft, id);
        const found = approval || waiting;
        if (found) {
          const [participant] = found.list.splice(found.index, 1);
          participant.state = PARTICIPANT_STATES.REJECTED;
          recordTerminal(draft, participant, PARTICIPANT_STATES.REJECTED, at);
        }
      }

      await persist(draft);
      scheduleTimer();
      notifyChange();
      return getLocalState();
    });
  }

  function skipParticipant(id) {
    return withLock(async () => {
      const at = clock();
      const draft = clone(state);
      let targetId = id;

      if (targetId === undefined || targetId === null) {
        if (draft.activeParticipant) {
          targetId = draft.activeParticipant.id;
        } else if (Array.isArray(draft.pendingParticipants) && draft.pendingParticipants.length > 0) {
          targetId = draft.pendingParticipants[0].id;
        }
      }

      if (draft.activeParticipant && draft.activeParticipant.id === targetId) {
        concludeActiveInDraft(draft, at, PARTICIPANT_STATES.SKIPPED);
        startNextIfIdle(draft, at);
      } else if (targetId !== undefined && targetId !== null) {
        const approval = findApproval(draft, targetId);
        const waiting = findWaiting(draft, targetId);
        const found = approval || waiting;
        if (found) {
          const [participant] = found.list.splice(found.index, 1);
          participant.state = PARTICIPANT_STATES.SKIPPED;
          recordTerminal(draft, participant, PARTICIPANT_STATES.SKIPPED, at);
        }
      }

      await persist(draft);
      scheduleTimer();
      notifyChange();
      return getLocalState();
    });
  }

  function finishParticipant(id) {
    return withLock(async () => {
      if (!state.activeParticipant) {
        return getLocalState();
      }
      if (
        id !== undefined &&
        id !== null &&
        state.activeParticipant.id !== id
      ) {
        return getLocalState();
      }

      const at = clock();
      const draft = clone(state);
      concludeActiveInDraft(draft, at, PARTICIPANT_STATES.COMPLETED);
      startNextIfIdle(draft, at);
      await persist(draft);
      scheduleTimer();
      notifyChange();
      return getLocalState();
    });
  }

  function startNext() {
    return withLock(async () => {
      if (closed) {
        return getLocalState();
      }
      if (state.activeParticipant) {
        return getLocalState();
      }
      if (state.pauseState && state.pauseState.paused) {
        return getLocalState();
      }
      if (!Array.isArray(state.pendingParticipants) || state.pendingParticipants.length === 0) {
        return getLocalState();
      }

      const at = clock();
      const draft = clone(state);
      if (!startNextInDraft(draft, at)) {
        return getLocalState();
      }
      await persist(draft);
      scheduleTimer();
      notifyChange();
      return getLocalState();
    });
  }

  function pause() {
    return withLock(async () => {
      if (state.pauseState && state.pauseState.paused) {
        return getLocalState();
      }

      const at = clock();
      const draft = clone(state);
      const active = draft.activeParticipant;
      const remainingMs = active ? remainingFor(active) : null;

      if (active) {
        active.remainingMs = remainingMs;
        active.endsAt = null;
        draft.timers = {
          ...(draft.timers || {}),
          projectionEndsAt: null,
          lastTickAt: at
        };
      }

      draft.pauseState = {
        paused: true,
        pausedAt: at,
        resumedAt: null,
        remainingMs
      };

      await persist(draft);
      clearTimer();
      notifyChange();
      return getLocalState();
    });
  }

  function resume() {
    return withLock(async () => {
      if (!(state.pauseState && state.pauseState.paused)) {
        return getLocalState();
      }

      const at = clock();
      const draft = clone(state);
      const previousPause = draft.pauseState || {};
      const active = draft.activeParticipant;

      draft.pauseState = {
        paused: false,
        pausedAt: previousPause.pausedAt ?? null,
        resumedAt: at,
        remainingMs: null
      };

      if (active) {
        const remainingMs =
          typeof previousPause.remainingMs === "number"
            ? previousPause.remainingMs
            : typeof active.remainingMs === "number"
              ? active.remainingMs
              : typeof active.endsAt === "number"
                ? Math.max(0, active.endsAt - at)
                : getDisplayMs();

        if (remainingMs <= 0) {
          concludeActiveInDraft(draft, at, PARTICIPANT_STATES.COMPLETED);
          startNextInDraft(draft, at);
        } else {
          active.endsAt = at + remainingMs;
          active.remainingMs = null;
          draft.timers = {
            ...(draft.timers || {}),
            projectionStartedAt: active.startedAt,
            projectionEndsAt: at + remainingMs,
            lastTickAt: at
          };
        }
      } else {
        startNextInDraft(draft, at);
      }

      await persist(draft);
      scheduleTimer();
      notifyChange();
      return getLocalState();
    });
  }

  // ---------------------------------------------------------------------------
  // Consultas.
  // ---------------------------------------------------------------------------

  function getActive() {
    return activeRecord(state.activeParticipant);
  }

  function getQueueLength() {
    return Array.isArray(state.pendingParticipants) ? state.pendingParticipants.length : 0;
  }

  function getPendingApprovalCount() {
    return Array.isArray(state.moderationPendingParticipants)
      ? state.moderationPendingParticipants.length
      : 0;
  }

  function getQueuePreview(limit) {
    const n = Number.isInteger(limit) && limit > 0 ? limit : 5;
    const waiting = Array.isArray(state.pendingParticipants) ? state.pendingParticipants : [];
    return waiting.slice(0, n).map((participant) => participant.name);
  }

  function getQueueItems(limit) {
    const n = Number.isInteger(limit) && limit > 0 ? limit : 20;
    const waiting = Array.isArray(state.pendingParticipants) ? state.pendingParticipants : [];
    return waiting.slice(0, n).map((participant) => ({
      id: participant.id,
      name: participant.name,
      state: participant.state,
      registeredAt: participant.registeredAt ?? participant.submittedAt ?? null
    }));
  }

  function getPendingApprovalPreview(limit) {
    const n = Number.isInteger(limit) && limit > 0 ? limit : 5;
    const approval = Array.isArray(state.moderationPendingParticipants)
      ? state.moderationPendingParticipants
      : [];
    return approval.slice(0, n).map((participant) => participant.name);
  }

  function getPendingApprovalItems(limit) {
    const n = Number.isInteger(limit) && limit > 0 ? limit : 20;
    const approval = Array.isArray(state.moderationPendingParticipants)
      ? state.moderationPendingParticipants
      : [];
    return approval.slice(0, n).map((participant) => ({
      id: participant.id,
      name: participant.name,
      state: participant.state,
      registeredAt: participant.registeredAt ?? participant.submittedAt ?? null
    }));
  }

  function getParticipants() {
    const waiting = Array.isArray(state.pendingParticipants) ? state.pendingParticipants : [];
    const approval = Array.isArray(state.moderationPendingParticipants)
      ? state.moderationPendingParticipants
      : [];
    const finished = Array.isArray(state.finishedParticipants) ? state.finishedParticipants : [];
    return [
      ...(state.activeParticipant ? [{ ...state.activeParticipant }] : []),
      ...waiting.map((participant) => ({ ...participant })),
      ...approval.map((participant) => ({ ...participant })),
      ...finished.map((participant) => ({ ...participant }))
    ];
  }

  function getParticipant(id) {
    if (id === undefined || id === null) {
      return null;
    }
    const pid = typeof id === "number" ? id : Number.parseInt(id, 10);
    if (Number.isInteger(pid)) {
      const byId = getParticipants().find((participant) => participant && participant.id === pid);
      if (byId) {
        return byId;
      }
    }
    if (typeof id === "string" && id.length > 0) {
      const byExternal = getParticipants().find((participant) => participant && participant.externalId === id);
      if (byExternal) {
        return byExternal;
      }
    }
    return null;
  }

  function getRemainingMs() {
    return remainingFor(state.activeParticipant);
  }

  function getFinishedCount() {
    return Array.isArray(state.finishedParticipants) ? state.finishedParticipants.length : 0;
  }

  function isPaused() {
    return Boolean(state.pauseState && state.pauseState.paused);
  }

  function getMode() {
    if (state.activeParticipant) {
      return isPaused() ? "paused" : "active";
    }
    return getQueueLength() > 0 ? "waiting" : "qr";
  }

  function getEstimate(participantId) {
    let resolvedId = participantId;
    if (typeof participantId === "string") {
      const found = getParticipant(participantId);
      if (found) {
        resolvedId = found.id;
      }
    } else if (participantId !== undefined && participantId !== null && typeof participantId !== "number") {
      const found = getParticipant(participantId);
      if (found) {
        resolvedId = found.id;
      }
    }

    const active = state.activeParticipant;
    if (active && active.id === resolvedId) {
      return {
        participantId: resolvedId,
        state: PARTICIPANT_STATES.ACTIVE,
        position: 1,
        estimatedWaitSeconds: 0,
        estimatedWaitMs: 0
      };
    }

    const waiting = Array.isArray(state.pendingParticipants) ? state.pendingParticipants : [];
    const index = waiting.findIndex((participant) => participant && participant.id === resolvedId);
    if (index < 0) {
      return {
        participantId: resolvedId,
        state: null,
        position: null,
        estimatedWaitSeconds: null,
        estimatedWaitMs: null
      };
    }

    const activeOffset = active ? 1 : 0;
    const position = activeOffset + index + 1;
    const activeRemaining = active ? remainingFor(active) : 0;
    const estimatedWaitMs = activeRemaining + index * getDisplayMs();
    return {
      participantId: resolvedId,
      state: PARTICIPANT_STATES.WAITING,
      position,
      estimatedWaitSeconds: Math.ceil(estimatedWaitMs / 1000),
      estimatedWaitMs
    };
  }

  function getPosition(participantId) {
    return getEstimate(participantId).position;
  }

  function getEstimatedWaitSeconds(participantId) {
    return getEstimate(participantId).estimatedWaitSeconds;
  }

  function getSnapshot() {
    return {
      mode: getMode(),
      paused: isPaused(),
      remainingMs: getRemainingMs(),
      active: getActive(),
      waiting: getQueueLength(),
      pendingApproval: getPendingApprovalCount(),
      displaySeconds: getDisplaySeconds(),
      serverTime: clock()
    };
  }

  function getInscriptionsStatus() {
    const s = state || storage.getState();
    return {
      open: s.inscriptionsOpen !== false,
      paused: s.inscriptionsPaused === true
    };
  }

  async function setInscriptionsOpen(open) {
    return withLock(async () => {
      const draft = clone(state);
      draft.inscriptionsOpen = open === true;
      await persist(draft);
      notifyChange();
      return getLocalState();
    });
  }

  async function toggleInscriptions(open) {
    return setInscriptionsOpen(open);
  }

  async function removeParticipant(id) {
    return withLock(async () => {
      const at = clock();
      const draft = clone(state);
      let removed = null;

      if (draft.activeParticipant && draft.activeParticipant.id === id) {
        removed = { ...draft.activeParticipant };
        concludeActiveInDraft(draft, at, PARTICIPANT_STATES.REJECTED);
        startNextIfIdle(draft, at);
      } else {
        const approval = findApproval(draft, id);
        const waiting = findWaiting(draft, id);
        const found = approval || waiting;
        if (found) {
          const [participant] = found.list.splice(found.index, 1);
          participant.state = PARTICIPANT_STATES.REJECTED;
          removed = { ...participant };
          recordTerminal(draft, participant, PARTICIPANT_STATES.REJECTED, at);
        }
      }

      await persist(draft);
      scheduleTimer();
      notifyChange();
      return getLocalState();
    });
  }

  async function reorderQueue(order) {
    return withLock(async () => {
      if (!Array.isArray(order)) {
        return getLocalState();
      }
      const draft = clone(state);
      const waiting = Array.isArray(draft.pendingParticipants) ? draft.pendingParticipants : [];
      const map = new Map(waiting.map((p) => [p.id, p]));
      const newQueue = [];
      for (const id of order) {
        const pid = typeof id === "number" ? id : Number.parseInt(id, 10);
        if (Number.isInteger(pid) && map.has(pid)) {
          newQueue.push(map.get(pid));
          map.delete(pid);
        }
      }
      for (const p of waiting) {
        if (map.has(p.id)) {
          newQueue.push(p);
        }
      }
      draft.pendingParticipants = newQueue;
      draft.waiting = newQueue.map((p) => ({ ...p }));
      await persist(draft);
      notifyChange();
      return getLocalState();
    });
  }

  function getState() {
    return storage.getState();
  }

  function getLocalState() {
    return clone(state);
  }

  function setHandlers(nextHandlers = {}) {
    handlers = { ...handlers, ...nextHandlers };
  }

  async function flush() {
    await operationChain;
    await storage.flush();
  }

  function close() {
    closed = true;
    clearTimer();
  }

  recoverSynchronously();
  scheduleTimer();

  async function getEventConfig() {
    try {
      const s = state || (storage.getState ? storage.getState() : null);
      if (s && s.eventConfig) {
        return {
          eventName: s.eventConfig.eventName || "Halloween QR",
          displaySeconds: getDisplaySeconds(),
          queueMaxLength: s.eventConfig.queueMaxLength,
          moderationEnabled: s.eventConfig.moderationEnabled === true,
          phrases: Array.isArray(s.eventConfig.phrases) ? s.eventConfig.phrases.slice() : [],
          updatedAt: s.eventConfig.updatedAt || null
        };
      }
    } catch (e) {}
    return {
      eventName: "Halloween QR",
      displaySeconds: getDisplaySeconds(),
      queueMaxLength,
      moderationEnabled: false,
      phrases: [],
      updatedAt: null
    };
  }

  async function updateEventConfig(updates = {}) {
    return withLock(async () => {
      const draft = clone(state);
      const nowTs = clock();
      if (!isPlainObject(draft.eventConfig)) {
        draft.eventConfig = {};
      }
      if (typeof updates.eventName === "string") {
        const name = updates.eventName.trim();
        if (name.length === 0) {
          throw createError("El nombre del evento es obligatorio.", 400);
        }
        if (name.length > 200) {
          throw createError("El nombre del evento es demasiado largo.", 400);
        }
        draft.eventConfig.eventName = name;
      }
      if (updates.displaySeconds !== undefined && updates.displaySeconds !== null) {
        const ds = Number(updates.displaySeconds);
        if (!Number.isInteger(ds) || ds < 5 || ds > 60) {
          throw createError("La duración debe estar entre 5 y 60 segundos.", 400);
        }
        draft.eventConfig.displaySeconds = ds;
      }
      if (updates.queueMaxLength !== undefined && updates.queueMaxLength !== null) {
        const ql = Number(updates.queueMaxLength);
        if (!Number.isInteger(ql) || ql < 1 || ql > 1000) {
          throw createError("La cantidad máxima en cola debe ser válida.", 400);
        }
        draft.eventConfig.queueMaxLength = ql;
      }
      if (updates.moderationEnabled !== undefined) {
        draft.eventConfig.moderationEnabled = updates.moderationEnabled === true;
      }
      if (Array.isArray(updates.phrases)) {
        const phrases = updates.phrases
          .filter((p) => typeof p === "string")
          .map((p) => p.trim())
          .filter((p) => p.length > 0);
        if (phrases.length === 0) {
          throw createError("Debe haber al menos una frase de terror.", 400);
        }
        if (phrases.some((p) => p.length > 300)) {
          throw createError("Las frases son demasiado largas.", 400);
        }
        draft.eventConfig.phrases = phrases;
      }
      draft.eventConfig.updatedAt = new Date(nowTs).toISOString();
      await persist(draft);
      state = storage.getState ? storage.getState() : draft;
      notifyChange();
      return getEventConfig();
    });
  }

  function isPlainObjectLocal(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  return {
    PARTICIPANT_STATES,
    addParticipant,
    approveParticipant,
    rejectParticipant,
    startNext,
    pause,
    resume,
    skipParticipant,
    finishParticipant,
    removeParticipant,
    deleteParticipant: removeParticipant,
    reorderQueue,
    moveParticipant: reorderQueue,
    setInscriptionsOpen,
    toggleInscriptions,
    getInscriptionsStatus,
    getEventConfig,
    updateEventConfig,
    enqueue,
    ensureRunning,
    getActive,
    getQueueLength,
    getPendingApprovalCount,
    getQueuePreview,
    getQueueItems,
    getPendingApprovalPreview,
    getPendingApprovalItems,
    getParticipants,
    getParticipant,
    getRemainingMs,
    getFinishedCount,
    isPaused,
    getMode,
    getEstimate,
    getPosition,
    getEstimatedWaitSeconds,
    getSnapshot,
    getState,
    getLocalState,
    clearTimer,
    setHandlers,
    flush,
    close,
    // Alias cortos para integraciones que usan la API anterior.
    add: addParticipant,
    approve: approveParticipant,
    reject: rejectParticipant,
    skip: skipParticipant,
    finish: finishParticipant,
    next: startNext
  };
}

module.exports = {
  createQueueService,
  PARTICIPANT_STATES
};
