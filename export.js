// Export daily snapshots from data/daily into public/data so the dashboard
// can be served as a static site (e.g. GitHub Pages) without the Node API.
const fs = require('fs');
const path = require('path');
const store = require('./store');

const OUT_DIR = path.join(__dirname, 'public', 'data');
const SNAP_DIR = path.join(OUT_DIR, 'snapshots');

function run() {
  fs.mkdirSync(SNAP_DIR, { recursive: true });
  const dates = store.listDates();
  const history = store.getHistory();

  fs.writeFileSync(path.join(OUT_DIR, 'history.json'), JSON.stringify(history));
  fs.writeFileSync(path.join(OUT_DIR, 'dates.json'), JSON.stringify(dates));

  for (const d of dates) {
    const snap = store.loadSnapshot(d);
    fs.writeFileSync(path.join(SNAP_DIR, `${d}.json`), JSON.stringify(snap));
  }
  console.log(`Exported ${dates.length} snapshots to public/data`);
}

if (require.main === module) run();
module.exports = { run };
