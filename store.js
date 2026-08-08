// Simple JSON-file storage: one snapshot file per UTC day.
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const DAILY_DIR = path.join(DATA_DIR, 'daily');
const RAW_DIR = path.join(DATA_DIR, 'raw');

function ensureDirs() {
  fs.mkdirSync(DAILY_DIR, { recursive: true });
  fs.mkdirSync(RAW_DIR, { recursive: true });
}

function todayUTC(d = new Date()) {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function snapshotPath(date) {
  return path.join(DAILY_DIR, `${date}.json`);
}

function saveSnapshot(snapshot) {
  ensureDirs();
  const date = snapshot.date || todayUTC();
  snapshot.date = date;
  fs.writeFileSync(snapshotPath(date), JSON.stringify(snapshot, null, 2));
  return snapshot;
}

function loadSnapshot(date) {
  try {
    return JSON.parse(fs.readFileSync(snapshotPath(date), 'utf8'));
  } catch {
    return null;
  }
}

function listDates() {
  ensureDirs();
  return fs.readdirSync(DAILY_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace('.json', ''))
    .sort();
}

function getLatest() {
  const dates = listDates();
  if (!dates.length) return null;
  return loadSnapshot(dates[dates.length - 1]);
}

function getHistory(days = 3650) {
  const dates = listDates().slice(-Number(days));
  return dates.map(d => {
    const s = loadSnapshot(d);
    return {
      date: d,
      fetchedAt: s.fetchedAt,
      totalInputTokens: s.totals.inputTokens,
      totalOutputTokens: s.totals.outputTokens,
      totalTokens: s.totals.totalTokens,
      totalRequests: s.totals.requests,
      totalCost: s.totals.cost,
      modelCount: s.models.length,
      coveragePct: s.coverage ? s.coverage.tokenCoveragePct : null,
      missingPriceCount: (s.missingPrice || []).length,
    };
  });
}

function saveRawSample(name, obj) {
  ensureDirs();
  fs.writeFileSync(path.join(RAW_DIR, `${name}.json`), JSON.stringify(obj, null, 2));
}

module.exports = {
  DATA_DIR,
  ensureDirs,
  todayUTC,
  saveSnapshot,
  loadSnapshot,
  listDates,
  getLatest,
  getHistory,
  saveRawSample,
};
