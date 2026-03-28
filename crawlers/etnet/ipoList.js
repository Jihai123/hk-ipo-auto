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
const RECENT_LIST_LIMIT = 30;
const TOP_CARD_BROKERS = ['耀才', '輝立', '辉立', '富途'];
const IPO_DEBUG_CODES = process.env.IPO_DEBUG_CODES === '1';

const TABLE_TYPE = {
  subscribing: 'subscribing',
  listingSoon: 'listingSoon',
  recentListed: 'recentListed',
};

const SECTION_KEYWORDS = {
  subscribing: ['招股中'],
  listingSoon: ['即將上市', '即将上市', '明掛上市', '明挂上市'],
  recentListed: ['新股消息', '新股資訊', '新股信息'],
  topCards: ['昨上市', '今日上市', '暗盤', '暗盘'],
};

const TABLE_HEADER_KEYWORDS = {
  subscribing: ['招股中', '招股價', '招股截止日', '上市日期'],
  listingSoon: ['即將上市', '上市日期', '每手', '入場費'],
  recentListed: ['新股消息', '上市日期', '認購倍數', '一手中籤率'],
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

function parseRowByFlexibleMap(columns = [], map = {}) {
  return {
    code: getByIndex(columns, map.code)?.match(/\d{4,5}/)?.[0] || null,
    name: getPrimaryText(getByIndex(columns, map.name) || ''),
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
    entryFee: getByIndex(columns, map.entryFee),
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

function normalizeListingSoonItem(item) {
  const code = normalizeCode(item.code);
  const name = sanitizeName(item.name);
  if (!code || !name) return null;

  return {
    code,
    name,
    status: STATUS_MAP.listingSoon,
    listingDate: normalizeDateOrRaw(item.listingDate),
    currency: String(item.currency || '').trim() || null,
    lotSize: parseLotSize(item.lotSize),
    lotAmount: parseLotAmount(item.entryFee || item.lotAmount),
    offerEndDate: normalizeDateOrRaw(item.offerEndDate),
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
    lotAmount: parseLotAmount(item.lotAmount),
  };
}

function normalizeTopCardItem(item) {
  const code = normalizeCode(item.code);
  const name = sanitizeName(item.name);
  if (!code || !name) return null;

  return {
    code,
    name,
    status: STATUS_MAP.recentListed,
    listingDate: normalizeDateOrRaw(item.listingDate),
    offerPrice: parseLotAmount(item.price),
    subscriptionMultiple: null,
    allotmentRate: null,
    firstDayChangePct: parsePercentNumber(item.changePercent),
    lotSize: null,
    lotAmount: null,
    source: 'top_card',
  };
}

function normalizeItemByStatus(item, status) {
  if (status === TABLE_TYPE.subscribing) return normalizeSubscribingItem(item);
  if (status === TABLE_TYPE.listingSoon) return normalizeListingSoonItem(item);
  if (status === TABLE_TYPE.recentListed) return normalizeRecentListedItem(item);
  return null;
}

function getHeaderKey(raw = '') {
  return String(raw).replace(/\s+/g, '').replace(/[()（）:：]/g, '').trim();
}

function resolveColumnMap(headerCells = [], status) {
  const keys = headerCells.map(getHeaderKey);
  const findIndex = (patterns = []) => keys.findIndex(k => patterns.some(p => k.includes(p)));

  const map = {
    code: findIndex(['代号', '股票编号', '編號']),
    name: findIndex(['名称', '名稱']),
    listingDate: findIndex(['上市日期']),
    offerEndDate: findIndex(['招股截止', '截止认购', '截止認購']),
    currency: findIndex(['货币', '貨幣']),
    offerPrice: findIndex(['招股价', '上市价', '上市價', '发售价', '發售價']),
    lotSize: findIndex(['每手股数', '每手']),
    lotAmount: findIndex(['入场费', '入場費']),
    subscriptionMultiple: findIndex(['认购倍数', '認購倍數']),
    allotmentRate: findIndex(['一手中签率', '一手中籤率']),
    firstDayChangePct: findIndex(['首日升跌', '累计升跌', '累計升跌']),
    entryFee: findIndex(['入场费', '入場費']),
  };

  if (map.code < 0) map.code = 0;
  if (map.name < 0) map.name = 1;

  if (status === TABLE_TYPE.subscribing) {
    if (map.offerEndDate < 0) map.offerEndDate = 3;
    if (map.listingDate < 0) map.listingDate = 4;
    if (map.currency < 0) map.currency = 5;
    if (map.offerPrice < 0) map.offerPrice = 6;
    if (map.lotSize < 0) map.lotSize = 7;
    if (map.lotAmount < 0) map.lotAmount = 8;
  }

  if (status === TABLE_TYPE.listingSoon) {
    if (map.listingDate < 0) map.listingDate = 2;
    if (map.currency < 0) map.currency = 3;
    if (map.lotSize < 0) map.lotSize = 5;
    if (map.entryFee < 0) map.entryFee = map.lotAmount >= 0 ? map.lotAmount : 6;
  }

  if (status === TABLE_TYPE.recentListed) {
    if (map.listingDate < 0) map.listingDate = 2;
    if (map.offerPrice < 0) map.offerPrice = 4;
    if (map.subscriptionMultiple < 0) map.subscriptionMultiple = 5;
    if (map.allotmentRate < 0) map.allotmentRate = 7;
    if (map.firstDayChangePct < 0) map.firstDayChangePct = 10;
  }

  return map;
}

function findSectionByTitle($, keywords = []) {
  if (!keywords.length) return null;

  const nodes = $('h1,h2,h3,h4,h5,strong,b,th,td,div,span,a').filter((_, el) => {
    const text = $(el).text().replace(/\s+/g, '').trim();
    if (!text || text.length > 30) return false;
    return keywords.some(k => text.includes(k));
  });

  if (!nodes.length) return null;
  return nodes.first();
}

function findNextTableFromSection($, sectionNode) {
  if (!sectionNode || !sectionNode.length) return null;

  const selfTable = sectionNode.is('table') ? sectionNode : sectionNode.find('table').first();
  if (selfTable && selfTable.length) return selfTable;

  const nextTable = sectionNode.nextAll('table').first();
  if (nextTable && nextTable.length) return nextTable;

  let parent = sectionNode.parent();
  for (let i = 0; i < 5 && parent && parent.length; i += 1) {
    const pNextTable = parent.nextAll('table').first();
    if (pNextTable && pNextTable.length) return pNextTable;
    const pTable = parent.find('table').first();
    if (pTable && pTable.length) return pTable;
    parent = parent.parent();
  }

  return null;
}

function findTableByHeaderKeywords($, keywords = []) {
  const tables = $('table');
  let matched = null;

  tables.each((_, table) => {
    if (matched) return;
    const text = $(table).text().replace(/\s+/g, '');
    if (keywords.some(k => text.includes(k))) {
      matched = $(table);
    }
  });

  return matched;
}

function parseTableRowsByStatus($, tableNode, status, debug = false) {
  if (!tableNode || !tableNode.length) return [];

  const rows = tableNode.find('tr');
  if (!rows.length) return [];

  const headerCells = rows.first().find('th,td').map((i, td) => $(td).text()).get();
  const map = resolveColumnMap(headerCells, status);
  const list = [];

  rows.slice(1).each((rowIndex, row) => {
    const tds = $(row).find('td');
    if (!tds || tds.length < 2) return;

    const columns = tds.map((i, td) => $(td).text().replace(/\s+/g, ' ').trim()).get();
    const parsedRow = parseRowByFlexibleMap(columns, map);
    const normalized = normalizeItemByStatus(parsedRow, status);

    if (debug) {
      console.log(`[ipoList][debug][${status}] row#${rowIndex + 1} raw=`, columns);
      console.log(`[ipoList][debug][${status}] row#${rowIndex + 1} parsed=`, normalized);
    }

    if (normalized) list.push(normalized);
  });

  return list;
}

function parseSectionTable($, status, debug = false) {
  const sectionKeywords = SECTION_KEYWORDS[status] || [];
  const headerKeywords = TABLE_HEADER_KEYWORDS[status] || [];

  const sectionNode = findSectionByTitle($, sectionKeywords);
  const sectionTable = findNextTableFromSection($, sectionNode);

  const table = (sectionTable && sectionTable.length)
    ? sectionTable
    : findTableByHeaderKeywords($, headerKeywords);

  if (!table || !table.length) {
    console.warn(`[etnet/ipoList] 区块定位失败: ${status}`);
    return [];
  }

  return parseTableRowsByStatus($, table, status, debug);
}

function extractNameNearCode(text = '', code = '') {
  if (!text || !code) return null;
  const idx = text.indexOf(code);
  if (idx < 0) return null;

  const left = text.slice(Math.max(0, idx - 18), idx).replace(/[\d\s()（）/|]+/g, ' ').trim();
  const right = text.slice(idx + code.length, idx + code.length + 24).replace(/[\d\s()（）/|]+/g, ' ').trim();
  return sanitizeName(left || right || '');
}

function parseTopLatestCards($) {
  const list = [];
  const seenBlock = new Set();

  $('div,section,article,tr,td,li').each((_, node) => {
    const text = $(node).text().replace(/\s+/g, ' ').trim();
    if (!text || text.length < 20) return;

    const hasBroker = TOP_CARD_BROKERS.some(k => text.includes(k));
    const hasTopTitle = SECTION_KEYWORDS.topCards.some(k => text.includes(k));
    const codes = text.match(/\b\d{5}\b/g) || [];

    if ((!hasBroker && !hasTopTitle) || !codes.length) return;

    const blockKey = `${codes.join(',')}|${text.slice(0, 80)}`;
    if (seenBlock.has(blockKey)) return;
    seenBlock.add(blockKey);

    const priceMatch = text.match(/(?:現價|成交|报|報|上市價)?\s*([\d]{1,4}(?:\.\d+)?)/);
    const pctMatch = text.match(/([+-]\d+(?:\.\d+)?)\s*%/);
    const dateMatch = text.match(/(\d{4}[\/.-]\d{1,2}[\/.-]\d{1,2})/);

    for (const rawCode of codes) {
      const code = normalizeCode(rawCode);
      const name = extractNameNearCode(text, rawCode);
      if (!code || !name) continue;

      list.push(normalizeTopCardItem({
        code,
        name,
        price: priceMatch ? priceMatch[1] : null,
        changePercent: pctMatch ? pctMatch[1] : null,
        listingDate: dateMatch ? dateMatch[1] : null,
      }));
    }
  });

  return uniqByCode(list.filter(Boolean));
}

function mergeRecentListed(topCards = [], newsTable = []) {
  const map = new Map();

  for (const item of topCards) {
    if (!item?.code) continue;
    map.set(item.code, item);
  }

  for (const item of newsTable) {
    if (!item?.code || map.has(item.code)) continue;
    map.set(item.code, item);
  }

  return Array.from(map.values())
    .sort((a, b) => {
      const aTs = Date.parse(a.listingDate || '') || 0;
      const bTs = Date.parse(b.listingDate || '') || 0;
      return bTs - aTs;
    });
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
    throw new Error(`抓取失败，未拿到页面HTML: ${url}`);
  }

  const $ = cheerio.load(html);
  const result = {
    subscribing: [],
    listingSoon: [],
    recentListed: [],
    source: 'etnet',
    fetchedAt: new Date().toISOString(),
  };

  const subscribing = parseSectionTable($, TABLE_TYPE.subscribing);
  const listingSoon = parseSectionTable($, TABLE_TYPE.listingSoon);
  const newsTableRecent = parseSectionTable($, TABLE_TYPE.recentListed);
  const topCardsRecent = parseTopLatestCards($);

  result.subscribing = uniqByCode(subscribing);
  result.listingSoon = uniqByCode(listingSoon);
  result.recentListed = mergeRecentListed(topCardsRecent, newsTableRecent).slice(0, RECENT_LIST_LIMIT);

  if (IPO_DEBUG_CODES) {
    console.log('[IPO_DEBUG]', {
      listingSoonCodes: result.listingSoon.map(x => x.code),
      topCardsCodes: topCardsRecent.map(x => x.code),
      recentListedCodes: result.recentListed.map(x => x.code),
      listingSoonItems: result.listingSoon.slice(0, 5),
      topCardsItems: topCardsRecent.slice(0, 5),
      recentListedItems: result.recentListed.slice(0, 10),
    });
  }

  const stats = {
    subscribingCount: result.subscribing.length,
    listingSoonCount: result.listingSoon.length,
    recentListedCount: result.recentListed.length,
    topCardsCount: topCardsRecent.length,
  };
  console.log('[IPO]', stats);

  if (result.listingSoon.length === 0 && result.recentListed.length === 0) {
    throw new Error('ETNet解析异常：listingSoon与recentListed均为空，拒绝覆盖缓存');
  }

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
  const subscribing = parseSectionTable($, TABLE_TYPE.subscribing, true);
  const listingSoon = parseSectionTable($, TABLE_TYPE.listingSoon, true);
  const recent = parseSectionTable($, TABLE_TYPE.recentListed, true);
  const topCards = parseTopLatestCards($);

  const debugItems = [
    ...subscribing,
    ...listingSoon,
    ...mergeRecentListed(topCards, recent),
  ];

  const clean = uniqByCode(debugItems)
    .map(item => ({
      code: item.code,
      name: item.name,
      status: item.status,
      listingDate: item.listingDate,
      lotSize: item.lotSize,
      source: item.source || 'table',
    }))
    .slice(0, 20);

  console.log('[etnet/ipoList][debug] sample=', clean);
  return clean;
}

module.exports = {
  crawlIPOListFromETNet,
  debugRun,
};
