const fs = require('fs');
const path = require('path');
const { fetchIPOBatch } = require('./etnetSource');

const DATA_DIR = path.join(__dirname, '../data');
const IPO_LIST_JSON = path.join(DATA_DIR, 'ipo-list.json');
const HISTORY_JSON = path.join(DATA_DIR, 'ipo-history.json');
const DASHBOARD_FIXTURE_JSON = path.join(__dirname, '../tests/fixtures/dashboard/dashboard-sample.json');

const CACHE_TTL_MS = 5 * 60 * 1000;
let dashboardCache = { data: null, expiresAt: 0 };

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function withScore(record) {
  const score = n(record.score) ?? Math.round((n(record.subscription_multiple) || 0) / 10 + (n(record.cumulative_return) || 0) / 5);
  const rating = score >= 8 ? 'A' : score >= 5 ? 'B' : score >= 2 ? 'C' : 'D';
  return { ...record, score, rating };
}

function sortItems(items, sortBy = 'score') {
  const cloned = [...items];
  const dirMap = { listing_date: 'asc', offer_end_date: 'asc', lot_cost: 'asc' };
  const dir = dirMap[sortBy] || 'desc';
  cloned.sort((a, b) => {
    const av = a[sortBy] ?? null;
    const bv = b[sortBy] ?? null;
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    if (String(sortBy).includes('date')) {
      return dir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
    }
    return dir === 'asc' ? av - bv : bv - av;
  });
  return cloned;
}

function getStatusLabel(raw) {
  const map = {
    hearing_passed: '已通过聆讯',
    subscribing: '招股中',
    allotment_pending: '等待分配',
    listing_soon: '即将上市',
    grey_market: '暗盘',
    listed_today: '今日上市',
    listed: '已上市',
  };
  return map[raw] || raw || '待公布';
}

function loadJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function toSafeFront(v) {
  return v === null || v === undefined || v === '' ? '暂无数据' : v;
}

function sanitizeForFrontend(input) {
  if (input === null || input === undefined) return '暂无数据';
  if (Array.isArray(input)) return input.map(sanitizeForFrontend);
  if (typeof input === 'object') {
    return Object.fromEntries(Object.entries(input).map(([k, v]) => [k, sanitizeForFrontend(v)]));
  }
  if (typeof input === 'number' && Number.isNaN(input)) return '暂无数据';
  return input;
}

async function loadBaseRecords() {
  if ((process.env.IPO_DATA_MODE || 'live') === 'fixture') {
    const fixture = loadJsonIfExists(DASHBOARD_FIXTURE_JSON);
    return fixture?.records || [];
  }

  const list = loadJsonIfExists(IPO_LIST_JSON);
  const localRecords = (list?.ipos || []).map((r) => ({
    code: String(r.code || '').padStart(5, '0'),
    name: r.name || null,
    score: n(r.score),
    rating: r.rating || null,
    status: r.status,
    listing_date: r.listing_date || r.listingDate || null,
    offer_end_date: r.offer_end_date || r.subscriptionEnd || null,
    offer_price: n(r.offer_price),
    offer_price_range: r.offer_price_range || null,
    lot_size: n(r.lot_size || r.lotSize),
    lot_cost: n(r.lot_amount),
    current_price: n(r.current_price),
    cumulative_return: n(r.current_vs_offer_pct),
    subscription_multiple: n(r.subscription_multiple),
    success_rate: n(r.allotment_rate),
    source_coverage: 1,
    data_completeness: 0,
    _source: { field_sources: {}, source_sections: ['local'] },
  }));

  let liveRecords = [];
  try {
    const live = await fetchIPOBatch({ limit: 30 });
    liveRecords = (live.items || []).map((i) => ({ ...i }));
  } catch (error) {
    console.warn(`[dashboard] live source warning: ${error.message}`);
  }

  const map = new Map();
  [...localRecords, ...liveRecords].forEach((r) => map.set(r.code, { ...(map.get(r.code) || {}), ...r }));
  return Array.from(map.values());
}

function buildTimeline(items) {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const tomorrow = new Date(now.getTime() + 24 * 3600 * 1000).toISOString().slice(0, 10);
  const futureSoon = (d) => d && d >= today;

  return {
    subscribing: items.filter((i) => i.status === 'subscribing').slice(0, 10),
    closing_soon: items.filter((i) => futureSoon(i.offer_end_date)).slice(0, 10),
    allotment_soon: items.filter((i) => i.status === 'allotment_pending').slice(0, 10),
    refund_soon: items.filter((i) => i.refund_date && futureSoon(i.refund_date)).slice(0, 10),
    listing_soon: items.filter((i) => i.status === 'listing_soon').slice(0, 10),
    listed_today: items.filter((i) => i.status === 'listed_today' || i.listing_date === today).slice(0, 10),
    listed_tomorrow: items.filter((i) => i.listing_date === tomorrow).slice(0, 10),
  };
}

function buildMarketTemp(items) {
  const history = loadJsonIfExists(HISTORY_JSON);
  const recent = (history?.recentIPOs || []).slice(0, 30);
  const values = recent.map((x) => n(String(x.firstDayReturn || '').replace('%', ''))).filter((x) => x !== null);
  const last7 = values.slice(0, 7);
  const avg7 = last7.length ? Number((last7.reduce((a, b) => a + b, 0) / last7.length).toFixed(2)) : null;
  const breakRate30 = values.length ? Number(((values.filter((x) => x < 0).length / values.length) * 100).toFixed(2)) : null;

  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setUTCDate(now.getUTCDate() - now.getUTCDay());
  const ws = weekStart.toISOString().slice(0, 10);

  return {
    avg_first_day_return_7d: avg7,
    break_rate_30d: breakRate30,
    subscribing_count_week: items.filter((i) => i.status === 'subscribing' && (i.offer_end_date || '') >= ws).length,
    listing_count_week: items.filter((i) => (i.listing_date || '') >= ws).length,
  };
}

function buildValidationSummary(items) {
  const withReturns = items.filter((i) => n(i.cumulative_return) !== null);
  const high = withReturns.filter((i) => (i.score || 0) >= 6);
  const low = withReturns.filter((i) => (i.score || 0) <= 1);
  return {
    sample_size: withReturns.length,
    high_score_up_rate: high.length ? Number(((high.filter((i) => n(i.cumulative_return) > 0).length / high.length) * 100).toFixed(2)) : null,
    low_score_break_rate: low.length ? Number(((low.filter((i) => n(i.cumulative_return) < 0).length / low.length) * 100).toFixed(2)) : null,
  };
}

function cleanupFrontendFields(item) {
  const cleaned = { ...item };
  // 前端暂时不暴露 PE 展示字段
  ['pe', 'pe_score', 'pe_reason', 'pe_explain', 'pe_details'].forEach((k) => delete cleaned[k]);
  return cleaned;
}

async function buildDashboard({ sortBy = 'score', forceRefresh = false } = {}) {
  if (!forceRefresh && dashboardCache.data && Date.now() < dashboardCache.expiresAt) {
    return { ...dashboardCache.data, cache_hit: true };
  }

  const base = await loadBaseRecords();
  const normalized = base.map(withScore).map((r) => ({
    ...r,
    status_label: getStatusLabel(r.status),
    data_completeness: n(r.data_completeness) ?? 0,
    source_coverage: n(r.source_coverage) ?? 0,
  })).map(cleanupFrontendFields);

  const sorted = sortItems(normalized, sortBy);
  const data = {
    updated_at: new Date().toISOString(),
    top3: sortItems(normalized, 'score').slice(0, 3),
    leaderboard: sorted,
    timeline: buildTimeline(normalized),
    market_temperature: buildMarketTemp(normalized),
    validation_summary: buildValidationSummary(normalized),
    cache_ttl_ms: CACHE_TTL_MS,
    cache_hit: false,
  };

  const sanitized = sanitizeForFrontend(data);
  dashboardCache = { data: sanitized, expiresAt: Date.now() + CACHE_TTL_MS };
  return sanitized;
}

function startDashboardSyncJob() {
  setInterval(async () => {
    try {
      await buildDashboard({ forceRefresh: true });
      console.log('[dashboard] synced');
    } catch (error) {
      console.warn(`[dashboard] sync warning: ${error.message}`);
    }
  }, CACHE_TTL_MS);
}

module.exports = { buildDashboard, startDashboardSyncJob, CACHE_TTL_MS, toSafeFront };
