process.env.NODE_ENV = "test";
process.env.ADMIN_PASSWORD = "test-admin-password-123456789";
process.env.SESSION_SECRET = "test-session-secret-0123456789abcdefghij";
process.env.PUBLIC_BASE_URL = "http://127.0.0.1";
process.env.TRUST_PROXY = "0";
process.env.COOKIE_SECURE = "0";

const { test } = require("node:test");
const assert = require("node:assert");
const path = require("path");
const { spawnSync } = require("child_process");
const { io: createClient } = require("socket.io-client");

const { createApp } = require("../src/app");
const config = require("../src/config");

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const PRIVATE_NAME = "VictimaSecreta";

async function startApp() {
  const context = createApp();
  await new Promise((resolve) => context.server.listen(0, "127.0.0.1", resolve));
  const address = context.server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  context.baseUrl = baseUrl;
  context.stop = async () => {
    context.queueService.clearTimer();
    context.sessions.stopCleanup();
    await new Promise((resolve) => context.io.close(resolve));
    if (context.server.listening) {
      await new Promise((resolve) => context.server.close(resolve));
    }
  };

  return context;
}

function readSetCookies(response) {
  if (typeof response.headers.getSetCookie === "function") {
    return response.headers.getSetCookie();
  }
  const value = response.headers.get("set-cookie");
  return value ? [value] : [];
}

function findSessionCookie(response) {
  const setCookie = readSetCookies(response)
    .find((value) => value.startsWith(`${config.SESSION_COOKIE_NAME}=`));
  assert.ok(setCookie, "La respuesta debe incluir la cookie de sesión.");
  return {
    setCookie,
    pair: setCookie.split(";")[0]
  };
}

async function requestLogin(context, { password, origin = context.baseUrl, headers = {} } = {}) {
  const body = password === undefined ? {} : { password };
  return fetch(`${context.baseUrl}/api/auth/login`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
      ...(origin ? { "Origin": origin } : {}),
      ...headers
    },
    body: JSON.stringify(body)
  });
}

async function loginOk(context) {
  const response = await requestLogin(context, { password: ADMIN_PASSWORD });
  assert.strictEqual(response.status, 200);
  const body = await response.json();
  const sessionCookie = findSessionCookie(response);
  return {
    cookie: sessionCookie.pair,
    setCookie: sessionCookie.setCookie,
    csrfToken: body.csrfToken
  };
}

async function submitName(context, name = PRIVATE_NAME) {
  return fetch(`${context.baseUrl}/api/submit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Origin": context.baseUrl
    },
    body: JSON.stringify({ name })
  });
}

function connectSocket(context, cookie) {
  return createClient(context.baseUrl, {
    transports: ["websocket"],
    reconnection: false,
    timeout: 4000,
    forceNew: true,
    ...(cookie ? { extraHeaders: { Cookie: cookie } } : {})
  });
}

function waitForSocketError(client) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Socket timeout esperando connect_error.")), 5000);
    client.on("connect_error", (error) => {
      clearTimeout(timer);
      resolve(error);
    });
    client.on("connect", () => {
      clearTimeout(timer);
      reject(new Error("El socket no autorizado llegó a conectarse."));
    });
  });
}

function waitForPrivateState(client) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Socket timeout esperando state.")), 5000);
    client.on("state", (snapshot) => {
      clearTimeout(timer);
      resolve(snapshot);
    });
    client.on("connect_error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

test("Invitado no accede a /screen ni puede evadir con /screen.html o ?token=", async (t) => {
  const context = await startApp();
  t.after(() => context.stop());

  const screen = await fetch(`${context.baseUrl}/screen`, { redirect: "manual" });
  assert.strictEqual(screen.status, 302);
  assert.match(screen.headers.get("location"), /^\/login\?next=/);

  const screenHtml = await fetch(`${context.baseUrl}/screen.html`, { redirect: "manual" });
  assert.strictEqual(screenHtml.status, 404);
  assert.ok(!(await screenHtml.text()).includes("Proyección de terror"));

  const tokenBypass = await fetch(`${context.baseUrl}/screen?token=supuesto-token`, { redirect: "manual" });
  assert.strictEqual(tokenBypass.status, 302);
  assert.match(tokenBypass.headers.get("location"), /^\/login\?next=/);
});

test("Invitado no obtiene nombres desde la API pública", async (t) => {
  const context = await startApp();
  t.after(() => context.stop());

  const submit = await submitName(context);
  assert.strictEqual(submit.status, 200);

  const publicState = await fetch(`${context.baseUrl}/api/state`, {
    headers: { "Accept": "application/json" }
  });
  assert.strictEqual(publicState.status, 200);
  const publicBody = await publicState.text();
  assert.ok(!publicBody.includes(PRIVATE_NAME));
  assert.ok(!publicBody.includes("queuePreview"));
  assert.ok(!publicBody.includes("phrase"));

  const parsed = JSON.parse(publicBody);
  assert.strictEqual(typeof parsed.active, "boolean");
  assert.strictEqual(typeof parsed.waiting, "number");

  const privateState = await fetch(`${context.baseUrl}/api/admin/state`, {
    headers: { "Accept": "application/json" }
  });
  assert.strictEqual(privateState.status, 401);
  const privateBody = await privateState.text();
  assert.ok(!privateBody.includes(PRIVATE_NAME));
});

test("Socket.IO rechaza conexiones sin sesión y no filtra nombres", async (t) => {
  const context = await startApp();
  t.after(() => context.stop());

  const submit = await submitName(context);
  assert.strictEqual(submit.status, 200);

  const client = connectSocket(context);
  t.after(() => client.close());

  const error = await waitForSocketError(client);
  assert.strictEqual(error.message, "unauthorized");
});

test("Administrador autenticado accede a pantalla, panel y API privada; el socket recibe el estado privado", async (t) => {
  const context = await startApp();
  t.after(() => context.stop());

  const submit = await submitName(context);
  assert.strictEqual(submit.status, 200);

  const { cookie, csrfToken, setCookie } = await loginOk(context);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Strict/i);
  assert.match(setCookie, /Path=\//i);
  assert.ok(!/;\s*Secure/i.test(setCookie));

  const screen = await fetch(`${context.baseUrl}/screen`, {
    redirect: "manual",
    headers: { "Cookie": cookie, "Accept": "text/html" }
  });
  assert.strictEqual(screen.status, 200);
  assert.ok((await screen.text()).includes("Proyección de terror"));

  const admin = await fetch(`${context.baseUrl}/admin`, {
    redirect: "manual",
    headers: { "Cookie": cookie, "Accept": "text/html" }
  });
  assert.strictEqual(admin.status, 200);
  assert.ok((await admin.text()).includes("Panel privado"));

  const session = await fetch(`${context.baseUrl}/api/auth/session`, {
    headers: { "Cookie": cookie, "Accept": "application/json" }
  });
  assert.strictEqual(session.status, 200);
  assert.strictEqual((await session.json()).csrfToken, csrfToken);

  const privateState = await fetch(`${context.baseUrl}/api/admin/state`, {
    headers: { "Cookie": cookie, "Accept": "application/json" }
  });
  assert.strictEqual(privateState.status, 200);
  const privateBody = await privateState.text();
  assert.ok(privateBody.includes(PRIVATE_NAME));

  const client = connectSocket(context, cookie);
  t.after(() => client.close());
  const snapshot = await waitForPrivateState(client);
  assert.strictEqual(snapshot.active.name, PRIVATE_NAME);
  assert.strictEqual(typeof snapshot.active.phrase, "string");
});

test("El formulario público sigue funcionando", async (t) => {
  const context = await startApp();
  t.after(() => context.stop());

  const invalid = await submitName(context, "A");
  assert.strictEqual(invalid.status, 400);

  const valid = await submitName(context, "Invitado");
  assert.strictEqual(valid.status, 200);
  const body = await valid.json();
  assert.strictEqual(body.ok, true);
  assert.strictEqual(typeof body.position, "number");
});

test("Cerrar sesión invalida el acceso HTTP y la cookie deja de servir", async (t) => {
  const context = await startApp();
  t.after(() => context.stop());

  const { cookie, csrfToken } = await loginOk(context);

  const logout = await fetch(`${context.baseUrl}/api/auth/logout`, {
    method: "POST",
    headers: {
      "Cookie": cookie,
      "Origin": context.baseUrl,
      "X-CSRF-Token": csrfToken,
      "Accept": "application/json"
    }
  });
  assert.strictEqual(logout.status, 200);

  const privateState = await fetch(`${context.baseUrl}/api/admin/state`, {
    headers: { "Cookie": cookie, "Accept": "application/json" }
  });
  assert.strictEqual(privateState.status, 401);

  const screen = await fetch(`${context.baseUrl}/screen`, {
    redirect: "manual",
    headers: { "Cookie": cookie, "Accept": "text/html" }
  });
  assert.strictEqual(screen.status, 302);
  assert.match(screen.headers.get("location"), /^\/login\?next=/);
});

test("Operaciones privadas exigen token CSRF y origen permitido", async (t) => {
  const context = await startApp();
  t.after(() => context.stop());

  const { cookie, csrfToken } = await loginOk(context);

  const withoutToken = await fetch(`${context.baseUrl}/api/auth/logout`, {
    method: "POST",
    headers: {
      "Cookie": cookie,
      "Origin": context.baseUrl,
      "Accept": "application/json"
    }
  });
  assert.strictEqual(withoutToken.status, 403);

  const wrongOrigin = await fetch(`${context.baseUrl}/api/auth/logout`, {
    method: "POST",
    headers: {
      "Cookie": cookie,
      "Origin": "http://malicioso.example",
      "X-CSRF-Token": csrfToken,
      "Accept": "application/json"
    }
  });
  assert.strictEqual(wrongOrigin.status, 403);

  const stillAuthenticated = await fetch(`${context.baseUrl}/api/auth/session`, {
    headers: { "Cookie": cookie, "Accept": "application/json" }
  });
  assert.strictEqual(stillAuthenticated.status, 200);
});

test("Credenciales erróneas usan respuesta genérica y hay límite de intentos", async (t) => {
  const context = await startApp();
  t.after(() => context.stop());

  const wrong = await requestLogin(context, { password: "contraseña-incorrecta" });
  assert.strictEqual(wrong.status, 401);
  const wrongBody = await wrong.json();

  const missing = await requestLogin(context, {});
  assert.strictEqual(missing.status, 401);
  const missingBody = await missing.json();

  assert.strictEqual(wrongBody.error, "Credenciales inválidas.");
  assert.strictEqual(missingBody.error, wrongBody.error);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await requestLogin(context, { password: `incorrecta-${attempt}` });
    assert.strictEqual(response.status, 401);
  }

  const blocked = await requestLogin(context, { password: "otra-mas" });
  assert.strictEqual(blocked.status, 429);
  assert.ok(blocked.headers.get("retry-after"));
});

test("Secure se añade a la cookie cuando la petición llega por HTTPS", async (t) => {
  const context = await startApp();
  t.after(() => context.stop());

  const response = await requestLogin(context, {
    password: ADMIN_PASSWORD,
    headers: { "X-Forwarded-Proto": "https" }
  });
  assert.strictEqual(response.status, 200);
  const { setCookie } = findSessionCookie(response);
  assert.match(setCookie, /;\s*Secure/i);
});

test("La configuración de producción rechaza secretos predeterminados", () => {
  const cwd = path.join(__dirname, "..");
  const command = "require('./src/config').assertValidConfig()";

  const missing = spawnSync(process.execPath, ["-e", command], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_ENV: "production",
      ADMIN_PASSWORD: "",
      SESSION_SECRET: ""
    }
  });
  assert.notStrictEqual(missing.status, 0);
  assert.match(missing.stderr, /ADMIN_PASSWORD/);

  const weak = spawnSync(process.execPath, ["-e", command], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_ENV: "production",
      ADMIN_PASSWORD: "dev-admin-password",
      SESSION_SECRET: "an-example-session-secret-with-more-than-32-characters"
    }
  });
  assert.notStrictEqual(weak.status, 0);
  assert.match(weak.stderr, /ADMIN_PASSWORD/);

  const strong = spawnSync(process.execPath, ["-e", command], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_ENV: "production",
      ADMIN_PASSWORD: "A-very-strong-production-password-123",
      SESSION_SECRET: "an-example-session-secret-with-more-than-32-characters"
    }
  });
  assert.strictEqual(strong.status, 0, strong.stderr);
});

test("No se acepta autenticación por token en la URL", async (t) => {
  const context = await startApp();
  t.after(() => context.stop());

  const loginPage = await fetch(`${context.baseUrl}/login?token=supuesto-token`, {
    redirect: "manual"
  });
  assert.strictEqual(loginPage.status, 200);
  assert.ok((await loginPage.text()).includes("Acceso privado"));

  const screen = await fetch(`${context.baseUrl}/screen?token=token-de-prueba`, {
    redirect: "manual"
  });
  assert.strictEqual(screen.status, 302);
});
