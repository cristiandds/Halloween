const { test } = require("node:test");
const assert = require("node:assert");
const http = require("http");

const { createApp } = require("../src/app");

test("GET /health returns ok", async (t) => {
  const { app, server } = createApp();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;

  const res = await new Promise((resolve, reject) => {
    http.get({ hostname: "127.0.0.1", port, path: "/health" }, (resp) => {
      let data = "";
      resp.on("data", (d) => (data += d));
      resp.on("end", () => resolve({ status: resp.statusCode, data }));
    }).on("error", reject);
  });

  assert.strictEqual(res.status, 200);
  const body = JSON.parse(res.data);
  assert.strictEqual(body.status, "ok");

  await new Promise((resolve) => server.close(resolve));
});

test("GET /api/config returns expected fields", async (t) => {
  const { app, server } = createApp();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;

  const res = await new Promise((resolve, reject) => {
    http.get({ hostname: "127.0.0.1", port, path: "/api/config" }, (resp) => {
      let data = "";
      resp.on("data", (d) => (data += d));
      resp.on("end", () => resolve({ status: resp.statusCode, data }));
    }).on("error", reject);
  });

  assert.strictEqual(res.status, 200);
  const body = JSON.parse(res.data);
  assert.ok(typeof body.joinUrl === "string");
  assert.ok(typeof body.displaySeconds === "number");

  await new Promise((resolve) => server.close(resolve));
});

test("POST /api/submit validates name and enqueues", async (t) => {
  const { app, server } = createApp();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;

  // invalid name
  const resBad = await new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port, path: "/api/submit", method: "POST", headers: { "Content-Type": "application/json" } }, (resp) => {
      let data = "";
      resp.on("data", (d) => (data += d));
      resp.on("end", () => resolve({ status: resp.statusCode, data }));
    });
    req.on("error", reject);
    req.write(JSON.stringify({ name: "A" }));
    req.end();
  });
  assert.strictEqual(resBad.status, 400);

  // valid name
  const resOk = await new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port, path: "/api/submit", method: "POST", headers: { "Content-Type": "application/json" } }, (resp) => {
      let data = "";
      resp.on("data", (d) => (data += d));
      resp.on("end", () => resolve({ status: resp.statusCode, data }));
    });
    req.on("error", reject);
    req.write(JSON.stringify({ name: "Test" }));
    req.end();
  });
  assert.strictEqual(resOk.status, 200);
  const body = JSON.parse(resOk.data);
  assert.strictEqual(body.ok, true);

  await new Promise((resolve) => server.close(resolve));
});
