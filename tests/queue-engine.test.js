"use strict";

const { test, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createStorageService } = require("../src/services/storage.service");
const {
  createQueueService,
  PARTICIPANT_STATES
} = require("../src/services/queue.service");
const { selectPhrase, getPhrases } = require("../src/services/phrase.service");

const silentLogger = { error() {} };
const tempDirs = [];
const openQueues = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "halloween-engine-"));
  tempDirs.push(dir);
  return dir;
}

function makeStorage(dataDir) {
  const storage = createStorageService({ dataDir, logger: silentLogger });
  storage.initializeSync();
  return storage;
}

function makeQueue(dataDir, options = {}) {
  const storage = options.storage || makeStorage(dataDir || makeTempDir());
  const queue = createQueueService({
    storage,
    displaySeconds: 60,
    maxLength: 100,
    selectPhrase,
    getPhrases,
    logger: silentLogger,
    ...options
  });
  openQueues.push(queue);
  return { storage, queue };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, { timeoutMs = 3000, intervalMs = 20 } = {}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = predicate();
    if (value) {
      return value;
    }
    await wait(intervalMs);
  }
  throw new Error("Se agotó el tiempo esperando la condición.");
}

function allIds(queue) {
  const state = queue.getLocalState();
  const ids = [
    ...(state.activeParticipant ? [state.activeParticipant.id] : []),
    ...state.pendingParticipants.map((participant) => participant.id),
    ...state.moderationPendingParticipants.map((participant) => participant.id),
    ...state.finishedParticipants.map((participant) => participant.id)
  ];
  return ids;
}

function assertUniqueIds(queue) {
  const ids = allIds(queue);
  assert.strictEqual(new Set(ids).size, ids.length, "Los identificadores no deben repetirse.");
}

after(() => {
  for (const queue of openQueues) {
    try {
      queue.close();
    } catch (error) {
      // La cola ya estaba cerrada.
    }
  }
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Agregar participante asigna ID único, nombre normalizado, estado y fecha", async (t) => {
  const { queue } = makeQueue();
  t.after(() => queue.close());

  const first = await queue.addParticipant("  Ana   María  ");
  const active = queue.getActive();
  assert.strictEqual(active.id, first.participantId);
  assert.strictEqual(active.name, "Ana María");
  assert.strictEqual(active.state, PARTICIPANT_STATES.ACTIVE);
  assert.ok(Number.isFinite(active.registeredAt));

  const second = await queue.addParticipant("Beto");
  const third = await queue.addParticipant("Carla");
  assert.strictEqual(second.participantId, 2);
  assert.strictEqual(third.participantId, 3);

  const state = queue.getLocalState();
  assert.strictEqual(state.pendingParticipants[0].state, PARTICIPANT_STATES.WAITING);
  assert.strictEqual(state.pendingParticipants[1].state, PARTICIPANT_STATES.WAITING);
  assert.deepStrictEqual(allIds(queue), [1, 2, 3]);
  assertUniqueIds(queue);

  await assert.rejects(() => queue.addParticipant("   "), (error) => error.status === 400);
});

test("Aprobar mueve pending_approval a waiting/active y rechazar deja estado rejected", async (t) => {
  const { queue, storage } = makeQueue();
  t.after(() => queue.close());

  const pending = await queue.addParticipant("Elena", {
    state: PARTICIPANT_STATES.PENDING_APPROVAL
  });
  assert.strictEqual(queue.getPendingApprovalCount(), 1);
  assert.strictEqual(queue.getActive(), null);
  assert.strictEqual(queue.getMode(), "qr");
  assert.strictEqual(queue.getEstimate(pending.participantId).state, null);

  await queue.approveParticipant(pending.participantId);
  assert.strictEqual(queue.getPendingApprovalCount(), 0);
  assert.strictEqual(queue.getActive().id, pending.participantId);
  assert.strictEqual(queue.getActive().state, PARTICIPANT_STATES.ACTIVE);

  const rejected = await queue.addParticipant("Fran", {
    state: PARTICIPANT_STATES.PENDING_APPROVAL
  });
  await queue.rejectParticipant(rejected.participantId);
  assert.strictEqual(queue.getPendingApprovalCount(), 0);
  assert.strictEqual(queue.getActive().name, "Elena");
  assert.strictEqual(queue.getActive().state, PARTICIPANT_STATES.ACTIVE);

  const persisted = storage.getState();
  const rejectedRecord = persisted.finishedParticipants.find(
    (participant) => participant.id === rejected.participantId
  );
  assert.ok(rejectedRecord);
  assert.strictEqual(rejectedRecord.state, PARTICIPANT_STATES.REJECTED);
  assert.strictEqual(rejectedRecord.startedAt, null);
});

test("Iniciar siguiente mantiene una sola aparición activa y respeta el orden", async (t) => {
  const { queue } = makeQueue();
  t.after(() => queue.close());

  await queue.addParticipant("Ana");
  await queue.addParticipant("Beto");
  await queue.addParticipant("Carla");

  const activeBefore = queue.getActive();
  await queue.startNext();
  assert.strictEqual(queue.getActive().id, activeBefore.id, "No debe saltar al siguiente si hay uno activo.");
  assert.strictEqual(queue.getQueueLength(), 2);

  await queue.finishParticipant(activeBefore.id);
  assert.strictEqual(queue.getActive().name, "Beto");
  assert.strictEqual(queue.getQueueLength(), 1);

  await queue.finishParticipant();
  assert.strictEqual(queue.getActive().name, "Carla");

  await queue.skipParticipant();
  assert.strictEqual(queue.getActive(), null);
  assert.strictEqual(queue.getQueueLength(), 0);
  assert.strictEqual(queue.getMode(), "qr");

  const state = queue.getLocalState();
  assert.deepStrictEqual(
    state.finishedParticipants.map((participant) => [participant.name, participant.state]),
    [
      ["Ana", PARTICIPANT_STATES.COMPLETED],
      ["Beto", PARTICIPANT_STATES.COMPLETED],
      ["Carla", PARTICIPANT_STATES.SKIPPED]
    ]
  );
  assertUniqueIds(queue);
});

test("Fin de la cola vuelve al QR y no reaparecen participantes ya terminados", async (t) => {
  const { queue, storage } = makeQueue();
  t.after(() => queue.close());

  await queue.addParticipant("Primero");
  await queue.addParticipant("Segundo");
  await queue.addParticipant("Tercero");

  await queue.finishParticipant();
  await queue.finishParticipant();
  await queue.finishParticipant();

  assert.strictEqual(queue.getActive(), null);
  assert.strictEqual(queue.getQueueLength(), 0);
  assert.strictEqual(queue.getFinishedCount(), 3);
  assert.strictEqual(queue.getMode(), "qr");

  const persisted = storage.getState();
  assert.deepStrictEqual(persisted.pendingParticipants, []);
  assert.deepStrictEqual(persisted.waiting, []);
  assert.strictEqual(persisted.activeParticipant, null);

  // Una nueva lectura del disco no debe resucitar la cola.
  const reopened = makeStorage(storage.dataDir);
  assert.deepStrictEqual(reopened.getState().pendingParticipants, []);
  assert.strictEqual(reopened.getState().finishedParticipants.length, 3);
});

test("Pausar congela el tiempo, detiene el avance y reanudar conserva los segundos", async (t) => {
  const { queue, storage } = makeQueue(undefined, { displaySeconds: 1, getPhrases: () => ["a", "b"] });
  t.after(() => queue.close());

  await queue.addParticipant("Ana");
  await queue.addParticipant("Beto");
  const activeId = queue.getActive().id;

  await wait(120);
  await queue.pause();
  const frozen = queue.getRemainingMs();
  assert.ok(frozen > 0 && frozen <= 1000, `Restante inesperado: ${frozen}`);
  assert.strictEqual(queue.isPaused(), true);
  assert.strictEqual(storage.getState().pauseState.paused, true);
  assert.strictEqual(storage.getState().activeParticipant.endsAt, null);

  await wait(350);
  assert.strictEqual(queue.getActive().id, activeId, "El avance automático debe estar detenido.");
  assert.strictEqual(queue.getRemainingMs(), frozen, "El tiempo restante no debe avanzar en pausa.");

  await queue.resume();
  assert.strictEqual(queue.isPaused(), false);
  const resumed = queue.getRemainingMs();
  assert.ok(resumed > 0 && resumed <= frozen + 50, `Restante al reanudar: ${resumed}`);

  const nextActive = await waitFor(() => {
    const active = queue.getActive();
    return active && active.id !== activeId ? active : null;
  });
  assert.strictEqual(nextActive.name, "Beto");
  assert.strictEqual(queue.getFinishedCount(), 1);
  assert.strictEqual(queue.getLocalState().finishedParticipants[0].id, activeId);
});

test("Reinicio durante pausa recupera el activo con el tiempo restante congelado", async (t) => {
  const dataDir = makeTempDir();
  const firstStorage = makeStorage(dataDir);
  const first = makeQueue(dataDir, {
    storage: firstStorage,
    displaySeconds: 2,
    selectPhrase: () => "La oscuridad ya conoce tu nombre."
  });
  t.after(() => first.queue.close());

  await first.queue.addParticipant("Sobrevive");
  await first.queue.addParticipant("Siguiente");
  await wait(100);
  await first.queue.pause();
  const frozen = first.queue.getRemainingMs();
  const activeId = first.queue.getActive().id;
  first.queue.close();

  const restartedStorage = makeStorage(dataDir);
  const restarted = makeQueue(dataDir, { storage: restartedStorage, displaySeconds: 2 });
  t.after(() => restarted.queue.close());

  assert.strictEqual(restarted.queue.isPaused(), true);
  assert.strictEqual(restarted.queue.getActive().id, activeId);
  assert.strictEqual(restarted.queue.getActive().name, "Sobrevive");
  assert.strictEqual(restarted.queue.getRemainingMs(), frozen);
  assert.strictEqual(restartedStorage.getState().pauseState.remainingMs, frozen);
  assert.strictEqual(restarted.queue.getQueueLength(), 1);

  await restarted.queue.resume();
  assert.ok(restarted.queue.getRemainingMs() > 0);
  assert.strictEqual(restarted.queue.getActive().id, activeId);
});

test("Reinicio durante una aparición continúa desde el final guardado y no duplica el siguiente", async (t) => {
  const dataDir = makeTempDir();
  const first = makeQueue(dataDir, {
    displaySeconds: 2,
    selectPhrase: () => "La oscuridad ya conoce tu nombre."
  });
  t.after(() => first.queue.close());

  await first.queue.addParticipant("Ana");
  await first.queue.addParticipant("Beto");
  await first.queue.addParticipant("Carla");
  const activeId = first.queue.getActive().id;
  first.queue.close();

  const secondStorage = makeStorage(dataDir);
  const second = makeQueue(dataDir, { storage: secondStorage, displaySeconds: 2 });
  t.after(() => second.queue.close());

  assert.strictEqual(second.queue.getActive().id, activeId);
  assert.strictEqual(second.queue.getQueueLength(), 2);
  assert.strictEqual(second.queue.getFinishedCount(), 0);
  assertUniqueIds(second.queue);

  // Simula que la aparición terminó mientras el servidor estaba apagado.
  await secondStorage.update((draft) => {
    draft.activeParticipant.endsAt = Date.now() - 10;
  });
  second.queue.close();

  const restartedStorage = makeStorage(dataDir);
  const restarted = makeQueue(dataDir, { storage: restartedStorage, displaySeconds: 2 });
  t.after(() => restarted.queue.close());

  assert.strictEqual(restarted.queue.getActive().name, "Beto");
  assert.strictEqual(restarted.queue.getQueueLength(), 1);
  assert.strictEqual(restarted.queue.getFinishedCount(), 1);
  assert.strictEqual(
    restarted.queue.getLocalState().finishedParticipants[0].id,
    activeId
  );
  assertUniqueIds(restarted.queue);

  restarted.queue.close();
  const finalStorage = makeStorage(dataDir);
  const finalQueue = makeQueue(dataDir, { storage: finalStorage, displaySeconds: 2 });
  t.after(() => finalQueue.queue.close());
  assert.strictEqual(finalQueue.queue.getActive().name, "Beto");
  assert.strictEqual(finalQueue.queue.getFinishedCount(), 1);
  assertUniqueIds(finalQueue.queue);
});

test("La secuencia completa avanza una persona por vez sin saltos involuntarios", async (t) => {
  const { queue } = makeQueue(undefined, { displaySeconds: 0.4 });
  t.after(() => queue.close());

  await queue.addParticipant("Uno");
  await queue.addParticipant("Dos");
  await queue.addParticipant("Tres");

  assert.strictEqual(queue.getActive().name, "Uno");
  const seen = [];
  let current = queue.getActive();
  while (current) {
    seen.push(current.name);
    const transition = await waitFor(() => {
      const active = queue.getActive();
      if (!active) {
        return { done: true };
      }
      if (active.id !== current.id) {
        return { active };
      }
      return null;
    }, { timeoutMs: 2500 });
    current = transition.done ? null : transition.active;
  }

  assert.deepStrictEqual(seen, ["Uno", "Dos", "Tres"]);
  assert.strictEqual(queue.getMode(), "qr");
  assert.strictEqual(queue.getFinishedCount(), 3);
  assert.deepStrictEqual(
    queue.getLocalState().finishedParticipants.map((participant) => participant.state),
    ["completed", "completed", "completed"]
  );
  assertUniqueIds(queue);
});

test("No repite la misma frase en apariciones consecutivas cuando hay alternativas", async (t) => {
  const phrases = ["La oscuridad ya conoce tu nombre.", "No mires atrás.", "Tu destino despertó."];
  const { queue } = makeQueue(undefined, {
    displaySeconds: 60,
    getPhrases: () => phrases,
    selectPhrase: (previous) => previous || phrases[0]
  });
  t.after(() => queue.close());

  await queue.addParticipant("Ana");
  await queue.addParticipant("Beto");
  await queue.addParticipant("Carla");

  const firstPhrase = queue.getActive().phrase;
  await queue.finishParticipant();
  const secondPhrase = queue.getActive().phrase;
  await queue.finishParticipant();
  const thirdPhrase = queue.getActive().phrase;

  assert.ok(firstPhrase);
  assert.notStrictEqual(secondPhrase, firstPhrase);
  assert.notStrictEqual(thirdPhrase, secondPhrase);
});

test("Calcula posición estimada y tiempo de espera con el tiempo restante real", async (t) => {
  const { queue } = makeQueue(undefined, { displaySeconds: 10 });
  t.after(() => queue.close());

  const first = await queue.addParticipant("Ana");
  const second = await queue.addParticipant("Beto");
  const third = await queue.addParticipant("Carla");

  assert.deepStrictEqual(
    [first.position, first.estimatedWaitSeconds],
    [1, 0]
  );
  assert.strictEqual(second.position, 2);
  assert.strictEqual(third.position, 3);
  assert.ok(second.estimatedWaitSeconds >= 0 && second.estimatedWaitSeconds <= 10);
  assert.ok(third.estimatedWaitSeconds >= 10 && third.estimatedWaitSeconds <= 20);

  await queue.pause();
  const pausedWait = queue.getEstimate(third.participantId).estimatedWaitMs;
  await wait(120);
  assert.strictEqual(
    queue.getEstimate(third.participantId).estimatedWaitMs,
    pausedWait,
    "La espera estimada no debe avanzar mientras la cola está en pausa."
  );
});

test("Los comandos concurrentes no crean duplicados ni más de una aparición activa", async (t) => {
  const { queue } = makeQueue(undefined, { displaySeconds: 60 });
  t.after(() => queue.close());

  await queue.addParticipant("Ana");
  await queue.addParticipant("Beto");
  await queue.addParticipant("Carla");
  await queue.addParticipant("Dani");

  await Promise.allSettled([
    queue.finishParticipant(),
    queue.skipParticipant(),
    queue.startNext(),
    queue.pause(),
    queue.resume(),
    queue.approveParticipant(999),
    queue.rejectParticipant(999)
  ]);

  const state = queue.getLocalState();
  assert.ok(state.activeParticipant === null || state.activeParticipant.state === "active");
  assertUniqueIds(queue);
  assert.ok(state.pendingParticipants.length <= 4);
  assert.ok(state.finishedParticipants.length <= 4);
});

test("Saltar o rechazar desde la cola no altera la aparición activa", async (t) => {
  const { queue } = makeQueue(undefined, { displaySeconds: 60 });
  t.after(() => queue.close());

  const first = await queue.addParticipant("Ana");
  const second = await queue.addParticipant("Beto");
  const third = await queue.addParticipant("Carla");

  await queue.rejectParticipant(second.participantId);
  assert.strictEqual(queue.getActive().id, first.participantId);
  assert.strictEqual(queue.getQueueLength(), 1);

  await queue.skipParticipant(third.participantId);
  assert.strictEqual(queue.getActive().id, first.participantId);
  assert.strictEqual(queue.getQueueLength(), 0);

  const state = queue.getLocalState();
  const secondRecord = state.finishedParticipants.find(
    (participant) => participant.id === second.participantId
  );
  const thirdRecord = state.finishedParticipants.find(
    (participant) => participant.id === third.participantId
  );
  assert.strictEqual(secondRecord.state, PARTICIPANT_STATES.REJECTED);
  assert.strictEqual(thirdRecord.state, PARTICIPANT_STATES.SKIPPED);
  assert.strictEqual(secondRecord.startedAt, null);
  assert.strictEqual(thirdRecord.startedAt, null);
});

test("Pausar sin aparición activa bloquea el inicio y reanudar arranca la cola aprobada", async (t) => {
  const { queue } = makeQueue(undefined, { displaySeconds: 60 });
  t.after(() => queue.close());

  await queue.pause();
  assert.strictEqual(queue.isPaused(), true);
  assert.strictEqual(queue.getMode(), "qr");

  await queue.addParticipant("EnEspera");
  assert.strictEqual(queue.getActive(), null);
  assert.strictEqual(queue.getQueueLength(), 1);

  await queue.startNext();
  assert.strictEqual(queue.getActive(), null, "No debe iniciar mientras está pausado.");

  await queue.resume();
  assert.strictEqual(queue.getActive().name, "EnEspera");
  assert.strictEqual(queue.isPaused(), false);
});

test("Los eventos de cambio se emiten solo después de persistir el estado", async (t) => {
  const { queue, storage } = makeQueue(undefined, { displaySeconds: 60 });
  t.after(() => queue.close());

  const observed = [];
  queue.setHandlers({
    onChange: (snapshot) => {
      observed.push({
        snapshot,
        persistedActiveId: storage.getState().activeParticipant
          ? storage.getState().activeParticipant.id
          : null,
        persistedWaiting: storage.getState().pendingParticipants.length
      });
    }
  });

  await queue.addParticipant("Ana");
  await queue.addParticipant("Beto");
  await queue.finishParticipant();

  assert.strictEqual(observed.length, 3);
  assert.strictEqual(observed[0].persistedActiveId, observed[0].snapshot.active.id);
  assert.strictEqual(observed[1].persistedWaiting, 1);
  assert.strictEqual(observed[2].persistedActiveId, observed[2].snapshot.active.id);
  assert.strictEqual(storage.getState().finishedParticipants.length, 1);
});

test("Un fallo de persistencia no emite eventos ni altera el estado confirmado", async (t) => {
  const dataDir = makeTempDir();
  const { queue, storage } = makeQueue(dataDir, { displaySeconds: 60 });
  t.after(() => {
    queue.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  let changes = 0;
  queue.setHandlers({ onChange: () => { changes += 1; } });

  const activeBefore = queue.getActive();
  const waitingBefore = queue.getQueueLength();

  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.writeFileSync(dataDir, "sin espacio simulado", "utf8");

  await assert.rejects(() => queue.addParticipant("NoPersistido"));
  assert.strictEqual(changes, 0);
  assert.deepStrictEqual(queue.getActive(), activeBefore);
  assert.strictEqual(queue.getQueueLength(), waitingBefore);
  assert.strictEqual(storage.getState().pendingParticipants.length, waitingBefore);
});

test("El temporizador finaliza exactamente una vez y respeta el tiempo configurado", async (t) => {
  const { queue, storage } = makeQueue(undefined, { displaySeconds: 0.3 });
  t.after(() => queue.close());

  const startedAt = Date.now();
  await queue.addParticipant("Cronometrada");
  await queue.addParticipant("Siguiente");

  await waitFor(() => queue.getActive() && queue.getActive().name === "Siguiente", {
    timeoutMs: 2500
  });
  const elapsed = Date.now() - startedAt;
  assert.ok(elapsed >= 250, `Terminó demasiado pronto: ${elapsed}ms`);
  assert.strictEqual(queue.getFinishedCount(), 1);
  assert.strictEqual(storage.getState().finishedParticipants.length, 1);
  assertUniqueIds(queue);
});
