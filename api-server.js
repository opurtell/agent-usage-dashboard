// Tiny API server: runs vibeusage --json and serves results
// Runs as a systemd service on the VPS

const http = require('http');
const { execFile } = require('child_process');
const path = require('path');

const PORT = process.env.PORT || 3199;
const VIBEUSAGE = process.env.VIBEUSAGE_PATH || '/home/ubuntu/.local/bin/vibeusage';
const CACHE_TTL = 45; // seconds — slightly under vibeusage's own 60s cache

let cached = null;
let cachedAt = 0;
let fetching = false;

function fetchUsage(forceFresh) {
  return new Promise((resolve, reject) => {
    const now = Date.now();

    // Return cache if fresh enough and not forcing
    if (!forceFresh && cached && (now - cachedAt) < CACHE_TTL * 1000) {
      return resolve({ data: cached, age: Math.round((now - cachedAt) / 1000) });
    }

    // If a fetch is already in progress, wait for it
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
        console.error(`stderr: ${stderr}`);
        // Return stale cache if available
        if (cached) {
          return resolve({ data: cached, age: Math.round((Date.now() - cachedAt) / 1000), stale: true, error: err.message });
        }
        return reject(err);
      }

      try {
        cached = JSON.parse(stdout);
        cachedAt = Date.now();
        resolve({ data: cached, age: 0 });
      } catch (parseErr) {
        console.error(`JSON parse error: ${parseErr.message}`);
        console.error(`stdout: ${stdout.slice(0, 500)}`);
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

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
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
    res.end(JSON.stringify({ ok: true, uptime: process.uptime(), cached: !!cached }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error: 'not found' }));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`vibeusage API listening on http://127.0.0.1:${PORT}`);
  // Pre-warm cache
  fetchUsage(true).then(() => console.log('Initial fetch complete')).catch(e => console.error('Initial fetch failed:', e.message));
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down...');
  server.close(() => process.exit(0));
});
