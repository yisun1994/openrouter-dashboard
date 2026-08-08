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
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(body);
}

function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end('Forbidden'); return; }
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
    if (u.pathname === '/api/history') return sendJSON(res, 200, store.getHistory(p.get('days') || 3650));
    if (u.pathname === '/api/latest') return sendJSON(res, 200, store.getLatest());
    if (u.pathname === '/api/snapshot') {
      const date = p.get('date') || store.todayUTC();
      const snap = store.loadSnapshot(date);
      return sendJSON(res, snap ? 200 : 404, snap || { error: 'no snapshot', date });
    }
    if (u.pathname === '/api/dates') return sendJSON(res, 200, store.listDates());
    if (u.pathname === '/api/author-history') {
      const topN = Number(p.get('top') || 8);
      const dates = store.listDates();
      const series = {};
      for (const d of dates) {
        const snap = store.loadSnapshot(d);
        if (!snap || !snap.authors) continue;
        for (const a of snap.authors.slice(0, topN * 2)) {
          if (!series[a.author]) series[a.author] = [];
          series[a.author].push({ date: d, cost: a.cost, tokens: a.totalTokens, share: a.costShare });
        }
      }
      const latest = store.getLatest();
      const topAuthors = (latest && latest.authors ? latest.authors : []).slice(0, topN).map(a => a.author);
      const result = {};
      for (const a of topAuthors) result[a] = series[a] || [];
      return sendJSON(res, 200, { dates, authors: topAuthors, series: result });
    }
    if (u.pathname === '/api/scrape' && req.method === 'POST') {
      const snap = await scraper.run();
      return sendJSON(res, 200, snap);
    }
    if (u.pathname === '/api/health') return sendJSON(res, 200, { ok: true, time: new Date().toISOString(), dates: store.listDates().length });
    return serveStatic(req, res, u.pathname);
  } catch (e) {
    return sendJSON(res, 500, { error: e.message });
  }
});

let timer = null, scraping = false;
async function tick() {
  if (scraping) return; scraping = true;
  try { await scraper.run(); } catch (e) { console.error('Scheduled scrape failed:', e.message); }
  finally { scraping = false; scheduleNext(); }
}
function scheduleNext() {
  if (timer) clearTimeout(timer);
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(23, 55, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  timer = setTimeout(tick, next - now);
  console.log(`Next scheduled scrape at ${next.toISOString()}`);
}

store.ensureDirs();
server.listen(PORT, () => { console.log(`OR Dashboard running at http://localhost:${PORT}`); tick(); });
