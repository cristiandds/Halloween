const { test } = require('node:test');
const assert = require('node:assert');
const { handler: stateHandler } = require('../netlify/functions/state');
const { handler: submitHandler } = require('../netlify/functions/submit');
const { handler: configHandler } = require('../netlify/functions/config');
const { handler: qrHandler } = require('../netlify/functions/qr');
const { handler: participantHandler } = require('../netlify/functions/participant');
const { handler: adminHandler } = require('../netlify/functions/admin');
const { clearQueue, loadRawState, saveRawState } = require('../netlify/functions/lib/store');

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

test('Netlify Functions: Submit validates name rules and prevents duplicates', async () => {
  // Empty
  let res = await submitHandler({ httpMethod: 'POST', body: JSON.stringify({ name: '' }) });
  assert.strictEqual(res.statusCode, 400);

  // Too short
  res = await submitHandler({ httpMethod: 'POST', body: JSON.stringify({ name: 'A' }) });
  assert.strictEqual(res.statusCode, 400);

  // HTML tag injection
  res = await submitHandler({ httpMethod: 'POST', body: JSON.stringify({ name: '<script>alert(1)</script>' }) });
  assert.strictEqual(res.statusCode, 400);
});

test('Netlify Functions: Full cycle with screen connection, queue FIFO, 15s timer and QR return', async () => {
  await clearQueue();

  // 1. Initial state without screen should be QR mode
  let stateRes = await stateHandler({ queryStringParameters: {} });
  let stateData = JSON.parse(stateRes.body);
  assert.strictEqual(stateData.status, 'qr');
  assert.strictEqual(stateData.active, null);
  assert.strictEqual(stateData.waiting, 0);

  // 2. Submit Mariana from phone when screen is not yet connected
  // Must NOT show "EN PANTALLA" (isActive must be false, status waiting)
  let subRes = await submitHandler({
    httpMethod: 'POST',
    headers: { 'client-ip': '192.168.1.10' },
    body: JSON.stringify({ name: 'Mariana' })
  });
  assert.strictEqual(subRes.statusCode, 200);
  const subData = JSON.parse(subRes.body);
  assert.strictEqual(subData.ok, true);
  assert.strictEqual(subData.name, 'Mariana');
  assert.strictEqual(subData.isActive, false, 'No debe aparecer en pantalla inmediatamente al enviar');
  assert.strictEqual(subData.position, 1);
  assert.strictEqual(subData.status, 'waiting');

  // Duplicate Mariana rejected
  let dupRes = await submitHandler({
    httpMethod: 'POST',
    headers: { 'client-ip': '192.168.1.10' },
    body: JSON.stringify({ name: 'mariana' })
  });
  assert.strictEqual(dupRes.statusCode, 409);

  // Phone queries Mariana status -> waiting in queue
  let partRes = await participantHandler({ queryStringParameters: { id: subData.id } });
  let partData = JSON.parse(partRes.body);
  assert.strictEqual(partData.state, 'waiting');
  assert.strictEqual(partData.position, 1);

  // 3. Screen connects: GET /api/state?role=screen
  // Screen activates Mariana and starts her 15 seconds!
  let screenRes = await stateHandler({ queryStringParameters: { role: 'screen' } });
  let screenState = JSON.parse(screenRes.body);
  assert.strictEqual(screenState.status, 'active');
  assert.strictEqual(screenState.active.name, 'Mariana');
  assert.strictEqual(screenState.timeRemaining, 15);
  assert.strictEqual(screenState.screenConnected, true);

  // Phone queries Mariana status -> now active on screen!
  partRes = await participantHandler({ queryStringParameters: { id: subData.id } });
  partData = JSON.parse(partRes.body);
  assert.strictEqual(partData.state, 'active');
  assert.strictEqual(partData.remainingSeconds, 15);

  // 4. Submit Carlos and Pedro while Mariana is projecting
  let subCarlos = await submitHandler({
    httpMethod: 'POST',
    headers: { 'client-ip': '192.168.1.11' },
    body: JSON.stringify({ name: 'Carlos' })
  });
  let subPedro = await submitHandler({
    httpMethod: 'POST',
    headers: { 'client-ip': '192.168.1.12' },
    body: JSON.stringify({ name: 'Pedro' })
  });
  const dataCarlos = JSON.parse(subCarlos.body);
  const dataPedro = JSON.parse(subPedro.body);
  assert.strictEqual(dataCarlos.isActive, false);
  assert.strictEqual(dataCarlos.position, 1); // 1st in waiting queue
  assert.strictEqual(dataPedro.isActive, false);
  assert.strictEqual(dataPedro.position, 2); // 2nd in waiting queue

  // 5. Simulate 15 seconds elapsed on screen for Mariana
  let currentRaw = await loadRawState();
  currentRaw.active.startedAt = Date.now() - 16000;
  await saveRawState(currentRaw);

  // Screen polls -> advances to Carlos!
  screenRes = await stateHandler({ queryStringParameters: { role: 'screen' } });
  screenState = JSON.parse(screenRes.body);
  assert.strictEqual(screenState.status, 'active');
  assert.strictEqual(screenState.active.name, 'Carlos');
  assert.strictEqual(screenState.waiting, 1); // Pedro waiting
  assert.deepStrictEqual(screenState.queuePreview, ['Pedro']);

  // Mariana is now completed, Carlos is active
  let partMariana = await participantHandler({ queryStringParameters: { id: subData.id } });
  assert.strictEqual(JSON.parse(partMariana.body).state, 'completed');
  let partCarlos = await participantHandler({ queryStringParameters: { id: dataCarlos.id } });
  assert.strictEqual(JSON.parse(partCarlos.body).state, 'active');

  // 6. Simulate 15 seconds elapsed for Carlos -> advances to Pedro!
  currentRaw = await loadRawState();
  currentRaw.active.startedAt = Date.now() - 16000;
  await saveRawState(currentRaw);

  screenRes = await stateHandler({ queryStringParameters: { role: 'screen' } });
  screenState = JSON.parse(screenRes.body);
  assert.strictEqual(screenState.status, 'active');
  assert.strictEqual(screenState.active.name, 'Pedro');
  assert.strictEqual(screenState.waiting, 0);

  // 7. Simulate 15 seconds elapsed for Pedro -> queue empty -> returns to QR!
  currentRaw = await loadRawState();
  currentRaw.active.startedAt = Date.now() - 16000;
  await saveRawState(currentRaw);

  screenRes = await stateHandler({ queryStringParameters: { role: 'screen' } });
  screenState = JSON.parse(screenRes.body);
  assert.strictEqual(screenState.status, 'qr');
  assert.strictEqual(screenState.active, null);
  assert.strictEqual(screenState.waiting, 0);

  // 8. Admin operations: pause, resume, clear
  // Add participant
  await submitHandler({
    httpMethod: 'POST',
    headers: { 'client-ip': '192.168.1.13' },
    body: JSON.stringify({ name: 'AdminTest' })
  });
  // Screen activates AdminTest
  await stateHandler({ queryStringParameters: { role: 'screen' } });

  // Admin pauses
  const pauseRes = await adminHandler({
    httpMethod: 'POST',
    path: '/api/admin/pause',
    headers: { 'x-admin-password': 'halloween2026' }
  });
  assert.strictEqual(pauseRes.statusCode, 200);

  stateRes = await stateHandler({ queryStringParameters: { role: 'screen' } });
  assert.strictEqual(JSON.parse(stateRes.body).paused, true);

  // Admin resumes
  const resumeRes = await adminHandler({
    httpMethod: 'POST',
    path: '/api/admin/resume',
    headers: { 'x-admin-password': 'halloween2026' }
  });
  assert.strictEqual(resumeRes.statusCode, 200);

  // Admin clear -> returns immediately to QR
  const clearRes = await adminHandler({
    httpMethod: 'POST',
    path: '/api/admin/clear',
    headers: { 'x-admin-password': 'halloween2026' }
  });
  assert.strictEqual(clearRes.statusCode, 200);

  stateRes = await stateHandler({ queryStringParameters: { role: 'screen' } });
  screenState = JSON.parse(stateRes.body);
  assert.strictEqual(screenState.status, 'qr');
  assert.strictEqual(screenState.active, null);
  assert.strictEqual(screenState.waiting, 0);
});
