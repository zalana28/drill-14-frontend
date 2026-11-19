'use strict';

// Zero-dependency static server + /api reverse proxy for notevault-ui.
//
// The notevault API sets no CORS headers and the scored drill-7/8 repo
// must not be modified, so this server serves the frontend and proxies
// /api/* to the API on the same origin. The browser never talks to the
// API directly, and no credentials are involved anywhere.
//
// Env: UI_PORT (default 18082), API_BASE (default http://127.0.0.1:18081).

const http = require('http');
const fs = require('fs');
const path = require('path');

const UI_PORT = Number(process.env.UI_PORT || 18082);
const API_BASE = process.env.API_BASE || 'http://127.0.0.1:18081';
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function send(res, status, contentType, body) {
  res.writeHead(status, { 'Content-Type': contentType });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  // --- /api/* -> notevault API (strip the /api prefix) ---
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    const targetPath = url.pathname === '/api' ? '/' : url.pathname.slice(4);
    const target = new URL(targetPath + url.search, API_BASE);
    const proxy = http.request(
      {
        method: req.method,
        hostname: target.hostname,
        port: target.port,
        path: target.pathname + target.search,
        headers: { ...req.headers, host: target.host },
      },
      (upstream) => {
        // Forward status + content-type only; never forward hop-by-hop
        // headers, and never add auth of any kind.
        const headers = {};
        if (upstream.headers['content-type']) headers['Content-Type'] = upstream.headers['content-type'];
        res.writeHead(upstream.statusCode, headers);
        upstream.pipe(res);
      },
    );
    proxy.on('error', () => {
      send(res, 502, 'application/json; charset=utf-8', JSON.stringify({
        error: 'BAD_GATEWAY',
        message: 'Could not reach the server. Check that it is running and try again.',
      }));
    });
    req.pipe(proxy);
    return;
  }

  // --- static files ---
  let filePath = url.pathname === '/' ? '/index.html' : url.pathname;
  // No directory traversal: resolve inside PUBLIC_DIR only.
  const resolved = path.normalize(path.join(PUBLIC_DIR, filePath));
  if (!resolved.startsWith(PUBLIC_DIR + path.sep) && resolved !== PUBLIC_DIR) {
    send(res, 403, 'text/plain; charset=utf-8', 'Forbidden');
    return;
  }
  fs.readFile(resolved, (err, data) => {
    if (err) {
      send(res, 404, 'text/plain; charset=utf-8', 'Not found');
      return;
    }
    send(res, 200, MIME[path.extname(resolved)] || 'application/octet-stream', data);
  });
});

server.listen(UI_PORT, () => {
  console.log(JSON.stringify({ event: 'listening', port: UI_PORT, apiBase: API_BASE, pid: process.pid }));
});
