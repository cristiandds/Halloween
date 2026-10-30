const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Password',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
};

function json(status, body, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...JSON_HEADERS,
      ...extraHeaders
    }
  });
}

function getHeader(request, name) {
  const headers = request?.headers;
  if (!headers) return undefined;
  if (typeof headers.get === 'function') {
    return headers.get(name) ?? undefined;
  }
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) return value;
  }
  return undefined;
}

function getBaseUrl(request) {
  if (process.env.PUBLIC_BASE_URL && process.env.PUBLIC_BASE_URL.trim()) {
    return process.env.PUBLIC_BASE_URL.trim().replace(/\/$/, '');
  }

  let requestUrl = null;
  try {
    requestUrl = request?.url ? new URL(request.url) : null;
  } catch (e) {
    requestUrl = null;
  }

  const host = getHeader(request, 'x-forwarded-host') ||
    getHeader(request, 'host') ||
    requestUrl?.host;
  if (!host) return '';

  const forwardedProto = getHeader(request, 'x-forwarded-proto');
  const urlProto = requestUrl?.protocol?.replace(':', '');
  const isLocalHost = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host);
  let proto = forwardedProto || urlProto;
  if (!forwardedProto && urlProto === 'http' && !isLocalHost) {
    // Behind Netlify the public scheme is HTTPS even if the internal URL is HTTP.
    proto = 'https';
  }
  if (!proto) {
    proto = isLocalHost ? 'http' : 'https';
  }

  const cleanProto = String(proto).split(',')[0].trim();
  return `${cleanProto}://${host}`.replace(/\/$/, '');
}

function getClientIp(request) {
  try {
    const xf = getHeader(request, 'x-forwarded-for');
    if (xf) return String(xf).split(',')[0].trim();
    const clientIp = getHeader(request, 'client-ip');
    if (clientIp) return String(clientIp).trim();
    const realIp = getHeader(request, 'x-real-ip');
    if (realIp) return String(realIp).trim();
    return null;
  } catch (e) {
    return null;
  }
}

function getAdminPassword() {
  return process.env.ADMIN_PASSWORD || 'halloween2026';
}

function getPathname(request) {
  try {
    return new URL(request.url).pathname;
  } catch (e) {
    return '';
  }
}

function getSearchParams(request) {
  try {
    return new URL(request.url).searchParams;
  } catch (e) {
    return new URLSearchParams();
  }
}

async function parseJsonBody(request) {
  if (!request || request.method === 'GET' || request.method === 'HEAD') {
    return { ok: true, body: {} };
  }
  try {
    const text = await request.text();
    if (!text) return { ok: true, body: {} };
    return { ok: true, body: JSON.parse(text) };
  } catch (e) {
    return { ok: false, body: null };
  }
}

function verifyAdmin(request, body = {}) {
  const expectedPassword = getAdminPassword();

  // Check X-Admin-Password header
  const customHeader = getHeader(request, 'x-admin-password');
  if (customHeader && customHeader === expectedPassword) {
    return true;
  }

  // Check Authorization Bearer header
  const auth = getHeader(request, 'authorization');
  if (auth && auth.startsWith('Bearer ')) {
    const token = auth.slice(7).trim();
    if (token === expectedPassword) return true;
  }

  // Check cookie
  const cookieHeader = getHeader(request, 'cookie');
  if (cookieHeader) {
    const cookies = cookieHeader.split(';').map(c => c.trim());
    for (const c of cookies) {
      if (c.startsWith('admin_token=')) {
        const val = decodeURIComponent(c.substring('admin_token='.length));
        if (val === expectedPassword) return true;
      }
    }
  }

  // Check body password if provided
  if (body && typeof body === 'object' && body.password === expectedPassword) {
    return true;
  }

  return false;
}

module.exports = {
  json,
  getHeader,
  getBaseUrl,
  getClientIp,
  getAdminPassword,
  getPathname,
  getSearchParams,
  parseJsonBody,
  verifyAdmin
};
