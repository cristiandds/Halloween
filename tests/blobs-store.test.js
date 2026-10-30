"use strict";

const { test, after } = require('node:test');
const assert = require('node:assert');

// Simulate the context that modern Netlify Functions v2 inject into the
// process. The important part is uncachedEdgeURL, which classic Lambda
// compatibility never provided.
const context = {
  siteID: 'test-site',
  token: 'test-token',
  edgeURL: 'https://edge.blobs.test',
  uncachedEdgeURL: 'https://uncached.blobs.test'
};

process.env.NETLIFY = 'true';
process.env.NETLIFY_BLOBS_CONTEXT = Buffer.from(JSON.stringify(context)).toString('base64');

const originalFetch = globalThis.fetch;
const requests = [];
let blob = null;
let etagCounter = 0;

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  const method = String(init.method || 'GET').toUpperCase();
  const headers = new Headers(init.headers || {});
  const headerObject = {};
  headers.forEach((value, key) => {
    headerObject[key] = value;
  });
  requests.push({ url: url.toString(), method, headers: headerObject });

  // Strong consistency must always go through the uncached edge URL.
  assert.strictEqual(url.origin, context.uncachedEdgeURL);

  if (method === 'GET') {
    if (!blob) {
      return new Response(null, { status: 404 });
    }
    return new Response(JSON.stringify(blob.value), {
      status: 200,
      headers: {
        etag: blob.etag,
        'content-type': 'application/json'
      }
    });
  }

  if (method === 'PUT') {
    const ifMatch = headers.get('if-match');
    const ifNoneMatch = headers.get('if-none-match');

    if (ifNoneMatch === '*' && blob) {
      return new Response(null, { status: 412 });
    }
    if (ifMatch && (!blob || ifMatch !== blob.etag)) {
      return new Response(null, { status: 412 });
    }

    etagCounter += 1;
    blob = {
      value: JSON.parse(init.body),
      etag: `etag-${etagCounter}`
    };
    return new Response(null, {
      status: 200,
      headers: { etag: blob.etag }
    });
  }

  return new Response(null, { status: 405 });
};

const {
  addParticipant,
  getAndAdvanceState,
  loadRawState,
  saveRawState
} = require('../netlify/functions/lib/store');

function reset() {
  blob = null;
  etagCounter = 0;
  requests.length = 0;
}

after(() => {
  globalThis.fetch = originalFetch;
  delete process.env.NETLIFY;
  delete process.env.NETLIFY_BLOBS_CONTEXT;
});

test('Blobs: strong consistency uses uncachedEdgeURL and ETag retries keep concurrent registrations', async () => {
  reset();
  const total = 15;

  const results = await Promise.all(
    Array.from({ length: total }, (_, index) => addParticipant(`Blobs ${index}`, `10.9.9.${index + 1}`))
  );

  assert.ok(results.every((result) => result.ok), 'Todos los registros deben confirmarse');
  const state = await loadRawState();
  assert.strictEqual(state.queue.length, total);
  assert.strictEqual(new Set(state.queue.map((participant) => participant.name)).size, total);

  assert.ok(requests.length > 0);
  assert.ok(requests.every((request) => request.url.startsWith(context.uncachedEdgeURL)));
  assert.ok(requests.some((request) => request.method === 'PUT' && request.headers['if-none-match'] === '*'));
  assert.ok(requests.some((request) => request.method === 'PUT' && request.headers['if-match']));
});

test('Blobs: screen projection advances in order and returns to QR', async () => {
  reset();
  await addParticipant('Primero', '10.9.8.1');
  await addParticipant('Segundo', '10.9.8.2');

  const first = await getAndAdvanceState({ isScreen: true });
  assert.strictEqual(first.state.active.name, 'Primero');
  assert.strictEqual(Math.ceil(first.remainingMs / 1000), 15);

  let current = await loadRawState();
  current.active.startedAt = Date.now() - 16000;
  await saveRawState(current);

  const second = await getAndAdvanceState({ isScreen: true });
  assert.strictEqual(second.state.active.name, 'Segundo');
  assert.strictEqual(second.state.history[0].name, 'Primero');

  current = await loadRawState();
  current.active.startedAt = Date.now() - 16000;
  await saveRawState(current);

  const finished = await getAndAdvanceState({ isScreen: true });
  assert.strictEqual(finished.state.active, null);
  assert.strictEqual(finished.state.history[0].name, 'Segundo');
});
