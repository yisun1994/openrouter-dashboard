// Zero-dependency HTTP server: dashboard + JSON API + daily scheduler.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const scraper = require('./scraper');
const store = require('./store');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  const p = u.searchParams;

  try {
    if (u.pathname === '/api/history') {
      return sendJSON(res, 200, store.getHistory(p.get('days') || 3650));
    }
    if (u.pathname === '/api/latest') {
      return sendJSON(res, 200, store.getLatest());
    }
    if (u.pathname === '/api/snapshot') {
      const date = p.get('date') || store.todayUTC();
      const snap = store.loadSnapshot(date);
      return sendJSON(res, snap ? 200 : 404, snap || { error: 'no snapshot', date });
    }
    if (u.pathname === '/api/dates') {
      return sendJSON(res, 200, store.listDates());
    }
    if (u.pathname === '/api/scrape' && req.method === 'POST') {
      const snap = await scraper.run();
      return sendJSON(res, 200, snap);
    }
    if (u.pathname === '/api/health') {
      return sendJSON(res, 200, { ok: true, time: new Date().toISOString(), dates: store.listDates().length });
    }
    // default: static
    return serveStatic(req, res, u.pathname);
  } catch (e) {
    return sendJSON(res, 500, { error: e.message });
  }
});

// ---- Scheduler: run scrape near end of UTC day (23:55) and on startup ----
let timer = null;
let scraping = false;

async function tick() {
  if (scraping) return;
  scraping = true;
  try {
    await scraper.run();
  } catch (e) {
    console.error('Scheduled scrape failed:', e.message);
  } finally {
    scraping = false;
    scheduleNext();
  }
}

function scheduleNext() {
  if (timer) clearTimeout(timer);
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(23, 55, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  const wait = next - now;
  timer = setTimeout(tick, wait);
  console.log(`Next scheduled scrape at ${next.toISOString()} (in ${Math.round(wait / 60000)} min)`);
}

store.ensureDirs();
server.listen(PORT, () => {
  console.log(`OR Dashboard running at http://localhost:${PORT}`);
  // Run once on startup (captures today-so-far; overwritten by the 23:55 run).
  tick();
});
