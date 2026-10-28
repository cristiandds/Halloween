function json(status, body, extraHeaders = {}) {
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Password',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      ...extraHeaders
    },
    body: JSON.stringify(body)
  };
}

function getBaseUrl(event) {
  if (process.env.PUBLIC_BASE_URL && process.env.PUBLIC_BASE_URL.trim()) {
    return process.env.PUBLIC_BASE_URL.trim().replace(/\/$/, '');
  }
  const headers = event?.headers || {};
  const host = headers['x-forwarded-host'] || headers.host;
  const proto = headers['x-forwarded-proto'] || (host && host.includes('localhost') ? 'http' : 'https');
  if (host) {
    const cleanProto = String(proto).split(',')[0].trim();
    return `${cleanProto}://${host}`.replace(/\/$/, '');
  }
  return '';
}

function getClientIp(event) {
  try {
    const h = event?.headers || {};
    const xf = h['x-forwarded-for'] || h['X-Forwarded-For'];
    if (xf) return String(xf).split(',')[0].trim();
    if (h['client-ip']) return h['client-ip'].trim();
    if (h['x-real-ip']) return h['x-real-ip'].trim();
    return null;
  } catch (e) {
    return null;
  }
}

function getAdminPassword() {
  return process.env.ADMIN_PASSWORD || 'halloween2026';
}

function verifyAdmin(event) {
  const expectedPassword = getAdminPassword();
  const headers = event?.headers || {};

  // Check X-Admin-Password header
  const customHeader = headers['x-admin-password'] || headers['X-Admin-Password'];
  if (customHeader && customHeader === expectedPassword) {
    return true;
  }

  // Check Authorization Bearer header
  const auth = headers.authorization || headers.Authorization;
  if (auth && auth.startsWith('Bearer ')) {
    const token = auth.slice(7).trim();
    if (token === expectedPassword) return true;
  }

  // Check cookie
  const cookieHeader = headers.cookie || headers.Cookie;
  if (cookieHeader) {
    const cookies = cookieHeader.split(';').map(c => c.trim());
    for (const c of cookies) {
      if (c.startsWith('admin_token=')) {
        const val = decodeURIComponent(c.substring('admin_token='.length));
        if (val === expectedPassword) return true;
      }
    }
  }

  // Check body password if POST
  if (event?.body) {
    try {
      const parsed = JSON.parse(event.body);
      if (parsed.password && parsed.password === expectedPassword) {
        return true;
      }
    } catch (e) {}
  }

  return false;
}

module.exports = {
  json,
  getBaseUrl,
  getClientIp,
  getAdminPassword,
  verifyAdmin
};
