const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halloween-server-'));
process.env.HALLOWEEN_DATA_FILE = path.join(dataDir, 'state.json');

const server = require('../server');

let baseUrl = '';

before(async () => {
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('Integration: Serves index.html at /', async () => {
  const res = await fetch(`${baseUrl}/`);
  assert.strictEqual(res.status, 200);
  const text = await res.text();
  assert.ok(text.includes('HALLOWEEN RITUAL'));
});

test('Integration: Serves join.html at /join', async () => {
  const res = await fetch(`${baseUrl}/join`);
  assert.strictEqual(res.status, 200);
  const text = await res.text();
  assert.ok(text.includes('INVOCAR MI NOMBRE'));
});

test('Integration: Serves screen.html at /screen', async () => {
  const res = await fetch(`${baseUrl}/screen`);
  assert.strictEqual(res.status, 200);
  const text = await res.text();
  assert.ok(text.includes('ESCANEA Y DESPIERTA'));
});

test('Integration: Serves admin.html at /admin', async () => {
  const res = await fetch(`${baseUrl}/admin`);
  assert.strictEqual(res.status, 200);
  const text = await res.text();
  assert.ok(text.includes('ACCESO PRIVADO'));
});

test('Integration: /api/config returns joinUrl', async () => {
  const res = await fetch(`${baseUrl}/api/config`);
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.ok(data.joinUrl.includes('/join'));
});

test('Integration: /api/qr returns valid SVG QR', async () => {
  const res = await fetch(`${baseUrl}/api/qr`);
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.ok(data.svg.includes('<svg'));
});

test('Integration: /api/submit works through server.js', async () => {
  const res = await fetch(`${baseUrl}/api/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'IntegrationTestUser' })
  });
  assert.ok(res.status === 200 || res.status === 409);
});
