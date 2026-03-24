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
  const score = n(record.score) ?? Math.round((n(record.subscription_multiple) || 0) / 10 + (n(record.first_day_return) || 0) / 5);
  const rating = score >= 8 ? 'A' : score >= 5 ? 'B' : score >= 2 ? 'C' : 'D';
  return { ...record, score, rating };
}

function sortItems(items, sortBy = 'score') {
  const cloned = [...items];
  const keyDir = {
    score: 'desc',
    listing_date: 'asc',
    subscription_close: 'asc',
    lot_cost: 'asc',
    first_day_return: 'desc',
    current_return: 'desc',
  };
  const dir = keyDir[sortBy] || 'desc';
  cloned.sort((a, b) => {
    const av = a[sortBy] ?? null;
    const bv = b[sortBy] ?? null;
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    if (sortBy.includes('date') || sortBy.includes('close')) {
      return dir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
    }
    return dir === 'asc' ? av - bv : bv - av;
  });
  return cloned;
}

function getStatusLabel(raw) {
  const s = String(raw || '').toLowerCase();
  if (s.includes('subscrib')) return '招股中';
  if (s.includes('listed')) return '已上市';
  if (s.includes('coming')) return '待上市';
  if (s.includes('network')) return '数据抓取异常';
  return raw || '待公布';
}

function buildTimeline(items) {
  const now = new Date().toISOString().slice(0, 10);
  const isToday = (d) => d === now;
  const isFuture = (d) => d && d >= now;
  return {
    subscribing: items.filter((i) => i.status_label === '招股中').slice(0, 10),
    closing_today: items.filter((i) => isToday(i.subscription_close)).slice(0, 10),
    allotment_soon: items.filter((i) => isFuture(i.allotment_date)).slice(0, 10),
    refund_soon: items.filter((i) => isFuture(i.refund_date)).slice(0, 10),
    listing_soon: items.filter((i) => isFuture(i.listing_date)).slice(0, 10),
  };
}


function sanitizeNulls(input) {
  if (input === null || input === undefined) return '--';
  if (Array.isArray(input)) return input.map(sanitizeNulls);
  if (typeof input === 'object') {
    return Object.fromEntries(Object.entries(input).map(([k, v]) => [k, sanitizeNulls(v)]));
  }
  return input;
}

function loadJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
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
    subscription_close: r.offer_end_date || r.subscriptionEnd || null,
    offer_price: n(r.offer_price),
    lot_size: n(r.lot_size || r.lotSize),
    lot_cost: n(r.lot_amount),
    current_price: n(r.current_price),
    current_return: n(r.current_vs_offer_pct),
    first_day_return: n(r.first_day_change_pct),
    subscription_multiple: n(r.subscription_multiple),
    success_rate: n(r.allotment_rate),
    allotment_date: r.allotment_result_date || null,
    refund_date: r.refund_date || null,
    source: 'local',
  }));

  let liveRecords = [];
  try {
    const live = await fetchIPOBatch({ limit: 25 });
    liveRecords = (live.items || []).map((i) => ({
      code: i.code,
      name: i.name,
      status: i.status,
      listing_date: i.listing_date,
      offer_price: i.offer_price,
      lot_size: i.lot_size,
      lot_cost: i.lot_cost,
      subscription_multiple: i.subscription_multiple,
      success_rate: i.success_rate,
      first_day_close: i.first_day_close,
      source: 'etnet',
    }));
  } catch (error) {
    console.warn(`[dashboard] live source warning: ${error.message}`);
  }

  const map = new Map();
  [...localRecords, ...liveRecords].forEach((r) => map.set(r.code, { ...(map.get(r.code) || {}), ...r }));
  return Array.from(map.values());
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
  const thisWeekSubscribe = items.filter((i) => i.subscription_close && i.subscription_close >= ws).length;
  const thisWeekListing = items.filter((i) => i.listing_date && i.listing_date >= ws).length;

  return {
    avg_first_day_return_7d: avg7,
    break_rate_30d: breakRate30,
    subscribing_count_week: thisWeekSubscribe,
    listing_count_week: thisWeekListing,
  };
}

function buildValidationSummary(items) {
  const withReturns = items.filter((i) => i.first_day_return !== null);
  const high = withReturns.filter((i) => (i.score || 0) >= 6);
  const low = withReturns.filter((i) => (i.score || 0) <= 1);
  return {
    sample_size: withReturns.length,
    high_score_up_rate: high.length ? Number(((high.filter((i) => i.first_day_return > 0).length / high.length) * 100).toFixed(2)) : null,
    low_score_break_rate: low.length ? Number(((low.filter((i) => i.first_day_return < 0).length / low.length) * 100).toFixed(2)) : null,
  };
}

async function buildDashboard({ sortBy = 'score', forceRefresh = false } = {}) {
  if (!forceRefresh && dashboardCache.data && Date.now() < dashboardCache.expiresAt) {
    return { ...dashboardCache.data, cache_hit: true };
  }

  const base = await loadBaseRecords();
  const normalized = base.map(withScore).map((r) => ({
    ...r,
    status_label: getStatusLabel(r.status),
  }));

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

  const sanitized = sanitizeNulls(data);
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

module.exports = { buildDashboard, startDashboardSyncJob, CACHE_TTL_MS };
