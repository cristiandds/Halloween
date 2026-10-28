const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.env.PORT || '3000', 10);
const PUBLIC_DIR = path.resolve(__dirname, 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
};

// Route functions dynamically
const functionHandlers = {
  '/api/state': require('./netlify/functions/state').handler,
  '/api/submit': require('./netlify/functions/submit').handler,
  '/api/config': require('./netlify/functions/config').handler,
  '/api/qr': require('./netlify/functions/qr').handler,
  '/api/inscriptions/status': require('./netlify/functions/inscriptions').handler,
  '/api/inscriptions-status': require('./netlify/functions/inscriptions').handler,
  '/api/participant/status': require('./netlify/functions/participant').handler,
  '/api/participant-status': require('./netlify/functions/participant').handler,
  '/api/admin': require('./netlify/functions/admin').handler
};

const adminHandler = require('./netlify/functions/admin').handler;

async function handleApi(req, res, parsedUrl) {
  let bodyStr = '';
  req.on('data', chunk => {
    bodyStr += chunk;
  });

  req.on('end', async () => {
    const pathname = parsedUrl.pathname;
    let handler = functionHandlers[pathname];

    if (!handler && pathname.startsWith('/api/admin')) {
      handler = adminHandler;
    }

    if (!handler) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Endpoint API no encontrado.' }));
      return;
    }

    const queryObj = {};
    for (const [key, value] of parsedUrl.searchParams.entries()) {
      queryObj[key] = value;
    }

    const event = {
      httpMethod: req.method,
      path: pathname,
      headers: req.headers,
      queryStringParameters: queryObj,
      body: bodyStr
    };

    try {
      const result = await handler(event, {});
      const statusCode = result.statusCode || 200;
      const headers = result.headers || {};
      res.writeHead(statusCode, headers);
      res.end(result.body || '');
    } catch (err) {
      console.error('Error invoking API handler:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Error interno del servidor.' }));
    }
  });
}

function serveStatic(req, res, filePath) {
  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Recurso no encontrado');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stats.size,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600'
    });

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // API calls
  if (pathname.startsWith('/api/')) {
    handleApi(req, res, parsedUrl);
    return;
  }

  // Rewrite clean routes
  if (pathname === '/' || pathname === '/index') {
    serveStatic(req, res, path.join(PUBLIC_DIR, 'index.html'));
    return;
  }
  if (pathname === '/join') {
    serveStatic(req, res, path.join(PUBLIC_DIR, 'join.html'));
    return;
  }
  if (pathname === '/screen') {
    serveStatic(req, res, path.join(PUBLIC_DIR, 'screen.html'));
    return;
  }
  if (pathname === '/admin' || pathname === '/login') {
    serveStatic(req, res, path.join(PUBLIC_DIR, 'admin.html'));
    return;
  }

  // Static files in public/
  const safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, safePath);

  fs.stat(filePath, (err, stats) => {
    if (!err && stats.isFile()) {
      serveStatic(req, res, filePath);
    } else if (!err && stats.isDirectory()) {
      serveStatic(req, res, path.join(filePath, 'index.html'));
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 No encontrado');
    }
  });
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`🎃 Servidor Halloween QR ejecutándose en http://localhost:${PORT}`);
    console.log(`📱 Formulario móvil: http://localhost:${PORT}/join`);
    console.log(`🖥️ Proyección LED:  http://localhost:${PORT}/screen`);
    console.log(`⚙️ Panel admin:     http://localhost:${PORT}/admin`);
  });
}

module.exports = server;
