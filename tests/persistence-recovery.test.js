"use strict";

const { test, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createApp } = require("../src/app");

const tempDirs = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "halloween-recovery-"));
  tempDirs.push(dir);
  return dir;
}

async function start(context) {
  await new Promise((resolve) => context.server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${context.server.address().port}`;
}

async function stop(context) {
  context.queueService.close();
  await new Promise((resolve) => context.io.close(resolve));
  if (context.server.listening) {
    await new Promise((resolve) => context.server.close(resolve));
  }
}

after(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Una confirmación HTTP se recupera realmente al reiniciar la aplicación", async () => {
  const dataDir = makeTempDir();
  const first = createApp({ dataDir, logger: { error() {} } });
  const firstUrl = await start(first);

  try {
    const response = await fetch(`${firstUrl}/api/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Sobrevive" })
    });
    assert.strictEqual(response.status, 200);
    assert.strictEqual((await response.json()).ok, true);
  } finally {
    await stop(first);
  }

  const onDisk = JSON.parse(fs.readFileSync(path.join(dataDir, "event-state.json"), "utf8"));
  assert.strictEqual(onDisk.activeParticipant.name, "Sobrevive");

  const second = createApp({ dataDir, logger: { error() {} } });
  const secondUrl = await start(second);

  try {
    assert.strictEqual(second.queueService.getActive().name, "Sobrevive");
    assert.strictEqual(second.queueService.getQueueLength(), 0);

    const publicState = await fetch(`${secondUrl}/api/state`);
    assert.strictEqual(publicState.status, 200);
    const body = await publicState.json();
    assert.strictEqual(body.active, true);
    assert.strictEqual(body.waiting, 0);
  } finally {
    await stop(second);
  }

  const recovered = JSON.parse(fs.readFileSync(path.join(dataDir, "event-state.json"), "utf8"));
  const ids = [
    recovered.activeParticipant ? recovered.activeParticipant.id : null,
    ...recovered.pendingParticipants.map((participant) => participant.id),
    ...recovered.finishedParticipants.map((participant) => participant.id)
  ].filter((id) => id !== null);
  assert.strictEqual(new Set(ids).size, ids.length);
});

test("Un fallo de disco no confirma el envío por HTTP", async () => {
  const dataDir = makeTempDir();
  const context = createApp({ dataDir, logger: { error() {} } });
  const baseUrl = await start(context);
  const submitUrl = `${baseUrl}/api/submit`;

  try {
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.writeFileSync(dataDir, "sin espacio simulado", "utf8");

    const response = await fetch(submitUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "NoConfirmado" })
    });

    assert.strictEqual(response.status, 503);
    const body = await response.json();
    assert.match(body.error, /No se pudo guardar/);
    assert.strictEqual(context.queueService.getActive(), null);
    assert.strictEqual(context.queueService.getQueueLength(), 0);
    assert.strictEqual(context.storage.getState().pendingParticipants.length, 0);
  } finally {
    await stop(context);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
