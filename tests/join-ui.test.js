const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function createClient(fetchStub) {
  const elements = new Map();
  const listeners = new Map();
  const storage = new Map();
  for (const id of [
    'invocation-form', 'participant-name', 'submit-btn', 'name-warning',
    'state-form', 'state-sending', 'state-tracking', 'state-error',
    'state-closed', 'tracking-title', 'tracking-message', 'track-status-badge',
    'track-position', 'track-wait', 'active-alert-box',
    'refresh-track-btn', 'register-another-btn', 'back-to-form-btn',
    'retry-open-btn', 'error-message'
  ]) {
    const events = new Map();
    const classes = new Set(id === 'state-form' ? ['active'] : []);
    elements.set(id, {
      id, value: '', textContent: '', disabled: false, className: '',
      addEventListener(type, listener) { events.set(type, listener); },
      dispatch(type, event = { preventDefault() {} }) {
        const callback = events.get(type);
        return callback && callback(event);
      },
      classList: {
        contains(name) { return classes.has(name); },
        add(name) { classes.add(name); },
        remove(name) { classes.delete(name); },
        toggle(name, force) {
          if (force === undefined ? !classes.has(name) : force) classes.add(name);
          else classes.delete(name);
        }
      },
      focus() {},
      reset() { elements.get('participant-name').value = ''; }
    });
  }
  const context = {
    document: { querySelector(selector) { return elements.get(selector.slice(1)); } },
    localStorage: {
      getItem(key) { return storage.get(key) ?? null; },
      setItem(key, value) { storage.set(key, value); },
      removeItem(key) { storage.delete(key); }
    },
    window: { addEventListener(type, cb) { listeners.set(type, cb); } },
    fetch: fetchStub,
    setInterval() { return 1; },
    clearInterval() {},
    console: { warn() {}, error() {} }
  };
  const source = fs.readFileSync(path.join(__dirname, '../public/js/join.js'), 'utf8');
  vm.runInNewContext(source, context);
  const el = (id) => elements.get(id);
  return {
    el, storage,
    async load() { await listeners.get('load')(); },
    async submit(name) {
      el('participant-name').value = name;
      await el('invocation-form').dispatch('submit');
      await new Promise(resolve => setImmediate(resolve));
    },
    async refresh() { await el('refresh-track-btn').dispatch('click'); }
  };
}

function json(data, status = 200) {
  return { ok: status >= 200 && status < 300, status, async json() { return data; } };
}

test('registrar otro nombre reabre el formulario sin eliminar el registro anterior', async () => {
  let count = 0;
  const client = createClient(async (url) => {
    if (url === '/api/inscriptions/status') return json({ open: true });
    if (url === '/api/submit') return json({ id: ++count, name: `Invitado ${count}`, position: 1, screenConnected: true });
    if (url.startsWith('/api/participant/status')) return json({ state: 'waiting', position: 1, screenConnected: true, estimatedWaitSeconds: 5 });
    throw new Error(`unexpected URL ${url}`);
  });
  await client.load();
  await client.submit('Sofia');
  assert.equal(count, 1);
  assert.equal(client.el('state-tracking').classList.contains('active'), true);
  client.el('register-another-btn').dispatch('click');
  assert.equal(client.el('state-form').classList.contains('active'), true);
  assert.equal(client.el('participant-name').value, '');
  await client.submit('Mateo');
  assert.equal(count, 2);
  assert.equal(client.el('state-tracking').classList.contains('active'), true);
});

test('no muestra EN PANTALLA sin conexión o con temporizador agotado', async () => {
  let status = { state: 'active', screenConnected: false, remainingSeconds: 12 };
  const client = createClient(async (url) => {
    if (url === '/api/inscriptions/status') return json({ open: true });
    if (url === '/api/submit') return json({ id: 10, name: 'Alicia', position: 1 });
    if (url.startsWith('/api/participant/status')) return json(status);
    throw new Error(`unexpected URL ${url}`);
  });
  await client.load();
  await client.submit('Alicia');
  assert.notEqual(client.el('tracking-title').textContent, '¡EN PANTALLA!');
  assert.equal(client.el('active-alert-box').classList.contains('hidden'), true);
  status = { state: 'active', screenConnected: true, remainingSeconds: 0 };
  await client.refresh();
  assert.notEqual(client.el('tracking-title').textContent, '¡EN PANTALLA!');
  status = { state: 'active', screenConnected: true, remainingSeconds: 9 };
  await client.refresh();
  assert.equal(client.el('tracking-title').textContent, '¡EN PANTALLA!');
});

test('al terminar, perderse el registro o fallar la API se puede registrar otro', async () => {
  let statusCode = 200;
  let currentState = 'waiting';
  const client = createClient(async (url) => {
    if (url === '/api/inscriptions/status') return json({ open: true });
    if (url === '/api/submit') return json({ id: 35, name: 'Pedro', position: 1, screenConnected: true });
    if (url.startsWith('/api/participant/status')) return json({ state: currentState, screenConnected: true, remainingSeconds: 7 }, statusCode);
    throw new Error(`unexpected URL ${url}`);
  });
  await client.load();
  await client.submit('Pedro');
  currentState = 'active';
  await client.refresh();
  assert.equal(client.el('tracking-title').textContent, '¡EN PANTALLA!');
  statusCode = 500;
  await client.refresh();
  assert.equal(client.el('tracking-title').textContent, 'SIN CONEXIÓN');
  statusCode = 200; currentState = 'completed';
  await client.refresh();
  assert.equal(client.el('tracking-title').textContent, 'RITUAL CONCLUIDO');
  assert.equal(client.storage.size, 0);
  client.el('register-another-btn').dispatch('click');
  assert.equal(client.el('state-form').classList.contains('active'), true);
  currentState = 'waiting';
  await client.submit('Nuevo');
  statusCode = 404;
  await client.refresh();
  assert.equal(client.el('tracking-title').textContent, 'REGISTRO NO DISPONIBLE');
  assert.equal(client.storage.size, 0);
});
