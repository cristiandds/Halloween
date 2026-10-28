const { test } = require('node:test');
const assert = require('node:assert');
const { handler: stateHandler } = require('../netlify/functions/state');
const { handler: submitHandler } = require('../netlify/functions/submit');
const { handler: configHandler } = require('../netlify/functions/config');
const { handler: qrHandler } = require('../netlify/functions/qr');
const { handler: adminHandler } = require('../netlify/functions/admin');
const { clearQueue } = require('../netlify/functions/lib/store');

test('Netlify Functions: Config endpoint returns joinUrl and displaySeconds', async () => {
  const event = {
    headers: { host: 'halloween-party.netlify.app' }
  };
  const res = await configHandler(event);
  assert.strictEqual(res.statusCode, 200);
  const data = JSON.parse(res.body);
  assert.strictEqual(data.joinUrl, 'https://halloween-party.netlify.app/join');
  assert.strictEqual(data.displaySeconds, 15);
});

test('Netlify Functions: QR endpoint generates valid SVG without CDN', async () => {
  const event = {
    headers: { host: 'terror.netlify.app' }
  };
  const res = await qrHandler(event);
  assert.strictEqual(res.statusCode, 200);
  const data = JSON.parse(res.body);
  assert.strictEqual(data.joinUrl, 'https://terror.netlify.app/join');
  assert.ok(data.svg.includes('<svg'), 'Debe contener etiqueta svg');
  assert.ok(data.svg.includes('</svg>'), 'Debe cerrar etiqueta svg');
});

test('Netlify Functions: Submit validates name rules', async () => {
  // Empty
  let res = await submitHandler({ httpMethod: 'POST', body: JSON.stringify({ name: '' }) });
  assert.strictEqual(res.statusCode, 400);

  // Too short
  res = await submitHandler({ httpMethod: 'POST', body: JSON.stringify({ name: 'A' }) });
  assert.strictEqual(res.statusCode, 400);

  // HTML tag
  res = await submitHandler({ httpMethod: 'POST', body: JSON.stringify({ name: '<script>alert(1)</script>' }) });
  assert.strictEqual(res.statusCode, 400);
});

test('Netlify Functions: Full cycle: clear, submit, state active, queue empty returns QR', async () => {
  await clearQueue();

  // 1. Initial state should be QR mode (active is null)
  let stateRes = await stateHandler();
  let state = JSON.parse(stateRes.body);
  assert.strictEqual(state.status, 'qr');
  assert.strictEqual(state.active, null);
  assert.strictEqual(state.waiting, 0);

  // 2. Submit Mariana -> immediately becomes active
  let subRes = await submitHandler({
    httpMethod: 'POST',
    headers: { 'client-ip': '192.168.1.10' },
    body: JSON.stringify({ name: 'Mariana' })
  });
  assert.strictEqual(subRes.statusCode, 200);
  const subData = JSON.parse(subRes.body);
  assert.strictEqual(subData.ok, true);
  assert.strictEqual(subData.name, 'Mariana');
  assert.strictEqual(subData.isActive, true);

  // Duplicate Mariana rejected
  let dupRes = await submitHandler({
    httpMethod: 'POST',
    headers: { 'client-ip': '192.168.1.10' },
    body: JSON.stringify({ name: 'mariana' })
  });
  assert.strictEqual(dupRes.statusCode, 409);

  // 3. Submit Carlos -> enters waiting queue
  let subRes2 = await submitHandler({
    httpMethod: 'POST',
    headers: { 'client-ip': '192.168.1.11' },
    body: JSON.stringify({ name: 'Carlos' })
  });
  assert.strictEqual(subRes2.statusCode, 200);
  const subData2 = JSON.parse(subRes2.body);
  assert.strictEqual(subData2.isActive, false);
  assert.strictEqual(subData2.position, 2);

  // 4. Check state -> Mariana active, Carlos waiting
  stateRes = await stateHandler();
  state = JSON.parse(stateRes.body);
  assert.strictEqual(state.status, 'active');
  assert.strictEqual(state.active.name, 'Mariana');
  assert.strictEqual(state.waiting, 1);
  assert.deepStrictEqual(state.queuePreview, ['Carlos']);
  assert.ok(state.active.phrase, 'Debe tener frase asignada');

  // 5. Admin Next -> Advances to Carlos
  const nextRes = await adminHandler({
    httpMethod: 'POST',
    path: '/api/admin/next',
    headers: { 'x-admin-password': 'halloween2026' }
  });
  assert.strictEqual(nextRes.statusCode, 200);

  stateRes = await stateHandler();
  state = JSON.parse(stateRes.body);
  assert.strictEqual(state.active.name, 'Carlos');
  assert.strictEqual(state.waiting, 0);

  // 6. Admin Clear -> returns immediately to QR
  const clearRes = await adminHandler({
    httpMethod: 'POST',
    path: '/api/admin/clear',
    headers: { 'x-admin-password': 'halloween2026' }
  });
  assert.strictEqual(clearRes.statusCode, 200);

  stateRes = await stateHandler();
  state = JSON.parse(stateRes.body);
  assert.strictEqual(state.status, 'qr');
  assert.strictEqual(state.active, null);
  assert.strictEqual(state.waiting, 0);
});
