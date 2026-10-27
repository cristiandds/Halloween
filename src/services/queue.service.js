function createQueueService({ displaySeconds, maxLength = 100 } = {}) {
  const queue = [];
  let active = null;
  let timer = null;
  let nextId = 1;
  const queueMaxLength = typeof maxLength === "number" && maxLength > 0 ? maxLength : 100;

  function getQueueLength() {
    return queue.length;
  }

  function getQueuePreview(limit) {
    const n = typeof limit === "number" ? limit : 5;
    return queue.slice(0, n).map(item => item.name);
  }

  function getActive() {
    return active;
  }

  function clearTimer() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function enqueue(name) {
    if (queue.length >= queueMaxLength) {
      const err = new Error("La cola está llena por ahora. Inténtalo en un momento.");
      err.status = 429;
      throw err;
    }
    queue.push({ id: nextId++, name });
    return queue.length;
  }

  function startNext({ onStart, onFinish } = {}) {
    clearTimer();

    if (queue.length === 0) {
      active = null;
      if (typeof onFinish === "function") {
        onFinish();
      }
      return;
    }

    const next = queue.shift();
    let phrase = null;

    if (typeof onStart === "function") {
      const result = onStart(next);
      if (result && result.phrase) {
        phrase = result.phrase;
      }
    }

    active = {
      id: next.id,
      name: next.name,
      phrase: phrase,
      startedAt: Date.now(),
      durationMs: displaySeconds * 1000
    };

    if (typeof onFinish === "function") {
      onFinish();
    }

    timer = setTimeout(() => {
      startNext({ onStart, onFinish });
    }, displaySeconds * 1000);
    if (typeof timer.unref === "function") {
      timer.unref();
    }
  }

  function ensureRunning({ onStart, onFinish }) {
    if (active) {
      return;
    }
    if (queue.length > 0) {
      startNext({ onStart, onFinish });
    }
  }

  return {
    getQueueLength,
    getQueuePreview,
    getActive,
    enqueue,
    startNext,
    ensureRunning,
    clearTimer
  };
}

module.exports = { createQueueService };
