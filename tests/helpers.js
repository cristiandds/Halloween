"use strict";

function toWebRequest(event = {}) {
  const method = String(event.httpMethod || event.method || 'GET').toUpperCase();
  const headers = new Headers();

  for (const [key, value] of Object.entries(event.headers || {})) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      value.forEach((item) => headers.append(key, String(item)));
    } else {
      headers.set(key, String(value));
    }
  }

  const host = headers.get('host') || 'localhost';
  const pathname = event.path || '/';
  const query = event.queryStringParameters
    ? new URLSearchParams(event.queryStringParameters).toString()
    : '';
  const url = event.url || `http://${host}${pathname}${query ? `?${query}` : ''}`;

  const init = { method, headers };
  if (method !== 'GET' && method !== 'HEAD' && event.body !== undefined && event.body !== null) {
    init.body = event.body;
  }

  return new Request(url, init);
}

async function invoke(handler, event = {}) {
  const response = await handler(toWebRequest(event), {});
  const body = await response.text();
  const headers = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });

  return {
    statusCode: response.status,
    headers,
    body
  };
}

function adapt(handler) {
  return (event = {}) => invoke(handler, event);
}

module.exports = {
  toWebRequest,
  invoke,
  adapt
};
