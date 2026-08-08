// Daily scraper: fetches OpenRouter rankings (per-model token volume) + model prices,
// computes marketplace-level gross token revenue for the day.
//
// Rankings endpoint (verified):  GET /api/frontend/v1/rankings/models?view=day
//   row fields: model_permaslug (dated, e.g. openai/gpt-5.4-nano-20260317),
//               variant (standard|batch|free|thinking),
//               total_prompt_tokens, total_completion_tokens,
//               total_native_tokens_cached, total_native_tokens_reasoning, count (requests)
// Models endpoint: GET /api/v1/models
//   pricing per token (USD, strings): prompt, completion, request,
//               input_cache_read, internal_reasoning, image, ...
//   batch variants are separate ids with ":batch" suffix.

const https = require('https');
const store = require('./store');

const RANKINGS_URL = 'https://openrouter.ai/api/frontend/v1/rankings/models?view=day';
const MODELS_URL = 'https://openrouter.ai/api/v1/models';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; OR-Dashboard/1.0; +https://openrouter.ai)',
  'Accept': 'application/json',
};

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: HEADERS, timeout: 30000 }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchJSON(res.headers.location).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`Bad JSON from ${url}: ${e.message}`)); }
      });
    });
    req.on('timeout', () => req.destroy(new Error(`Timeout: ${url}`)));
    req.on('error', reject);
  });
}

function toNum(v) {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}
const nonNeg = (n) => (n > 0 ? n : 0);

function buildPriceMap(modelsJSON) {
  const map = new Map();
  const byTail = new Map();
  const rows = modelsJSON.data || modelsJSON.models || modelsJSON.results || [];
  for (const m of rows) {
    const id = m.id || m.slug;
    if (!id || !m.pricing) continue;
    const p = m.pricing;
    const rec = {
      prompt: nonNeg(toNum(p.prompt)),
      completion: nonNeg(toNum(p.completion)),
      request: nonNeg(toNum(p.request)),
      cacheRead: nonNeg(toNum(p.input_cache_read || p.cache_read || p.prompt_cache_read)),
      reasoning: nonNeg(toNum(p.internal_reasoning || p.reasoning)),
    };
    map.set(id, rec);
    const tail = id.includes('/') ? id.split('/').slice(1).join('/') : id;
    if (!byTail.has(tail)) byTail.set(tail, []);
    byTail.get(tail).push(id);
  }
  return { map, byTail };
}

const stripDate = (s) => s.replace(/:[\w-]+$/, '').replace(/-(\d{4}-\d{2}-\d{2}|\d{8})$/, '');

function reorderClaude(slug) {
  return slug.replace(
    /^(anthropic\/claude)-([0-9][^-]*)-(sonnet|opus|haiku|fable|fast)$/,
    (_m, pre, ver, tier) => `${pre}-${tier}-${ver}`
  );
}

function resolvePriceId(permaslug, variant, map, byTail) {
  if (variant === 'free') return { id: null, free: true };
  const wantBatch = variant === 'batch';
  const root = stripDate(permaslug);
  const cands = new Set([root, reorderClaude(root)]);
  let s = root;
  for (let i = 0; i < 4; i++) {
    const idx = s.lastIndexOf('-');
    if (idx <= 0) break;
    s = s.slice(0, idx);
    cands.add(s);
    cands.add(reorderClaude(s));
  }
  for (const c of cands) {
    if (wantBatch && map.has(c + ':batch')) return { id: c + ':batch' };
    if (map.has(c)) return { id: c };
  }
  if (!root.includes('/')) {
    const tailCands = byTail.get(root) || [];
    const exact = tailCands.find(x => !x.includes(':'));
    if (exact) {
      if (wantBatch && map.has(exact + ':batch')) return { id: exact + ':batch' };
      return { id: exact };
    }
  }
  return { id: null };
}

function extractRows(rankingsJSON) {
  if (Array.isArray(rankingsJSON)) return rankingsJSON;
  if (!rankingsJSON || typeof rankingsJSON !== 'object') return [];
  if (Array.isArray(rankingsJSON.data)) return rankingsJSON.data;
  if (Array.isArray(rankingsJSON.models)) return rankingsJSON.models;
  if (Array.isArray(rankingsJSON.results)) return rankingsJSON.results;
  if (rankingsJSON.data && typeof rankingsJSON.data === 'object') return extractRows(rankingsJSON.data);
  return [];
}

function priceTier(outputPricePerToken) {
  const p = outputPricePerToken * 1e6;
  if (p <= 0) return 'free';
  if (p >= 5) return 'premium';
  if (p >= 1) return 'standard';
  return 'budget';
}

function aggregateAuthors(models, totals) {
  const byAuthor = new Map();
  for (const m of models) {
    const author = m.author || 'unknown';
    if (!byAuthor.has(author)) {
      byAuthor.set(author, {
        author,
        inputTokens: 0, outputTokens: 0, totalTokens: 0, requests: 0, cost: 0,
        modelCount: 0, topModel: null, topModelCost: 0,
      });
    }
    const a = byAuthor.get(author);
    a.inputTokens += m.inputTokens;
    a.outputTokens += m.outputTokens;
    a.totalTokens += m.inputTokens + m.outputTokens;
    a.requests += m.requests;
    a.cost += m.cost;
    a.modelCount += 1;
    if (m.cost > a.topModelCost) { a.topModelCost = m.cost; a.topModel = m.id; }
  }
  const list = Array.from(byAuthor.values());
  list.sort((a, b) => b.cost - a.cost);
  const totalCost = totals.cost || 1;
  const totalTokens = totals.totalTokens || 1;
  for (const a of list) {
    a.costShare = a.cost / totalCost;
    a.tokenShare = a.totalTokens / totalTokens;
    a.avgPricePerMtoken = a.totalTokens > 0 ? (a.cost / a.totalTokens) * 1e6 : 0;
  }
  return list;
}

function aggregateTiers(models) {
  const tiers = { premium:{cost:0,tokens:0,models:0}, standard:{cost:0,tokens:0,models:0}, budget:{cost:0,tokens:0,models:0}, free:{cost:0,tokens:0,models:0} };
  for (const m of models) {
    const t = m.tier || priceTier(m.outputPricePerToken);
    if (!tiers[t]) continue;
    tiers[t].cost += m.cost;
    tiers[t].tokens += m.inputTokens + m.outputTokens;
    tiers[t].models += 1;
  }
  return tiers;
}

function concentration(authors) {
  const total = authors.reduce((s, a) => s + a.cost, 0) || 1;
  const top5 = authors.slice(0, 5).reduce((s, a) => s + a.cost, 0);
  const top10 = authors.slice(0, 10).reduce((s, a) => s + a.cost, 0);
  const hhi = authors.reduce((s, a) => s + Math.pow((a.cost / total) * 100, 2), 0);
  return { top5Share: top5/total, top10Share: top10/total, hhi, top5Revenue: top5, totalRevenue: total };
}

function compute(rankingsJSON, priceInfo) {
  const { map, byTail } = priceInfo;
  const rows = extractRows(rankingsJSON);
  const models = [];
  const missingPrice = [];
  let totals = {
    inputTokens: 0, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0,
    totalTokens: 0, requests: 0, cost: 0,
  };
  let coveredTokens = 0;

  for (const r of rows) {
    const slug = r.model_permaslug || r.model || r.id;
    if (!slug) continue;
    const variant = r.variant || 'standard';
    const promptTokens = toNum(r.total_prompt_tokens);
    const completionTokens = toNum(r.total_completion_tokens);
    const cachedTokens = toNum(r.total_native_tokens_cached);
    const reasoningTokens = toNum(r.total_native_tokens_reasoning);
    const requests = toNum(r.count ?? r.requests);

    const { id: priceId, free } = resolvePriceId(slug, variant, map, byTail);
    const price = priceId ? map.get(priceId) : null;

    const uncachedPrompt = Math.max(0, promptTokens - cachedTokens);
    let cost = 0;
    if (price) {
      const cachePrice = price.cacheRead || price.prompt;
      cost = uncachedPrompt * price.prompt
           + cachedTokens * cachePrice
           + completionTokens * price.completion
           + requests * price.request;
      if (price.reasoning && reasoningTokens) cost += reasoningTokens * price.reasoning;
    } else if (free) {
      cost = 0;
    }

    const model = {
      id: slug,
      priceId: priceId || (free ? 'free' : null),
      name: r.name || slug,
      author: slug.includes('/') ? slug.split('/')[0] : null,
      variant,
      inputTokens: promptTokens,
      outputTokens: completionTokens,
      cachedTokens,
      reasoningTokens,
      requests,
      inputPricePerToken: price ? price.prompt : 0,
      outputPricePerToken: price ? price.completion : 0,
      tier: price ? priceTier(price.completion) : 'free',
      cost,
    };
    models.push(model);

    totals.inputTokens += promptTokens;
    totals.outputTokens += completionTokens;
    totals.cachedTokens += cachedTokens;
    totals.reasoningTokens += reasoningTokens;
    totals.totalTokens += promptTokens + completionTokens;
    totals.requests += requests;
    totals.cost += cost;
    if (price || free) coveredTokens += promptTokens + completionTokens;
    else missingPrice.push(slug);
  }

  models.sort((a, b) => b.cost - a.cost);

  const allTokens = totals.totalTokens || 1;
  const authors = aggregateAuthors(models, totals);
  const tiers = aggregateTiers(models);
  const conc = concentration(authors);

  return {
    totals,
    coverage: {
      matchedModels: models.filter(m => m.priceId).length,
      freeModels: models.filter(m => m.priceId === 'free').length,
      missingModels: missingPrice.length,
      matchedTokens: coveredTokens,
      tokenCoveragePct: coveredTokens / allTokens,
    },
    models,
    authors,
    tiers,
    concentration: conc,
    missingPrice,
    rankingRowCount: rows.length,
  };
}

async function run() {
  store.ensureDirs();
  console.log(`[${new Date().toISOString()}] Fetching rankings & prices...`);

  const [rankings, modelsJSON] = await Promise.all([
    fetchJSON(RANKINGS_URL),
    fetchJSON(MODELS_URL),
  ]);

  store.saveRawSample('rankings-day', rankings);
  store.saveRawSample('models', { count: (modelsJSON.data || []).length, sample: (modelsJSON.data || []).slice(0, 3) });

  const priceInfo = buildPriceMap(modelsJSON);
  const { totals, coverage, models, authors, tiers, concentration: conc, missingPrice, rankingRowCount } = compute(rankings, priceInfo);

  const rowDate = (rankings.data && rankings.data[0] && rankings.data[0].date) || null;
  const date = rowDate ? String(rowDate).slice(0, 10) : store.todayUTC();

  const snapshot = {
    date,
    fetchedAt: new Date().toISOString(),
    rankingsView: 'day',
    rankingsDate: rowDate,
    totals,
    coverage,
    authors,
    tiers,
    concentration: conc,
    priceModelCount: priceInfo.map.size,
    rankingRowCount,
    missingPrice,
    models,
  };

  store.saveSnapshot(snapshot);
  console.log(`Saved ${date}: ${models.length} rows, ${(coverage.tokenCoveragePct*100).toFixed(2)}% token coverage, ` +
    `$${totals.cost.toFixed(2)} gross, ${(totals.totalTokens/1e12).toFixed(2)}T tokens, ${totals.requests.toLocaleString()} reqs`);
  if (missingPrice.length) {
    console.log(`Note: ${missingPrice.length} models had no price (mostly embeddings/media). Sample:`, missingPrice.slice(0, 5));
  }
  return snapshot;
}

module.exports = { run, fetchJSON, compute, buildPriceMap, resolvePriceId, extractRows };

if (require.main === module) {
  run().catch(err => {
    console.error('Scrape failed:', err.message);
    process.exit(1);
  });
}
