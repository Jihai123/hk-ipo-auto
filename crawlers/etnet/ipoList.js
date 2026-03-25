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

function normalizeCode(raw = '') {
  const code = String(raw).replace(/[^0-9]/g, '');
  if (!code) return null;
  return code.padStart(5, '0');
}

function normalizeDate(raw = '') {
  const text = String(raw).trim();
  if (!text) return null;
  const m = text.match(/(\d{4})[\/.\-年](\d{1,2})[\/.\-月](\d{1,2})/);
  if (!m) return null;
  const y = m[1];
  const mo = m[2].padStart(2, '0');
  const d = m[3].padStart(2, '0');
  return `${y}-${mo}-${d}`;
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
  const m = text.match(/(?:每手(?:股數|股数)?|一手)\s*[:：]?\s*(\d{1,6})\b/i)
    || text.match(/\b(\d{1,6})\s*(?:股|shares?)\b/i);
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

function normalizeItem(item, status) {
  const code = normalizeCode(item.code);
  const name = sanitizeName(item.name);
  if (!code || !name) return null;

  const { offerPrice, offerPriceRange } = parsePriceRange(item.offerPriceRaw || item.offerPrice);

  return {
    code,
    name,
    status: STATUS_MAP[status] || status,
    listingDate: normalizeDate(item.listingDate),
    offerPrice,
    offerPriceRange,
    lotSize: parseLotSize(item.lotSize),
    lotAmount: parseLotAmount(item.lotAmount),
  };
}

function sanitizeName(raw = '') {
  const text = String(raw).replace(/\s+/g, ' ').trim();
  if (!text) return null;

  // 清理常见括号股票代码，避免与name拼接
  const noCode = text
    .replace(/\((?:HK|hk)?\s*[:：]?\s*\d{4,5}\)/g, '')
    .replace(/\b\d{4,5}\b/g, '')
    .trim();

  // 仅保留首段名称，防止整页说明文字拼进来
  const firstSegment = noCode
    .replace(/(?:今午|今日|明午|明日)?截止.*/g, '')
    .replace(/(?:孖展|按金|认购|認購).*/g, '')
    .split(/[|｜\/\n\r]/)[0]
    .split(/\s{2,}/)[0]
    .trim();
  if (!firstSegment) return null;
  if (/^股票\d{4,5}$/i.test(firstSegment)) return null;
  if (firstSegment.length > MAX_NAME_LENGTH) return firstSegment.slice(0, MAX_NAME_LENGTH).trim();
  return firstSegment;
}

function normalizeHeader(raw = '') {
  return String(raw).replace(/\s+/g, '').toLowerCase();
}

function detectColumnIndex(headers = [], patterns = []) {
  if (!headers.length) return -1;
  return headers.findIndex((h) => patterns.some((p) => p.test(h)));
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

function getTableHeaders($, table) {
  const headerRow = $(table).find('tr').first();
  return headerRow.find('th,td').map((_, cell) => $(cell).text().replace(/\s+/g, ' ').trim()).get();
}

function classifyIpoTable(headers = []) {
  const normalized = headers.map(h => normalizeHeader(h));
  const hasCode = normalized.some(h => /代號|代码|編號|编号/.test(h));
  const hasName = normalized.some(h => /名稱|名称|簡稱|简称/.test(h));
  const hasListingDate = normalized.some(h => /上市日|上市日期/.test(h));
  const hasLot = normalized.some(h => /每手|一手/.test(h));
  if (!hasCode || !hasName || !hasListingDate || !hasLot) return null;

  const hasOfferDate = normalized.some(h => /招股日期|截止|招股期|發售期|发售期/.test(h));
  const hasLotAmount = normalized.some(h => /入場費|入场费|入場/.test(h));
  const hasMultiple = normalized.some(h => /認購倍數|认购倍数/.test(h));
  const hasAllot = normalized.some(h => /中籤|中签|一手中签/.test(h));

  if (hasOfferDate && hasLotAmount && headers.length >= 8) return TABLE_TYPE.subscribing;
  if (hasMultiple && hasAllot && headers.length >= 8) return TABLE_TYPE.recentListed;
  return null;
}

function buildFixedMap(headers = [], tableType) {
  const normalized = headers.map(h => normalizeHeader(h));
  const idx = (patterns) => detectColumnIndex(normalized, patterns);
  if (tableType === TABLE_TYPE.subscribing) {
    return {
      code: idx([/代號|代码|編號|编号/]),
      name: idx([/名稱|名称|簡稱|简称/]),
      offerEndDate: idx([/招股日期|截止|招股期|發售期|发售期/]),
      listingDate: idx([/上市日|上市日期/]),
      currency: idx([/貨幣|货币/]),
      offerPrice: idx([/招股價|招股价|發售價|发售价|定價|定价/]),
      lotSize: idx([/每手|一手/]),
      lotAmount: idx([/入場費|入场费|一手入場|一手入场/]),
    };
  }
  return {
    code: idx([/代號|代码|編號|编号/]),
    name: idx([/名稱|名称|簡稱|简称/]),
    listingDate: idx([/上市日|上市日期/]),
    offerPrice: idx([/上市價|上市价|招股價|招股价|發售價|发售价/]),
    subscriptionMultiple: idx([/認購倍數|认购倍数/]),
    lotSize: idx([/每手|一手/]),
    allotmentRate: idx([/中籤率|中签率|一手中籤率|一手中签率/]),
    firstDayChangePct: idx([/首日|首天|首挂|升跌|變幅|变幅/]),
  };
}

function extractFromRows($, table, status, map, debug = false) {
  const list = [];
  const rows = table.find('tr');
  if (!rows || rows.length === 0) return list;

  rows.slice(1).each((rowIndex, row) => {
    const tds = $(row).find('td');
    if (tds.length < 2) return;

    const columns = tds.map((i, td) => $(td).text().replace(/\s+/g, ' ').trim()).get();
    const parsedRow = parseRowByFixedMap(columns, map);
    const normalized = normalizeItem(parsedRow, status);

    if (debug) {
      console.log(`[ipoList][debug][${status}] row#${rowIndex + 1} raw=`, columns);
      console.log(`[ipoList][debug][${status}] row#${rowIndex + 1} parsed=`, normalized);
    }

    if (normalized) list.push(normalized);
  });

  return list;
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

  $('table').each((_, table) => {
    const headers = getTableHeaders($, table);
    const tableType = classifyIpoTable(headers);
    if (!tableType) return;
    const fixedMap = buildFixedMap(headers, tableType);
    if (tableType === TABLE_TYPE.subscribing) {
      result.subscribing = result.subscribing.concat(extractFromRows($, $(table), 'subscribing', fixedMap));
      return;
    }
    result.recentListed = result.recentListed.concat(extractFromRows($, $(table), 'recentListed', fixedMap));
  });

  // 去重
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
  const debugItems = [];

  $('table').each((tableIdx, table) => {
    const headers = getTableHeaders($, table);
    if (headers.length === 0) return;
    console.log(`[etnet/ipoList][debug] table#${tableIdx + 1} headers=[${headers.join(', ')}]`);

    const tableType = classifyIpoTable(headers);
    if (!tableType) return;
    const fixedMap = buildFixedMap(headers, tableType);
    const status = tableType === TABLE_TYPE.subscribing ? 'subscribing' : 'recentListed';
    const items = extractFromRows($, $(table), status, fixedMap, true);
    console.log(`[etnet/ipoList][debug] table#${tableIdx + 1} type=${tableType} items=${items.length}`);
    if (items.length > 0) {
      debugItems.push(...items);
    }
  });

  const clean = uniqByCode(debugItems)
    .map(item => ({
      code: item.code,
      name: item.name,
      listingDate: item.listingDate,
      lotSize: item.lotSize,
    }))
    .filter(item => item.code && item.name && item.lotSize && item.listingDate)
    .slice(0, 5);

  console.log('[etnet/ipoList][debug] sample(>=5 expected)=', clean);
  return clean;
}

module.exports = {
  crawlIPOListFromETNet,
  debugRun,
};
