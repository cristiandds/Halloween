"use strict";

const { test, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  createStorageService,
  StorageCorruptionError,
  StorageWriteError
} = require("../src/services/storage.service");
const { createQueueService } = require("../src/services/queue.service");

const silentLogger = { error() {} };
const tempDirs = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "halloween-storage-"));
  tempDirs.push(dir);
  return dir;
}

function makeStorage(dataDir, options = {}) {
  const storage = createStorageService({
    dataDir,
    logger: silentLogger,
    ...options
  });
  storage.initializeSync();
  return storage;
}

function makeQueue(storage, options = {}) {
  return createQueueService({
    storage,
    displaySeconds: 60,
    maxLength: 100,
    selectPhrase: () => "La oscuridad ya conoce tu nombre.",
    logger: silentLogger,
    ...options
  });
}

after(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Guarda el estado completo con esquema versionado y lo recupera", async () => {
  const dataDir = makeTempDir();
  const storage = makeStorage(dataDir, { maxBackups: 3 });

  assert.strictEqual(storage.getState().schemaVersion, 1);
  assert.strictEqual(storage.getState().nextId, 1);

  const submittedAt = Date.now();
  await storage.update((draft) => {
    draft.pendingParticipants.push({
      id: 1,
      name: "Ana",
      phrase: null,
      submittedAt
    });
    draft.nextId = 2;
    draft.pauseState.paused = true;
    draft.pauseState.pausedAt = submittedAt;
    draft.eventConfig.displaySeconds = 30;
  });

  const onDisk = JSON.parse(fs.readFileSync(storage.filePath, "utf8"));
  assert.strictEqual(onDisk.schemaVersion, 1);
  assert.strictEqual(onDisk.nextId, 2);
  assert.strictEqual(onDisk.pendingParticipants[0].name, "Ana");
  assert.strictEqual(onDisk.pauseState.paused, true);
  assert.strictEqual(onDisk.eventConfig.displaySeconds, 30);

  const reopened = makeStorage(dataDir, { maxBackups: 3 });
  const recovered = reopened.getState();
  assert.strictEqual(recovered.schemaVersion, 1);
  assert.strictEqual(recovered.nextId, 2);
  assert.strictEqual(recovered.pendingParticipants.length, 1);
  assert.strictEqual(recovered.pendingParticipants[0].name, "Ana");
  assert.strictEqual(recovered.pauseState.paused, true);

  for (let index = 0; index < 6; index += 1) {
    await reopened.update((draft) => {
      draft.timers.lastTickAt = Date.now() + index;
    });
  }
  assert.ok(reopened.listBackupsSync().length <= 3);
});

test("La cola pendiente sobrevive a un reinicio sin perder ni duplicar registros", async (t) => {
  const dataDir = makeTempDir();
  const storage = makeStorage(dataDir);
  const queue = makeQueue(storage);
  t.after(() => queue.close());

  await queue.enqueue("Ana");
  await queue.enqueue("Beto");
  await queue.enqueue("Carla");

  assert.strictEqual(queue.getActive().name, "Ana");
  assert.strictEqual(queue.getQueueLength(), 2);
  const originalIds = [
    queue.getActive().id,
    ...queue.getLocalState().pendingParticipants.map((participant) => participant.id)
  ];
  queue.close();

  const restartedStorage = makeStorage(dataDir);
  const restartedQueue = makeQueue(restartedStorage);
  t.after(() => restartedQueue.close());

  assert.strictEqual(restartedQueue.getActive().name, "Ana");
  assert.strictEqual(restartedQueue.getQueueLength(), 2);
  assert.deepStrictEqual(
    restartedQueue.getLocalState().pendingParticipants.map((participant) => participant.name),
    ["Beto", "Carla"]
  );
  assert.ok(restartedQueue.getRemainingMs() > 0);
  assert.ok(restartedQueue.getRemainingMs() <= 60000);

  const restartedIds = [
    restartedQueue.getActive().id,
    ...restartedQueue.getLocalState().pendingParticipants.map((participant) => participant.id)
  ];
  assert.deepStrictEqual(restartedIds, originalIds);
  assert.strictEqual(new Set(restartedIds).size, restartedIds.length);
});

test("Reinicio durante una proyección conserva el activo y no repite finalizados", async (t) => {
  const dataDir = makeTempDir();
  const storage = makeStorage(dataDir);
  const firstQueue = makeQueue(storage);
  t.after(() => firstQueue.close());

  await firstQueue.enqueue("Ana");
  await firstQueue.enqueue("Beto");
  await firstQueue.enqueue("Carla");
  const activeId = firstQueue.getActive().id;
  firstQueue.close();

  const projectionStorage = makeStorage(dataDir);
  const activeState = projectionStorage.getState().activeParticipant;
  assert.strictEqual(activeState.id, activeId);
  assert.ok(activeState.endsAt > Date.now());

  await projectionStorage.update((draft) => {
    draft.activeParticipant.endsAt = Date.now() - 500;
    draft.timers.projectionEndsAt = draft.activeParticipant.endsAt;
  });

  const secondQueue = makeQueue(projectionStorage);
  t.after(() => secondQueue.close());
  assert.strictEqual(secondQueue.getActive().name, "Beto");
  assert.strictEqual(secondQueue.getFinishedCount(), 1);
  assert.strictEqual(secondQueue.getLocalState().finishedParticipants[0].id, activeId);
  assert.deepStrictEqual(
    secondQueue.getLocalState().pendingParticipants.map((participant) => participant.name),
    ["Carla"]
  );
  secondQueue.close();

  const finalStorage = makeStorage(dataDir);
  const thirdQueue = makeQueue(finalStorage);
  t.after(() => thirdQueue.close());

  assert.strictEqual(thirdQueue.getActive().name, "Beto");
  assert.strictEqual(thirdQueue.getFinishedCount(), 1);
  assert.strictEqual(thirdQueue.getLocalState().finishedParticipants[0].id, activeId);

  const allIds = [
    thirdQueue.getActive().id,
    ...thirdQueue.getLocalState().pendingParticipants.map((participant) => participant.id),
    ...thirdQueue.getLocalState().finishedParticipants.map((participant) => participant.id)
  ];
  assert.strictEqual(new Set(allIds).size, allIds.length);
});

test("El estado de pausa se conserva y el tiempo restante no avanza", async (t) => {
  const dataDir = makeTempDir();
  const storage = makeStorage(dataDir);
  const queue = makeQueue(storage);
  t.after(() => queue.close());

  await queue.enqueue("Ana");
  await queue.pause();
  const pausedRemaining = queue.getRemainingMs();
  assert.ok(pausedRemaining > 0 && pausedRemaining <= 60000);
  assert.strictEqual(storage.getState().pauseState.paused, true);
  queue.close();

  const restartedStorage = makeStorage(dataDir);
  const restartedQueue = makeQueue(restartedStorage);
  t.after(() => restartedQueue.close());

  assert.strictEqual(restartedQueue.getState().pauseState.paused, true);
  assert.strictEqual(restartedQueue.getActive().name, "Ana");
  assert.ok(restartedQueue.getRemainingMs() > 0);
  assert.ok(restartedQueue.getRemainingMs() <= pausedRemaining);

  await restartedQueue.resume();
  assert.strictEqual(restartedQueue.getState().pauseState.paused, false);
  assert.ok(restartedQueue.getRemainingMs() > 0);
  assert.ok(restartedQueue.getRemainingMs() <= 60000);
});

test("Serializa escrituras concurrentes sin perder modificaciones", async (t) => {
  const dataDir = makeTempDir();
  const storage = makeStorage(dataDir);

  await Promise.all(
    Array.from({ length: 30 }, (_, index) =>
      storage.update((draft) => {
        draft.pendingParticipants.push({
          id: draft.nextId,
          name: `Persona ${index}`,
          phrase: null,
          submittedAt: Date.now()
        });
        draft.nextId += 1;
      })
    )
  );

  const saved = storage.getState();
  assert.strictEqual(saved.pendingParticipants.length, 30);
  assert.strictEqual(saved.nextId, 31);
  assert.strictEqual(
    new Set(saved.pendingParticipants.map((participant) => participant.id)).size,
    30
  );

  const concurrentStorage = makeStorage(makeTempDir());
  const queue = makeQueue(concurrentStorage);
  t.after(() => queue.close());

  await Promise.all(
    Array.from({ length: 20 }, (_, index) => queue.enqueue(`Concurrente ${index}`))
  );

  const queueState = queue.getLocalState();
  const ids = [
    queueState.activeParticipant.id,
    ...queueState.pendingParticipants.map((participant) => participant.id)
  ];
  assert.strictEqual(ids.length, 20);
  assert.strictEqual(new Set(ids).size, 20);
  assert.strictEqual(concurrentStorage.getState().pendingParticipants.length, 19);
});

test("Un error de disco rechaza la escritura y no altera el estado confirmado", async (t) => {
  const dataDir = makeTempDir();
  const storage = makeStorage(dataDir);
  const queue = makeQueue(storage);
  t.after(() => queue.close());

  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.writeFileSync(dataDir, "directorio bloqueado", "utf8");

  await assert.rejects(
    storage.update((draft) => {
      draft.pendingParticipants.push({
        id: draft.nextId,
        name: "No guardado",
        phrase: null,
        submittedAt: Date.now()
      });
    }),
    (error) => error instanceof StorageWriteError
  );

  assert.strictEqual(storage.getState().pendingParticipants.length, 0);
  await assert.rejects(queue.enqueue("Tampoco se confirma"));
  assert.strictEqual(queue.getActive(), null);
  assert.strictEqual(queue.getQueueLength(), 0);

  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("Un archivo corrupto no se sobrescribe y permite recuperar un respaldo", async () => {
  const dataDir = makeTempDir();
  const storage = makeStorage(dataDir);

  await storage.update((draft) => {
    draft.pendingParticipants.push({
      id: 1,
      name: "Primero",
      phrase: null,
      submittedAt: Date.now()
    });
    draft.nextId = 2;
  });
  await storage.update((draft) => {
    draft.pendingParticipants.push({
      id: 2,
      name: "Segundo",
      phrase: null,
      submittedAt: Date.now()
    });
    draft.nextId = 3;
  });

  const corruptContent = '{"schemaVersion": 1, "pendingParticipants": [';
  fs.writeFileSync(storage.filePath, corruptContent, "utf8");

  const corruptStorage = createStorageService({
    dataDir,
    logger: silentLogger
  });

  assert.throws(
    () => corruptStorage.initializeSync(),
    (error) => error instanceof StorageCorruptionError
  );
  assert.strictEqual(fs.readFileSync(storage.filePath, "utf8"), corruptContent);

  const recovery = corruptStorage.recoverFromBackupSync();
  assert.ok(recovery.source.includes(".backup-"));
  assert.ok(recovery.quarantine);
  assert.strictEqual(fs.readFileSync(recovery.quarantine, "utf8"), corruptContent);
  assert.strictEqual(recovery.state.pendingParticipants.length, 2);
  assert.deepStrictEqual(
    recovery.state.pendingParticipants.map((participant) => participant.name),
    ["Primero", "Segundo"]
  );

  const reopened = makeStorage(dataDir);
  assert.strictEqual(reopened.getState().pendingParticipants.length, 2);
  assert.strictEqual(reopened.getState().pendingParticipants[1].name, "Segundo");
});
