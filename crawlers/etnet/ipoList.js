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
const IPO_DEBUG_CODES = process.env.IPO_DEBUG_CODES === '1';

const TABLE_TYPE = {
  subscribing: 'subscribing',
  listingSoon: 'listingSoon',
  recentListed: 'recentListed',
};

const SECTION_KEYWORDS = {
  subscribing: ['招股中'],
  listingSoon: ['即將上市', '即将上市'],
  newsRecent: ['新股消息', '新股資訊', '新股信息'],
  greyMarketRecent: ['暗盤', '暗盘', '昨上市', '今日上市'],
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
    .replace(/\d+\s*日[後后]上市.*$/g, '')
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

function normalizeItemByStatus(item, status) {
  if (status === TABLE_TYPE.subscribing) return normalizeSubscribingItem(item);
  if (status === TABLE_TYPE.listingSoon) return normalizeListingSoonItem(item);
  if (status === TABLE_TYPE.recentListed) return normalizeRecentListedItem(item);
  return null;
}

function getHeaderKey(raw = '') {
  return String(raw).replace(/\s+/g, '').replace(/[()（）:：]/g, '').trim();
}

function findHeaderIndex(keys = [], patterns = []) {
  return keys.findIndex(k => patterns.some(p => k.includes(p)));
}

function collectTables($) {
  const tables = [];
  $('table').each((index, table) => {
    const $table = $(table);
    const headerCells = $table.find('tr').first().find('th,td').map((_, td) => $(td).text()).get();
    const headers = headerCells.map(getHeaderKey).filter(Boolean);
    const nearbyTitleText = getNearbyTitleText($, $table);
    tables.push({ tableIndex: index, tableNode: $table, headers, nearbyTitleText });
  });
  return tables;
}

function getNearbyTitleText($, $table) {
  const collect = [];
  const prevSiblings = $table.prevAll('h1,h2,h3,h4,h5,strong,b,div,span,p,td,th').slice(0, 8);
  prevSiblings.each((_, el) => {
    const text = $(el).text().replace(/\s+/g, '').trim();
    if (text && text.length <= 30) collect.push(text);
  });

  let parent = $table.parent();
  for (let i = 0; i < 3 && parent && parent.length; i += 1) {
    const pText = parent.prevAll('h1,h2,h3,h4,h5,strong,b,div,span,p,td,th').first().text();
    const text = String(pText || '').replace(/\s+/g, '').trim();
    if (text && text.length <= 30) collect.push(text);
    parent = parent.parent();
  }
  return collect.join('|');
}

function includesAll(text, keywords = []) {
  return keywords.every(k => text.includes(k));
}

function includesAny(text, keywords = []) {
  return keywords.some(k => text.includes(k));
}

function matchTableType(headers = [], nearbyTitleText = '') {
  const mergedHeader = headers.join('|');
  const titleText = String(nearbyTitleText || '');
  const reason = [];

  const isSubscribing = includesAll(mergedHeader, ['代号', '名称', '招股书', '截止认购日', '上市日期']);
  if (isSubscribing) return { type: TABLE_TYPE.subscribing, reason: 'headers:代号/名称/招股书/截止认购日/上市日期' };

  const newsRecentMust = includesAll(mergedHeader, ['代号', '名称', '上市日期', '首日开市价', '按盘价', '累积升跌']);
  if (newsRecentMust) return { type: TABLE_TYPE.recentListed, reason: 'headers:新股信息结构命中' };

  const greyMust = includesAll(mergedHeader, ['代号', '名称', '上市日期', '货币', '上市价', '每手股数', '入场费']);
  const greyTitle = includesAny(titleText, SECTION_KEYWORDS.greyMarketRecent);
  if (greyMust && greyTitle) {
    return { type: 'greyMarketRecent', reason: 'headers + nearbyTitleText: 暗盘/昨上市/今日上市结构命中' };
  }

  const listingSoonMust = includesAll(mergedHeader, ['代号', '名称', '上市日期', '货币', '每手股数'])
    && (mergedHeader.includes('上市价') || mergedHeader.includes('上市价#'));
  const listingSoonExclude = includesAny(mergedHeader, ['首日开市价', '按盘价', '累积升跌']);
  if (listingSoonMust && !listingSoonExclude) {
    return { type: TABLE_TYPE.listingSoon, reason: 'headers:即将上市结构命中且未命中新股信息特征列' };
  }

  if (includesAny(titleText, SECTION_KEYWORDS.greyMarketRecent)) reason.push('titleLikeGreyMarket');
  return { type: null, reason: reason.join(',') || 'unmatched' };
}

function resolveColumnMapByHeaders(headers = []) {
  return {
    code: findHeaderIndex(headers, ['代号', '股票编号', '編號']),
    name: findHeaderIndex(headers, ['名称', '名稱']),
    listingDate: findHeaderIndex(headers, ['上市日期']),
    offerEndDate: findHeaderIndex(headers, ['截止认购日', '截止認購日', '截止认购', '截止認購']),
    currency: findHeaderIndex(headers, ['货币', '貨幣']),
    offerPrice: findHeaderIndex(headers, ['招股价', '招股價', '上市价', '上市價', '上市价#', '發售價', '发售价']),
    lotSize: findHeaderIndex(headers, ['每手股数']),
    lotAmount: findHeaderIndex(headers, ['入场费', '入場費']),
    subscriptionMultiple: findHeaderIndex(headers, ['认购倍数', '認購倍數']),
    allotmentRate: findHeaderIndex(headers, ['一手中签率', '一手中籤率']),
    firstDayChangePct: findHeaderIndex(headers, ['首日升跌', '累积升跌', '累計升跌']),
  };
}

function getCol(columns, index) {
  if (index < 0 || index >= columns.length) return null;
  return columns[index] || null;
}

function isNoDataTable($, $table) {
  const text = $table.text().replace(/\s+/g, '');
  return text.includes('没有相关资料') || text.includes('沒有相關資料');
}

function parseTableByMap($, $table, map, status, opts = {}) {
  const list = [];
  $table.find('tr').slice(1).each((_, row) => {
    const cols = $(row).find('td').map((__, td) => $(td).text().replace(/\s+/g, ' ').trim()).get();
    if (!cols.length) return;

    const codeRaw = getCol(cols, map.code) || '';
    const codeMatch = codeRaw.match(/\b\d{5}\b/);
    if (!codeMatch) return;

    const nameRaw = getCol(cols, map.name) || '';
    const parsed = {
      code: codeMatch[0],
      name: sanitizeName(nameRaw),
      listingDate: getCol(cols, map.listingDate),
      offerEndDate: getCol(cols, map.offerEndDate),
      currency: getCol(cols, map.currency),
      offerPriceRaw: getCol(cols, map.offerPrice),
      offerPrice: getCol(cols, map.offerPrice),
      lotSize: getCol(cols, map.lotSize),
      lotAmount: getCol(cols, map.lotAmount),
      subscriptionMultiple: getCol(cols, map.subscriptionMultiple),
      allotmentRate: getCol(cols, map.allotmentRate),
      firstDayChangePct: getCol(cols, map.firstDayChangePct),
      entryFee: getCol(cols, map.lotAmount),
    };

    const normalized = normalizeItemByStatus(parsed, status);
    if (!normalized) return;

    if (opts.keepOfferPriceRaw === true) {
      normalized.offerPrice = parsed.offerPriceRaw && parsed.offerPriceRaw !== '--'
        ? parseLotAmount(parsed.offerPriceRaw)
        : null;
      normalized.offerPriceRange = parsed.offerPriceRaw && parsed.offerPriceRaw !== '--'
        ? String(parsed.offerPriceRaw).trim()
        : null;
    }
    list.push(normalized);
  });
  return list;
}

function validateItem(item = {}, mode = 'common') {
  if (!item || !/^\d{5}$/.test(item.code || '')) return null;
  if (!item.name || item.name.length < 2) return null;
  if (item.name.length === 1) return null;
  if (/^[-—]+$/.test(item.name)) return null;
  const clean = { ...item, listingDate: normalizeDateOrRaw(item.listingDate) };

  if (mode === 'listingSoon') {
    if (clean.offerPrice != null && !Number.isFinite(clean.offerPrice)) clean.offerPrice = null;
  }
  return clean;
}

function parseSubscribingTable($, tableInfo) {
  if (!tableInfo || !tableInfo.tableNode || isNoDataTable($, tableInfo.tableNode)) return [];
  const map = resolveColumnMapByHeaders(tableInfo.headers);
  const parsed = parseTableByMap($, tableInfo.tableNode, map, TABLE_TYPE.subscribing);
  return parsed.map(item => validateItem(item, 'subscribing')).filter(Boolean);
}

function parseListingSoonTable($, tableInfo) {
  if (!tableInfo || !tableInfo.tableNode || isNoDataTable($, tableInfo.tableNode)) return [];
  const map = resolveColumnMapByHeaders(tableInfo.headers);
  const parsed = parseTableByMap($, tableInfo.tableNode, map, TABLE_TYPE.listingSoon, { keepOfferPriceRaw: true });
  return parsed.map(item => validateItem(item, 'listingSoon')).filter(Boolean);
}

function parseNewsRecentTable($, tableInfo) {
  if (!tableInfo || !tableInfo.tableNode || isNoDataTable($, tableInfo.tableNode)) return [];
  const map = resolveColumnMapByHeaders(tableInfo.headers);
  const parsed = parseTableByMap($, tableInfo.tableNode, map, TABLE_TYPE.recentListed);
  return parsed.map(item => validateItem(item, 'recent')).filter(Boolean);
}

function parseGreyMarketRecentTable($, tableInfo) {
  if (!tableInfo || !tableInfo.tableNode || isNoDataTable($, tableInfo.tableNode)) return [];
  const map = resolveColumnMapByHeaders(tableInfo.headers);
  const parsed = parseTableByMap($, tableInfo.tableNode, map, TABLE_TYPE.listingSoon, { keepOfferPriceRaw: true });
  const converted = parsed.map(item => ({
    ...item,
    status: STATUS_MAP.recentListed,
  }));
  return converted.map(item => validateItem(item, 'recent')).filter(Boolean);
}

function mergeRecentListed(greyMarketRecent = [], newsTable = []) {
  const map = new Map();

  for (const item of greyMarketRecent) {
    if (!item?.code) continue;
    map.set(item.code, item);
  }

  for (const item of newsTable) {
    if (!item?.code) continue;
    if (!map.has(item.code)) {
      map.set(item.code, item);
      continue;
    }

    const existing = map.get(item.code);
    map.set(item.code, {
      ...item,
      ...existing,
      subscriptionMultiple: existing.subscriptionMultiple || item.subscriptionMultiple || null,
      allotmentRate: existing.allotmentRate || item.allotmentRate || null,
      firstDayChangePct: existing.firstDayChangePct || item.firstDayChangePct || null,
      offerPrice: existing.offerPrice || item.offerPrice || null,
      lotSize: existing.lotSize || item.lotSize || null,
      lotAmount: existing.lotAmount || item.lotAmount || null,
    });
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

  const tables = collectTables($);
  const matched = {
    subscribing: null,
    listingSoon: null,
    newsRecent: null,
    greyMarketRecent: null,
  };

  for (const table of tables) {
    const matchedType = matchTableType(table.headers, table.nearbyTitleText);
    if (!matchedType.type) continue;
    if (matchedType.type === TABLE_TYPE.subscribing && !matched.subscribing) matched.subscribing = { ...table, reason: matchedType.reason };
    if (matchedType.type === TABLE_TYPE.listingSoon && !matched.listingSoon) matched.listingSoon = { ...table, reason: matchedType.reason };
    if (matchedType.type === TABLE_TYPE.recentListed && !matched.newsRecent) matched.newsRecent = { ...table, reason: matchedType.reason };
    if (matchedType.type === 'greyMarketRecent' && !matched.greyMarketRecent) matched.greyMarketRecent = { ...table, reason: matchedType.reason };
  }

  const subscribing = parseSubscribingTable($, matched.subscribing);
  const listingSoon = parseListingSoonTable($, matched.listingSoon);
  const newsRecent = parseNewsRecentTable($, matched.newsRecent);
  const greyMarketRecent = parseGreyMarketRecentTable($, matched.greyMarketRecent);

  result.subscribing = uniqByCode(subscribing);
  result.listingSoon = uniqByCode(listingSoon);
  result.recentListed = mergeRecentListed(greyMarketRecent, newsRecent).slice(0, RECENT_LIST_LIMIT);

  if (IPO_DEBUG_CODES) {
    console.log('[IPO_DEBUG]', {
      subscribingTableMatched: matched.subscribing ? {
        headers: matched.subscribing.headers,
        nearbyTitleText: matched.subscribing.nearbyTitleText,
        reason: matched.subscribing.reason,
      } : null,
      listingSoonTableMatched: matched.listingSoon ? {
        headers: matched.listingSoon.headers,
        nearbyTitleText: matched.listingSoon.nearbyTitleText,
        reason: matched.listingSoon.reason,
      } : null,
      newsRecentTableMatched: matched.newsRecent ? {
        headers: matched.newsRecent.headers,
        nearbyTitleText: matched.newsRecent.nearbyTitleText,
        reason: matched.newsRecent.reason,
      } : null,
      greyMarketRecentTableMatched: matched.greyMarketRecent ? {
        headers: matched.greyMarketRecent.headers,
        nearbyTitleText: matched.greyMarketRecent.nearbyTitleText,
        reason: matched.greyMarketRecent.reason,
      } : null,
      subscribingCodes: result.subscribing.map(x => x.code),
      listingSoonCodes: result.listingSoon.map(x => x.code),
      greyMarketRecentCodes: greyMarketRecent.map(x => x.code),
      newsRecentCodes: newsRecent.map(x => x.code),
      recentListedCodes: result.recentListed.map(x => x.code),
      listingSoonFirst3: result.listingSoon.slice(0, 3),
      greyMarketRecentFirst3: greyMarketRecent.slice(0, 3),
      newsRecentFirst3: newsRecent.slice(0, 3),
      recentListedFirst5: result.recentListed.slice(0, 5),
    });
  }

  const stats = {
    subscribingCount: result.subscribing.length,
    listingSoonCount: result.listingSoon.length,
    greyMarketRecentCount: greyMarketRecent.length,
    newsRecentCount: newsRecent.length,
    recentListedCount: result.recentListed.length,
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
  const tables = collectTables($);
  const matched = {
    subscribing: null,
    listingSoon: null,
    newsRecent: null,
    greyMarketRecent: null,
  };

  for (const table of tables) {
    const matchedType = matchTableType(table.headers, table.nearbyTitleText);
    if (!matchedType.type) continue;
    if (matchedType.type === TABLE_TYPE.subscribing && !matched.subscribing) matched.subscribing = table;
    if (matchedType.type === TABLE_TYPE.listingSoon && !matched.listingSoon) matched.listingSoon = table;
    if (matchedType.type === TABLE_TYPE.recentListed && !matched.newsRecent) matched.newsRecent = table;
    if (matchedType.type === 'greyMarketRecent' && !matched.greyMarketRecent) matched.greyMarketRecent = table;
  }

  const subscribing = parseSubscribingTable($, matched.subscribing);
  const listingSoon = parseListingSoonTable($, matched.listingSoon);
  const newsRecent = parseNewsRecentTable($, matched.newsRecent);
  const greyMarketRecent = parseGreyMarketRecentTable($, matched.greyMarketRecent);

  const debugItems = [
    ...subscribing,
    ...listingSoon,
    ...mergeRecentListed(greyMarketRecent, newsRecent),
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
