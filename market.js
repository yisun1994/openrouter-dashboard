// Market index & stock-style analytics computed from daily history.
const store = require('./store');
const BASE_POINTS = 1000;
function round(n, d) { d = d || 2; var f = Math.pow(10, d); return Math.round(n * f) / f; }
function buildIndex(history) {
  var h = (history || []).slice().sort(function(a, b) { return a.date.localeCompare(b.date) });
  if (!h.length) return { series: [], base: BASE_POINTS };
  var baseCost = h[0].totalCost || 1;
  var series = h.map(function(d, i) {
    var point = (d.totalCost / baseCost) * BASE_POINTS;
    var prev = i > 0 ? h[i - 1] : null;
    var chg = prev ? d.totalCost - prev.totalCost : 0;
    var chgPct = prev && prev.totalCost ? (chg / prev.totalCost) * 100 : 0;
    return { date: d.date, cost: d.totalCost, tokens: d.totalTokens, requests: d.totalRequests,
      point: round(point, 2), change: round(chg), changePct: round(chgPct, 2),
      close: round(point, 2), volume: d.totalTokens };
  });
  for (var i = 0; i < series.length; i++) {
    if (i >= 6) { var s7 = series.slice(i - 6, i + 1); series[i].ma7 = round(s7.reduce(function(a, x) { return a + x.close }, 0) / 7, 2); }
    if (i >= 29) { var s30 = series.slice(i - 29, i + 1); series[i].ma30 = round(s30.reduce(function(a, x) { return a + x.close }, 0) / 30, 2); }
  }
  return { series: series, base: BASE_POINTS, baseDate: h[0].date, baseCost: baseCost };
}
function summarize(idx) {
  var s = idx.series; if (!s.length) return null;
  var cur = s[s.length - 1], prev = s.length > 1 ? s[s.length - 2] : cur;
  var ath = s[0], atl = s[0];
  for (var i = 1; i < s.length; i++) { if (s[i].close > ath.close) ath = s[i]; if (s[i].close < atl.close) atl = s[i]; }
  var chg7 = s.length > 7 ? cur.close - s[s.length - 8].close : null;
  var chg7Pct = s.length > 7 && s[s.length - 8].close ? (chg7 / s[s.length - 8].close) * 100 : null;
  var chg30 = s.length > 30 ? cur.close - s[s.length - 31].close : null;
  var chg30Pct = s.length > 30 && s[s.length - 31].close ? (chg30 / s[s.length - 31].close) * 100 : null;
  var fromBasePct = ((cur.close - idx.base) / idx.base) * 100;
  return {
    current: cur, previous: prev, change: cur.change, changePct: cur.changePct,
    change7: chg7 !== null ? round(chg7) : null, change7Pct: chg7Pct !== null ? round(chg7Pct, 2) : null,
    change30: chg30 !== null ? round(chg30) : null, change30Pct: chg30Pct !== null ? round(chg30Pct, 2) : null,
    fromBasePct: round(fromBasePct, 2),
    ath: { date: ath.date, point: ath.close, cost: ath.cost },
    atl: { date: atl.date, point: atl.close, cost: atl.cost },
    fromAthPct: round(((cur.close - ath.close) / ath.close) * 100, 2),
    annualized: cur.cost * 365, daysTracked: s.length
  };
}
function breadth(dates) {
  if (dates.length < 2) return { advancers: 0, decliners: 0, unchanged: 0, total: 0, topGainers: [], topLosers: [], changes: {} };
  var today = store.loadSnapshot(dates[dates.length - 1]);
  var yest = store.loadSnapshot(dates[dates.length - 2]);
  if (!today || !yest || !today.authors) return { advancers: 0, decliners: 0, unchanged: 0, total: 0, topGainers: [], topLosers: [], changes: {} };
  var prevMap = {};
  (yest.authors || []).forEach(function(a) { prevMap[a.author] = a.cost; });
  var changes = [], changesMap = {};
  var adv = 0, dec = 0, unc = 0;
  (today.authors || []).forEach(function(a) {
    var pc = prevMap[a.author];
    if (pc === undefined) { adv++; var rec={author:a.author,cost:a.cost,prevCost:0,changePct:100,isNew:true}; changes.push(rec); changesMap[a.author]=rec; return; }
    var diff = a.cost - pc, pct = pc > 0 ? (diff / pc) * 100 : 0;
    if (diff > 0.01) adv++; else if (diff < -0.01) dec++; else unc++;
    var rec2 = { author: a.author, cost: a.cost, prevCost: pc, change: diff, changePct: round(pct, 2) };
    changes.push(rec2); changesMap[a.author] = rec2;
  });
  changes.sort(function(a, b) { return b.changePct - a.changePct; });
  return { advancers: adv, decliners: dec, unchanged: unc, total: today.authors.length,
    topGainers: changes.slice(0, 5), topLosers: changes.slice(-5).reverse(), changes: changesMap };
}
function getMarket() {
  var history = store.getHistory();
  var dates = store.listDates();
  var idx = buildIndex(history);
  var summary = summarize(idx);
  var br = breadth(dates);
  return { index: idx, summary: summary, breadth: br, dates: dates };
}
module.exports = { buildIndex: buildIndex, summarize: summarize, breadth: breadth, getMarket: getMarket, BASE_POINTS: BASE_POINTS };
