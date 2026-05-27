// Tiny API server: runs vibeusage --json and serves results
// Runs as a systemd service on the VPS
// Auth: shared secret via ?key= query param or X-API-Key header

const http = require('http');
const https = require('https');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3199;
const VIBEUSAGE = process.env.VIBEUSAGE_PATH || '/home/ubuntu/.local/bin/vibeusage';
const API_KEY = process.env.VIBEUSAGE_API_KEY || '';
const CACHE_TTL = 45; // seconds

let cached = null;
let cachedAt = 0;
let fetching = false;

// Simple per-IP rate limit: max N requests per minute
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX = 30; // requests per window
const rateLimitMap = new Map();

function checkRateLimit(ip) {
  const now = Date.now();
  let entry = rateLimitMap.get(ip);
  if (!entry || now - entry.start > RATE_LIMIT_WINDOW) {
    entry = { start: now, count: 0 };
    rateLimitMap.set(ip, entry);
  }
  entry.count++;
  // Cleanup old entries every 100 requests
  if (rateLimitMap.size > 100) {
    for (const [k, v] of rateLimitMap) {
      if (now - v.start > RATE_LIMIT_WINDOW) rateLimitMap.delete(k);
    }
  }
  return entry.count <= RATE_LIMIT_MAX;
}

function checkAuth(req) {
  if (!API_KEY) return true;

  const header = req.headers['x-api-key'];
  if (header && header === API_KEY) return true;

  // Parse ?key= from the raw URL to avoid URL constructor issues
  const rawQuery = req.url.includes('?') ? req.url.split('?')[1] : '';
  const match = rawQuery.match(/(?:^|&)key=([^&]+)/);
  if (match && decodeURIComponent(match[1]) === API_KEY) return true;

  return false;
}

function sanitizeErrors(data) {
  if (!data || !data.errors) return data;
  for (const k of Object.keys(data.errors)) {
    if (typeof data.errors[k] !== 'string') continue;
    data.errors[k] = data.errors[k]
      .replace(/sk-[a-zA-Z0-9]{10,}/g, 'sk-***')
      .replace(/Bearer\s+[^\s"]+/gi, 'Bearer ***')
      .replace(/token[=:]\s*sk-[^\s]+/gi, 'token=***');
  }
  return data;
}

// --- Codex direct fetch (bypasses vibeusage bug) ---
const CODEX_AUTH_PATH = path.join(process.env.HOME || '/home/ubuntu', '.codex', 'auth.json');
const OPENAI_TOKEN_URL = 'https://auth.openai.com/oauth/token';
const CHATGPT_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';
const OPENAI_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';

function httpsRequest(url, options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        res.body = Buffer.concat(chunks).toString();
        resolve(res);
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

async function refreshCodexToken(refreshToken) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: OPENAI_CLIENT_ID,
  }).toString();

  const res = await httpsRequest(OPENAI_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  }, body);

  if (res.statusCode !== 200) throw new Error(`Token refresh failed: ${res.statusCode}`);
  return JSON.parse(res.body);
}

function readCodexCredentials() {
  try {
    const data = JSON.parse(fs.readFileSync(CODEX_AUTH_PATH, 'utf8'));
    return data.tokens || null;
  } catch { return null; }
}

function writeCodexCredentials(tokens) {
  try {
    const data = JSON.parse(fs.readFileSync(CODEX_AUTH_PATH, 'utf8'));
    data.tokens = { ...data.tokens, ...tokens };
    fs.writeFileSync(CODEX_AUTH_PATH, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('Failed to write codex credentials:', e.message);
  }
}

async function fetchCodexUsage() {
  const creds = readCodexCredentials();
  if (!creds || !creds.access_token) return null;

  let accessToken = creds.access_token;

  // Try refreshing the token first
  if (creds.refresh_token) {
    try {
      const refreshed = await refreshCodexToken(creds.refresh_token);
      accessToken = refreshed.access_token;
      writeCodexCredentials({
        access_token: refreshed.access_token,
        refresh_token: refreshed.refresh_token,
        id_token: refreshed.id_token || creds.id_token,
      });
    } catch (e) {
      console.error('Codex token refresh failed, trying existing token:', e.message);
    }
  }

  // Fetch usage from ChatGPT
  const res = await httpsRequest(CHATGPT_USAGE_URL, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json',
      'User-Agent': 'codex-cli/0.134.0',
    },
  });

  if (res.statusCode !== 200) return null;
  return JSON.parse(res.body);
}

function parseCodexUsage(apiResp) {
  if (!apiResp || !apiResp.rate_limit) return null;
  const rl = apiResp.rate_limit;
  const periods = [];

  if (rl.primary_window) {
    periods.push({
      name: 'Session (5h)',
      utilization: rl.primary_window.used_percent,
      period_type: 'session',
      resets_at: rl.primary_window.reset_at ? new Date(rl.primary_window.reset_at * 1000).toISOString() : null,
    });
  }
  if (rl.secondary_window) {
    periods.push({
      name: 'Weekly',
      utilization: rl.secondary_window.used_percent,
      period_type: 'weekly',
      resets_at: rl.secondary_window.reset_at ? new Date(rl.secondary_window.reset_at * 1000).toISOString() : null,
    });
  }

  return {
    fetched_at: new Date().toISOString(),
    periods,
    identity: {
      plan: apiResp.plan_type || 'unknown',
      email: apiResp.email || null,
    },
    source: 'codex_direct',
  };
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

    (async () => {
      try {
        const stdout = await new Promise((res, rej) => {
          execFile(VIBEUSAGE, args, { timeout: 30000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
            if (err) return rej(err);
            res(stdout);
          });
        });

        const parsed = JSON.parse(stdout);
        sanitizeErrors(parsed);

        // Overlay Codex data from direct ChatGPT API (bypasses vibeusage bug)
        try {
          const codexApi = await fetchCodexUsage();
          if (codexApi) {
            const codexParsed = parseCodexUsage(codexApi);
            if (codexParsed) {
              if (!parsed.providers) parsed.providers = {};
              parsed.providers.codex = codexParsed;
            }
          }
        } catch (e) {
          console.error('Codex direct fetch failed:', e.message);
        }

        cached = parsed;
        cachedAt = Date.now();
        resolve({ data: cached, age: 0 });
      } catch (err) {
        console.error(`vibeusage error: ${err.message}`);
        if (cached) {
          return resolve({ data: cached, age: Math.round((Date.now() - cachedAt) / 1000), stale: true, error: err.message });
        }
        reject(err);
      } finally {
        fetching = false;
      }
    })();
  });
}

const allowedOrigins = [
  'https://opurtell.github.io',
  'https://a1-instance.tail61c8f0.ts.net',
  'http://localhost:',
  'http://127.0.0.1:'
];

const server = http.createServer(async (req, res) => {
  // Parse URL safely
  let pathname = req.url.split('?')[0];
  let parsedUrl;
  try {
    parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'bad request' }));
    return;
  }

  // CORS
  const origin = req.headers.origin || '';
  const allowOrigin = allowedOrigins.some(o => origin.startsWith(o)) ? origin : '';
  res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key');
  res.setHeader('Vary', 'Origin');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // Rate limit
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.socket?.remoteAddress || 'unknown';
  if (!checkRateLimit(ip)) {
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'rate limited' }));
    return;
  }

  // Auth check for API routes
  if (pathname.startsWith('/api/') && !checkAuth(req)) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'unauthorized' }));
    return;
  }

  if (pathname === '/api/usage' && req.method === 'GET') {
    const forceFresh = parsedUrl.searchParams.get('fresh') === '1';
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

  if (pathname === '/api/health' && req.method === 'GET') {
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

function shutdown() {
  console.log('Shutting down...');
  server.close(() => process.exit(0));
  // Force exit after 5s if connections hang
  setTimeout(() => process.exit(1), 5000);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
