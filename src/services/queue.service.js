"use strict";

function createQueueService({
  displaySeconds,
  maxLength = 100,
  storage,
  selectPhrase,
  logger = console
} = {}) {
  if (!storage || typeof storage.getState !== "function" || typeof storage.replace !== "function") {
    throw new Error("El servicio de cola requiere un almacenamiento persistente.");
  }

  const effectiveDisplaySeconds =
    Number.isInteger(displaySeconds) && displaySeconds > 0 ? displaySeconds : 15;
  const queueMaxLength =
    Number.isInteger(maxLength) && maxLength > 0 ? maxLength : 100;
  const safeLogger = logger && typeof logger.error === "function" ? logger : console;

  let state = storage.getState();
  let timer = null;
  let handlers = {};
  let operationChain = Promise.resolve();
  let closed = false;

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

  function notifyStateChange() {
    if (typeof handlers.onFinish === "function") {
      try {
        handlers.onFinish();
      } catch (error) {
        safeLogger.error("[queue] No se pudo notificar el cambio de estado:", error.message);
      }
    }
  }

  function remainingFor(active) {
    if (!active) {
      return 0;
    }
    const endsAt =
      typeof active.endsAt === "number" ? active.endsAt : active.startedAt + active.durationMs;
    return Math.max(0, endsAt - Date.now());
  }

  function previousPhrase(draft) {
    const lastFinished = draft.finishedParticipants[draft.finishedParticipants.length - 1];
    return lastFinished && typeof lastFinished.phrase === "string" ? lastFinished.phrase : null;
  }

  function resolvePhrase(draft, next) {
    if (typeof handlers.onStart === "function") {
      try {
        const result = handlers.onStart(next);
        if (result && typeof result.phrase === "string") {
          return result.phrase;
        }
      } catch (error) {
        safeLogger.error("[queue] No se pudo seleccionar una frase:", error.message);
      }
    }
    if (typeof selectPhrase === "function") {
      try {
        const phrase = selectPhrase(previousPhrase(draft));
        return typeof phrase === "string" ? phrase : null;
      } catch (error) {
        safeLogger.error("[queue] No se pudo seleccionar una frase:", error.message);
      }
    }
    return null;
  }

  function startNextInDraft(draft, now) {
    if (draft.pauseState.paused || draft.activeParticipant) {
      return false;
    }
    const next = draft.pendingParticipants.shift();
    if (!next) {
      return false;
    }

    const phrase = resolvePhrase(draft, next);
    const durationMs = effectiveDisplaySeconds * 1000;
    draft.activeParticipant = {
      id: next.id,
      name: next.name,
      phrase,
      startedAt: now,
      durationMs,
      endsAt: now + durationMs,
      remainingMs: null
    };
    draft.timers.projectionStartedAt = now;
    draft.timers.projectionEndsAt = now + durationMs;
    draft.timers.lastTickAt = now;
    return true;
  }

  function finishActiveInDraft(draft, now) {
    const active = draft.activeParticipant;
    if (!active) {
      return false;
    }

    draft.activeParticipant = null;
    draft.timers.projectionStartedAt = null;
    draft.timers.projectionEndsAt = null;
    draft.timers.lastTickAt = now;
    draft.timers.lastFinishedAt = now;

    if (!draft.finishedParticipants.some((participant) => participant.id === active.id)) {
      draft.finishedParticipants.push({
        id: active.id,
        name: active.name,
        phrase: active.phrase,
        startedAt: active.startedAt,
        finishedAt: now,
        durationMs: active.durationMs
      });
    }
    return true;
  }

  function applyCurrentConfig(draft, now) {
    let changed = false;
    if (draft.eventConfig.displaySeconds !== effectiveDisplaySeconds) {
      draft.eventConfig.displaySeconds = effectiveDisplaySeconds;
      changed = true;
    }
    if (draft.eventConfig.queueMaxLength !== queueMaxLength) {
      draft.eventConfig.queueMaxLength = queueMaxLength;
      changed = true;
    }
    if (changed) {
      draft.eventConfig.updatedAt = new Date(now).toISOString();
    }
    return changed;
  }

  function recoverSynchronously() {
    const now = Date.now();
    const draft = clone(state);
    applyCurrentConfig(draft, now);

    if (!draft.pauseState.paused) {
      const active = draft.activeParticipant;
      if (active) {
        if (typeof active.endsAt !== "number") {
          active.endsAt = active.startedAt + active.durationMs;
        }
        if (active.endsAt <= now) {
          // El servidor se apagó durante o después de la proyección. Se
          // finaliza exactamente una vez y se continúa con la cola.
          finishActiveInDraft(draft, now);
          startNextInDraft(draft, now);
        } else {
          draft.timers.projectionStartedAt = active.startedAt;
          draft.timers.projectionEndsAt = active.endsAt;
        }
      } else if (draft.pendingParticipants.length > 0) {
        startNextInDraft(draft, now);
      }
    }

    const before = JSON.stringify(state);
    const after = JSON.stringify(draft);
    if (before !== after) {
      state = storage.replaceSync(draft);
    } else {
      state = draft;
    }
  }

  function scheduleTimer() {
    clearTimer();
    if (closed || state.pauseState.paused || !state.activeParticipant) {
      return;
    }

    const remaining = remainingFor(state.activeParticipant);
    timer = setTimeout(() => {
      timer = null;
      finishActive().catch((error) => {
        safeLogger.error("[queue] No se pudo finalizar la proyección:", error.message);
        if (closed) {
          return;
        }
        // Se reintenta sin confirmar ni alterar el estado en memoria. Si el
        // proceso se reinicia, la recuperación volverá a calcular el tiempo.
        timer = setTimeout(scheduleTimer, 2000);
        if (typeof timer.unref === "function") {
          timer.unref();
        }
      });
    }, remaining);
    if (typeof timer.unref === "function") {
      timer.unref();
    }
  }

  function clearTimer() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function getActive() {
    return state.activeParticipant;
  }

  function getQueueLength() {
    return state.pendingParticipants.length;
  }

  function getQueuePreview(limit) {
    const n = typeof limit === "number" ? limit : 5;
    return state.pendingParticipants.slice(0, n).map((item) => item.name);
  }

  function getRemainingMs() {
    if (!state.activeParticipant) {
      return 0;
    }
    if (state.pauseState.paused) {
      return typeof state.pauseState.remainingMs === "number"
        ? Math.max(0, state.pauseState.remainingMs)
        : remainingFor(state.activeParticipant);
    }
    return remainingFor(state.activeParticipant);
  }

  function getFinishedCount() {
    return state.finishedParticipants.length;
  }

  function getState() {
    return storage.getState();
  }

  function getLocalState() {
    return clone(state);
  }

  function enqueue(name) {
    return withLock(async () => {
      if (state.pendingParticipants.length >= queueMaxLength) {
        const error = new Error("La cola está llena por ahora. Inténtalo en un momento.");
        error.status = 429;
        throw error;
      }

      const now = Date.now();
      const draft = clone(state);
      const participant = {
        id: draft.nextId,
        name,
        phrase: null,
        submittedAt: now
      };
      draft.nextId += 1;
      draft.pendingParticipants.push(participant);
      applyCurrentConfig(draft, now);
      startNextInDraft(draft, now);

      state = await storage.replace(draft);
      scheduleTimer();
      return state.pendingParticipants.length;
    });
  }

  function ensureRunning() {
    return withLock(async () => {
      if (closed || state.pauseState.paused || state.activeParticipant) {
        return;
      }
      if (state.pendingParticipants.length === 0) {
        return;
      }

      const now = Date.now();
      const draft = clone(state);
      applyCurrentConfig(draft, now);
      if (!startNextInDraft(draft, now)) {
        return;
      }
      state = await storage.replace(draft);
      scheduleTimer();
      notifyStateChange();
    });
  }

  function finishActive() {
    return withLock(async () => {
      if (!state.activeParticipant) {
        return getLocalState();
      }

      const now = Date.now();
      const draft = clone(state);
      finishActiveInDraft(draft, now);
      if (!draft.pauseState.paused) {
        startNextInDraft(draft, now);
      }
      applyCurrentConfig(draft, now);

      state = await storage.replace(draft);
      scheduleTimer();
      notifyStateChange();
      return getLocalState();
    });
  }

  function startNext() {
    return ensureRunning();
  }

  function pause() {
    return withLock(async () => {
      if (state.pauseState.paused) {
        return getLocalState();
      }

      const now = Date.now();
      const draft = clone(state);
      const active = draft.activeParticipant;
      const remainingMs = active ? remainingFor(active) : null;

      if (active) {
        active.remainingMs = remainingMs;
        active.endsAt = null;
        draft.timers.projectionEndsAt = null;
        draft.timers.lastTickAt = now;
      }
      draft.pauseState = {
        paused: true,
        pausedAt: now,
        resumedAt: null,
        remainingMs
      };

      state = await storage.replace(draft);
      clearTimer();
      notifyStateChange();
      return getLocalState();
    });
  }

  function resume() {
    return withLock(async () => {
      if (!state.pauseState.paused) {
        return getLocalState();
      }

      const now = Date.now();
      const draft = clone(state);
      const previousPause = draft.pauseState;
      draft.pauseState = {
        paused: false,
        pausedAt: previousPause.pausedAt,
        resumedAt: now,
        remainingMs: null
      };

      if (draft.activeParticipant) {
        const remainingMs =
          typeof previousPause.remainingMs === "number"
            ? previousPause.remainingMs
            : remainingFor(draft.activeParticipant);

        if (remainingMs <= 0) {
          finishActiveInDraft(draft, now);
          startNextInDraft(draft, now);
        } else {
          draft.activeParticipant.startedAt = now;
          draft.activeParticipant.endsAt = now + remainingMs;
          draft.activeParticipant.remainingMs = null;
          draft.timers.projectionStartedAt = now;
          draft.timers.projectionEndsAt = now + remainingMs;
          draft.timers.lastTickAt = now;
        }
      } else {
        startNextInDraft(draft, now);
      }

      state = await storage.replace(draft);
      scheduleTimer();
      notifyStateChange();
      return getLocalState();
    });
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

  return {
    getActive,
    getQueueLength,
    getQueuePreview,
    getRemainingMs,
    getFinishedCount,
    getState,
    getLocalState,
    enqueue,
    ensureRunning,
    startNext,
    finishActive,
    pause,
    resume,
    clearTimer,
    setHandlers,
    flush,
    close
  };
}

module.exports = { createQueueService };
