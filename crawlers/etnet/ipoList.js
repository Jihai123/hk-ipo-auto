/**
 * etnet IPO列表页爬虫（首页轻量版）
 * 目标：抓取 招股中 / 待上市 / 近期上市 三类数据
 * 仅提取列表页稳定字段，不强依赖详情页
 */

const axios = require('axios');
const cheerio = require('cheerio');
const cfg = require('./config');

const STATUS_MAP = {
  subscribing: 'subscribing',
  listingSoon: 'listingSoon',
  recentListed: 'recentListed',
};

const MAX_NAME_LENGTH = 40;

const TABLE_TYPE = {
  subscribing: 'subscribing',
  recentListed: 'recentListed',
};

const FIXED_TABLE_INDEX = {
  subscribing: 4, // table#5
  recentListed: 7, // table#8
};

const FIXED_COLUMN_MAP = {
  subscribing: {
    code: 0,
    name: 1,
    offerEndDate: 3,
    listingDate: 4,
    currency: 5,
    offerPrice: 6,
    lotSize: 7,
    lotAmount: 8,
  },
  recentListed: {
    code: 0,
    name: 1,
    listingDate: 2,
    offerPrice: 4,
    subscriptionMultiple: 5,
    allotmentRate: 7,
    firstDayChangePct: 10,
  },
};

function normalizeCode(raw = '') {
  const code = String(raw).replace(/[^0-9]/g, '');
  if (!code) return null;
  return code.padStart(5, '0');
}

function normalizeDate(raw = '') {
  const text = String(raw).trim();
  if (!text) return null;

  const ymd = text.match(/(\d{4})[\/.\-年](\d{1,2})[\/.\-月](\d{1,2})/);
  if (ymd) {
    const y = ymd[1];
    const mo = ymd[2].padStart(2, '0');
    const d = ymd[3].padStart(2, '0');
    return `${y}-${mo}-${d}`;
  }

  const dmy = text.match(/(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})/);
  if (dmy) {
    const y = dmy[3];
    const mo = dmy[2].padStart(2, '0');
    const d = dmy[1].padStart(2, '0');
    return `${y}-${mo}-${d}`;
  }

  return null;
}

function normalizeDateOrRaw(raw = '') {
  const normalized = normalizeDate(raw);
  if (normalized) return normalized;
  const text = String(raw).trim();
  return text || null;
}

function parsePriceRange(raw = '') {
  const text = String(raw).replace(/\s+/g, ' ').trim();
  if (!text) return { offerPrice: null, offerPriceRange: null };
  const nums = (text.match(/[\d.]+/g) || []).map(Number).filter(n => !Number.isNaN(n));
  if (nums.length === 0) return { offerPrice: null, offerPriceRange: text };
  if (nums.length === 1) return { offerPrice: nums[0], offerPriceRange: null };
  return {
    offerPrice: null,
    offerPriceRange: `${nums[0]}-${nums[nums.length - 1]}`,
  };
}

function parseLotSize(raw = '') {
  const text = String(raw).replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const m = text.match(/(\d{1,9})/);
  if (!m) return null;
  const v = parseInt(m[1], 10);
  return Number.isNaN(v) ? null : v;
}

function parseLotAmount(raw = '') {
  const m = String(raw).replace(/,/g, '').match(/([\d.]+)/);
  if (!m) return null;
  const v = parseFloat(m[1]);
  return Number.isNaN(v) ? null : v;
}

function parsePercentNumber(raw = '') {
  const text = String(raw).replace(/,/g, '').trim();
  if (!text) return null;
  const m = text.match(/([+-]?\d+(?:\.\d+)?)\s*%?/);
  if (!m) return null;
  const value = parseFloat(m[1]);
  return Number.isNaN(value) ? null : value;
}

function sanitizeName(raw = '') {
  const text = String(raw).replace(/\s+/g, ' ').trim();
  if (!text) return null;

  const firstSegment = text
    .replace(/(?:今午|今日|明午|明日)截止.*$/g, '')
    .replace(/(?:孖展|按金|认购|認購).*$/g, '')
    .split(/[|｜\/\n\r]/)[0]
    .split(/\s{2,}/)[0]
    .trim();

  if (!firstSegment) return null;
  const noCode = firstSegment
    .replace(/\((?:HK|hk)?\s*[:：]?\s*\d{4,5}\)/g, '')
    .replace(/\b\d{4,5}\b/g, '')
    .trim();

  if (!noCode) return null;
  if (/^股票\d{4,5}$/i.test(noCode)) return null;
  if (noCode.length > MAX_NAME_LENGTH) return noCode.slice(0, MAX_NAME_LENGTH).trim();
  return noCode;
}

function getPrimaryText(raw = '') {
  return String(raw).replace(/\s+/g, ' ').trim().split(/\s{2,}/)[0].trim();
}

function getByIndex(columns = [], idx) {
  if (typeof idx !== 'number' || idx < 0 || idx >= columns.length) return null;
  return columns[idx] || null;
}

function parseRowByFixedMap(columns = [], map = {}) {
  const codeCandidate = getByIndex(columns, map.code) || null;
  const nameCandidate = getByIndex(columns, map.name) || null;

  return {
    code: codeCandidate?.match(/\d{4,5}/)?.[0] || null,
    name: getPrimaryText(nameCandidate || ''),
    offerEndDate: getByIndex(columns, map.offerEndDate),
    listingDate: getByIndex(columns, map.listingDate),
    currency: getByIndex(columns, map.currency),
    offerPriceRaw: getByIndex(columns, map.offerPrice),
    offerPrice: getByIndex(columns, map.offerPrice),
    lotSize: getByIndex(columns, map.lotSize),
    lotAmount: getByIndex(columns, map.lotAmount),
    subscriptionMultiple: getByIndex(columns, map.subscriptionMultiple),
    allotmentRate: getByIndex(columns, map.allotmentRate),
    firstDayChangePct: getByIndex(columns, map.firstDayChangePct),
  };
}

function normalizeSubscribingItem(item) {
  const code = normalizeCode(item.code);
  const name = sanitizeName(item.name);
  if (!code || !name) return null;

  return {
    code,
    name,
    status: STATUS_MAP.subscribing,
    listingDate: normalizeDateOrRaw(item.listingDate),
    offerPriceRange: String(item.offerPriceRaw || '').trim() || null,
    lotSize: parseLotSize(item.lotSize),
    lotAmount: parseLotAmount(item.lotAmount),
    offerEndDate: normalizeDateOrRaw(item.offerEndDate),
    currency: String(item.currency || '').trim() || null,
  };
}

function normalizeRecentListedItem(item) {
  const code = normalizeCode(item.code);
  const name = sanitizeName(item.name);
  if (!code || !name) return null;

  return {
    code,
    name,
    status: STATUS_MAP.recentListed,
    listingDate: normalizeDateOrRaw(item.listingDate),
    offerPrice: parsePriceRange(item.offerPriceRaw || item.offerPrice).offerPrice,
    subscriptionMultiple: parseLotAmount(item.subscriptionMultiple),
    allotmentRate: parsePercentNumber(item.allotmentRate),
    firstDayChangePct: parsePercentNumber(item.firstDayChangePct),
    lotSize: null,
  };
}

function normalizeItemByStatus(item, status) {
  if (status === TABLE_TYPE.subscribing) return normalizeSubscribingItem(item);
  if (status === TABLE_TYPE.recentListed) return normalizeRecentListedItem(item);
  return null;
}

function parseFixedTable($, tableNode, status, debug = false) {
  const map = FIXED_COLUMN_MAP[status];
  if (!tableNode || !map) return [];
  const rows = $(tableNode).find('tr');
  const list = [];

  rows.slice(1).each((rowIndex, row) => {
    const tds = $(row).find('td');
    if (!tds || tds.length < 2) return;

    const columns = tds.map((i, td) => $(td).text().replace(/\s+/g, ' ').trim()).get();
    const parsedRow = parseRowByFixedMap(columns, map);
    const normalized = normalizeItemByStatus(parsedRow, status);

    if (debug) {
      console.log(`[ipoList][debug][${status}] row#${rowIndex + 1} raw=`, columns);
      console.log(`[ipoList][debug][${status}] row#${rowIndex + 1} parsed=`, normalized);
    }

    if (normalized) list.push(normalized);
  });

  return list;
}

function getTableByIndex($, idx) {
  const tables = $('table');
  if (!tables || tables.length <= idx) return null;
  return tables.eq(idx);
}

function parseFixedTables($, debug = false) {
  const subscribingTable = getTableByIndex($, FIXED_TABLE_INDEX.subscribing);
  const recentTable = getTableByIndex($, FIXED_TABLE_INDEX.recentListed);

  const subscribing = subscribingTable
    ? parseFixedTable($, subscribingTable, TABLE_TYPE.subscribing, debug)
    : [];
  const recentListed = recentTable
    ? parseFixedTable($, recentTable, TABLE_TYPE.recentListed, debug)
    : [];

  if (!subscribingTable) {
    console.warn('[etnet/ipoList] 固定表定位失败: 招股中 table#5 不存在');
  }
  if (!recentTable) {
    console.warn('[etnet/ipoList] 固定表定位失败: 近期上市 table#8 不存在');
  }

  return {
    subscribing,
    recentListed,
  };
}

function uniqByCode(items = []) {
  const map = new Map();
  for (const item of items) {
    if (!item || !item.code) continue;
    if (!map.has(item.code)) map.set(item.code, item);
  }
  return Array.from(map.values());
}

async function fetchWithRetry(url, retries = cfg.maxRetries) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await axios.get(url, { headers: cfg.headers, timeout: cfg.timeout });
      return res.data;
    } catch (err) {
      console.warn(`[etnet/ipoList] 请求失败(第${attempt}次): ${url} — ${err.message}`);
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, cfg.requestDelay * attempt));
      }
    }
  }
  return null;
}

async function crawlIPOListFromETNet() {
  const url = cfg.baseURL + cfg.urls.ipoList;
  console.log(`[etnet/ipoList] 爬取: ${url}`);

  const html = await fetchWithRetry(url);
  if (!html) {
    return {
      subscribing: [],
      listingSoon: [],
      recentListed: [],
      source: 'etnet',
      fetchedAt: new Date().toISOString(),
    };
  }

  const $ = cheerio.load(html);
  const result = {
    subscribing: [],
    listingSoon: [],
    recentListed: [],
    source: 'etnet',
    fetchedAt: new Date().toISOString(),
  };

  const parsed = parseFixedTables($);
  result.subscribing = parsed.subscribing;
  result.recentListed = parsed.recentListed;

  if (result.subscribing.length === 0) {
    console.warn('[etnet/ipoList] 招股中表解析结果为空（table#5）');
  }
  if (result.recentListed.length === 0) {
    console.warn('[etnet/ipoList] 近期上市表解析结果为空（table#8）');
  }

  result.subscribing = uniqByCode(result.subscribing);
  result.listingSoon = uniqByCode(result.listingSoon);
  result.recentListed = uniqByCode(result.recentListed).slice(0, 12);

  console.log(`[etnet/ipoList] 完成: subscribing=${result.subscribing.length}, listingSoon=${result.listingSoon.length}, recentListed=${result.recentListed.length}`);
  return result;
}

async function debugRun() {
  const url = cfg.baseURL + cfg.urls.ipoList;
  console.log(`[etnet/ipoList][debug] 爬取: ${url}`);
  const html = await fetchWithRetry(url);
  if (!html) {
    console.log('[etnet/ipoList][debug] 抓取失败');
    return [];
  }

  const $ = cheerio.load(html);
  const parsed = parseFixedTables($, true);
  const debugItems = [...parsed.subscribing, ...parsed.recentListed];

  const clean = uniqByCode(debugItems)
    .map(item => ({
      code: item.code,
      name: item.name,
      status: item.status,
      listingDate: item.listingDate,
      lotSize: item.lotSize,
    }))
    .slice(0, 10);

  console.log('[etnet/ipoList][debug] sample=', clean);
  return clean;
}

module.exports = {
  crawlIPOListFromETNet,
  debugRun,
};
