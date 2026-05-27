// Tiny API server: runs vibeusage --json and serves results
// Runs as a systemd service on the VPS
// Auth: shared secret via ?key= query param or X-API-Key header

const http = require('http');
const { execFile } = require('child_process');

const PORT = process.env.PORT || 3199;
const VIBEUSAGE = process.env.VIBEUSAGE_PATH || '/home/ubuntu/.local/bin/vibeusage';
const API_KEY = process.env.VIBEUSAGE_API_KEY || ''; // shared secret
const CACHE_TTL = 45; // seconds

let cached = null;
let cachedAt = 0;
let fetching = false;

function checkAuth(req) {
  if (!API_KEY) return true; // no key configured = open (local dev only)

  // Check X-API-Key header
  const header = req.headers['x-api-key'];
  if (header && header === API_KEY) return true;

  // Check ?key= query param
  const url = new URL(req.url, `http://${req.headers.host}`);
  const queryKey = url.searchParams.get('key');
  if (queryKey && queryKey === API_KEY) return true;

  return false;
}

function fetchUsage(forceFresh) {
  return new Promise((resolve, reject) => {
    const now = Date.now();

    if (!forceFresh && cached && (now - cachedAt) < CACHE_TTL * 1000) {
      return resolve({ data: cached, age: Math.round((now - cachedAt) / 1000) });
    }

    if (fetching) {
      const interval = setInterval(() => {
        if (!fetching) {
          clearInterval(interval);
          resolve({ data: cached, age: Math.round((Date.now() - cachedAt) / 1000) });
        }
      }, 200);
      return;
    }

    fetching = true;
    const args = ['--json'];
    if (forceFresh) args.push('--no-cache');

    execFile(VIBEUSAGE, args, { timeout: 30000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      fetching = false;

      if (err) {
        console.error(`vibeusage error: ${err.message}`);
        if (cached) {
          return resolve({ data: cached, age: Math.round((Date.now() - cachedAt) / 1000), stale: true, error: err.message });
        }
        return reject(err);
      }

      try {
        const parsed = JSON.parse(stdout);

        // Sanitize: remove any error messages that might contain token hints
        if (parsed.errors) {
          for (const k of Object.keys(parsed.errors)) {
            // Keep error type but strip anything that looks like a token/key
            parsed.errors[k] = parsed.errors[k]
              .replace(/sk-[a-zA-Z0-9]{10,}/g, 'sk-***')
              .replace(/Bearer [^\s"]+/gi, 'Bearer ***')
              .replace(/token[=:]\s*\S+/gi, 'token=***')
              .replace(/key[=:]\s*\S+/gi, 'key=***');
          }
        }

        cached = parsed;
        cachedAt = Date.now();
        resolve({ data: cached, age: 0 });
      } catch (parseErr) {
        console.error(`JSON parse error: ${parseErr.message}`);
        if (cached) {
          return resolve({ data: cached, age: Math.round((Date.now() - cachedAt) / 1000), stale: true, error: parseErr.message });
        }
        reject(parseErr);
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // CORS — only allow from GH Pages and localhost
  const origin = req.headers.origin || '';
  const allowedOrigins = [
    'https://opurtell.github.io',
    'http://localhost:',
    'http://127.0.0.1:'
  ];
  const allowOrigin = allowedOrigins.some(o => origin.startsWith(o)) ? origin : '';

  res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key');
  res.setHeader('Vary', 'Origin');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // Auth check for API routes
  if (url.pathname.startsWith('/api/') && !checkAuth(req)) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'unauthorized' }));
    return;
  }

  if (url.pathname === '/api/usage' && req.method === 'GET') {
    const forceFresh = url.searchParams.get('fresh') === '1';

    try {
      const result = await fetchUsage(forceFresh);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        fetched_at: new Date(cachedAt).toISOString(),
        age_seconds: result.age,
        stale: result.stale || false,
        error: result.error || null,
        data: result.data
      }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  if (url.pathname === '/api/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, uptime: Math.round(process.uptime()) }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error: 'not found' }));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`vibeusage API listening on http://127.0.0.1:${PORT}`);
  console.log(`Auth: ${API_KEY ? 'enabled' : 'DISABLED (no VIBEUSAGE_API_KEY set)'}`);
  fetchUsage(true).then(() => console.log('Initial fetch complete')).catch(e => console.error('Initial fetch failed:', e.message));
});

process.on('SIGTERM', () => {
  console.log('Shutting down...');
  server.close(() => process.exit(0));
});
