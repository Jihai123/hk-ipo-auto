/**
 * etnet IPO列表页爬虫（ci_ipo.php）
 * 本次重构重点：6个模块独立识别 + 独立解析 + 标准化输出
 */

const axios = require('axios');
const cheerio = require('cheerio');
const cfg = require('./config');

const RECENT_LIST_LIMIT = 30;
const IPO_DEBUG_CODES = process.env.IPO_DEBUG_CODES === '1';

const TABLE_TYPE = {
  todayGreyMarket: 'todayGreyMarket',
  todayListed: 'todayListed',
  subscribing: 'subscribing',
  listingSoon: 'listingSoon',
  hearingPassed: 'hearingPassed',
  recentNewStocks: 'recentNewStocks',
};

const REQUIRED_LISTING_DATE_MODULES = new Set([
  TABLE_TYPE.todayGreyMarket,
  TABLE_TYPE.todayListed,
  TABLE_TYPE.subscribing,
  TABLE_TYPE.listingSoon,
  TABLE_TYPE.hearingPassed,
  TABLE_TYPE.recentNewStocks,
]);

const HEADER_ALIASES = {
  code: ['代号', '編號', '编号', '股份代号', '股票编号', '股票代号'],
  name: ['名称', '名稱', '股份名称', '公司名称', '公司'],
  listingDate: ['上市日期', '挂牌日期', '掛牌日期', '预期上市日期'],
  offerEndDate: ['截止日期', '截止认购日', '截止認購日', '招股截止', '认购截止', '認購截止'],
  currency: ['货币', '貨幣', '币别', '幣別'],
  offerPrice: ['上市价', '上市價', '招股价', '招股價', '发售价', '發售價', '定价', '定價'],
  lotSize: ['每手股数', '每手', '每手股數', 'lotsize', 'lotsize'],
  entryFee: ['入场费', '入場費', '每手入场费', '每手入場費', 'lotamount', '每手金额'],
  subscriptionMultiple: ['认购倍数', '認購倍數', '超额认购', '超額認購'],
  allotmentRate: ['一手中签率', '一手中籤率', '中签率', '中籤率', '分配比率'],
  firstDayOpen: ['首日开市价', '首日開市價', '开市价', '開市價', '开盘价', '開盤價'],
  firstDayClose: ['按盘价', '按盤價', '收盘价', '收盤價', '现价', '現價'],
  firstDayChangePct: ['首日升跌', '累积升跌', '累計升跌', '首日表现', '首日表現'],
  lotProfit: ['一手收益', '每手收益', '每手赚蚀', '每手賺蝕', '每手盈利'],
  statusText: ['状态', '狀態', '备注', '備註'],
};

function normalizeHeaderKey(raw = '') {
  return String(raw)
    .replace(/\s+/g, '')
    .replace(/[()（）:：]/g, '')
    .replace(/號/g, '号')
    .replace(/稱/g, '称')
    .replace(/幣/g, '币')
    .replace(/價/g, '价')
    .replace(/數/g, '数')
    .replace(/場/g, '场')
    .replace(/認購/g, '认购')
    .replace(/籤/g, '签')
    .replace(/盤/g, '盘')
    .replace(/開/g, '开')
    .replace(/掛/g, '挂')
    .replace(/累計/g, '累积')
    .replace(/資訊/g, '信息')
    .replace(/聆訊/g, '聆讯')
    .trim()
    .toLowerCase();
}

function normalizeCode(raw = '') {
  const m = String(raw).match(/(\d{4,5})/);
  if (!m) return null;
  return m[1].padStart(5, '0');
}

function normalizeDate(raw = '') {
  const text = String(raw).trim();
  if (!text) return null;

  const ymd = text.match(/(\d{4})[\/.\-年](\d{1,2})[\/.\-月](\d{1,2})/);
  if (ymd) return `${ymd[1]}-${ymd[2].padStart(2, '0')}-${ymd[3].padStart(2, '0')}`;

  const dmy = text.match(/(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;

  return null;
}

function normalizeDateOrRaw(raw = '') {
  const normalized = normalizeDate(raw);
  if (normalized) return normalized;
  const text = String(raw).trim();
  return text || null;
}

function parseNumeric(raw = '') {
  const text = String(raw).replace(/,/g, '').trim();
  const m = text.match(/([+-]?\d+(?:\.\d+)?)/);
  if (!m) return null;
  const v = parseFloat(m[1]);
  return Number.isFinite(v) ? v : null;
}

function parsePercent(raw = '') {
  return parseNumeric(raw);
}

function parseLotSize(raw = '') {
  const text = String(raw).replace(/,/g, '').trim();
  const m = text.match(/(\d{1,9})/);
  if (!m) return null;
  const v = parseInt(m[1], 10);
  return Number.isFinite(v) ? v : null;
}

function parseOfferPrice(raw = '') {
  const text = String(raw).trim();
  if (!text || text === '--') return { offerPrice: null, offerPriceRange: null };
  const nums = (text.match(/[\d.]+/g) || []).map(Number).filter(Number.isFinite);
  if (nums.length === 0) return { offerPrice: null, offerPriceRange: text };
  if (nums.length === 1) return { offerPrice: nums[0], offerPriceRange: null };
  return { offerPrice: null, offerPriceRange: `${nums[0]}-${nums[nums.length - 1]}` };
}

function isNullLike(value) {
  const text = String(value ?? '').trim().toLowerCase();
  return !text || text === 'null' || text === '--' || text === 'n/a';
}

function extractNameStatus(raw = '') {
  const text = String(raw).replace(/\s+/g, ' ').trim();
  if (!text) return { name: null, statusText: null };

  const statusTerms = ['今日上市', '明天上市', '明日上市', '今日暗盘', '暗盘', '暗盤'];
  const hits = statusTerms.filter(term => text.includes(term));
  const statusText = hits.length ? hits.join('/') : null;

  const cleaned = text
    .replace(/\([^)]*\d{4,5}[^)]*\)/g, ' ')
    .replace(/\d{4,5}/g, ' ')
    .replace(/今日上市|明天上市|明日上市|今日暗盘|暗盘|暗盤/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (isNullLike(cleaned)) return { name: null, statusText };
  return { name: cleaned, statusText };
}

function includesAny(text, keywords = []) {
  return keywords.some(k => text.includes(normalizeHeaderKey(k)));
}

function findHeaderIndex(headers = [], aliases = []) {
  return headers.findIndex(h => aliases.some(alias => h.includes(normalizeHeaderKey(alias))));
}

function resolveColumnMap(headers = []) {
  return {
    code: findHeaderIndex(headers, HEADER_ALIASES.code),
    name: findHeaderIndex(headers, HEADER_ALIASES.name),
    listingDate: findHeaderIndex(headers, HEADER_ALIASES.listingDate),
    offerEndDate: findHeaderIndex(headers, HEADER_ALIASES.offerEndDate),
    currency: findHeaderIndex(headers, HEADER_ALIASES.currency),
    offerPrice: findHeaderIndex(headers, HEADER_ALIASES.offerPrice),
    lotSize: findHeaderIndex(headers, HEADER_ALIASES.lotSize),
    entryFee: findHeaderIndex(headers, HEADER_ALIASES.entryFee),
    subscriptionMultiple: findHeaderIndex(headers, HEADER_ALIASES.subscriptionMultiple),
    allotmentRate: findHeaderIndex(headers, HEADER_ALIASES.allotmentRate),
    firstDayOpen: findHeaderIndex(headers, HEADER_ALIASES.firstDayOpen),
    firstDayClose: findHeaderIndex(headers, HEADER_ALIASES.firstDayClose),
    firstDayChangePct: findHeaderIndex(headers, HEADER_ALIASES.firstDayChangePct),
    lotProfit: findHeaderIndex(headers, HEADER_ALIASES.lotProfit),
    statusText: findHeaderIndex(headers, HEADER_ALIASES.statusText),
  };
}

function getNearbyTitleText($, $table) {
  const pool = [];
  const prev = $table.prevAll('h1,h2,h3,h4,h5,strong,b,div,span,p,td,th').slice(0, 10);
  prev.each((_, el) => {
    const t = normalizeHeaderKey($(el).text());
    if (t && t.length <= 40) pool.push(t);
  });
  return pool.join('|');
}

function collectTables($) {
  const tables = [];
  $('table').each((idx, node) => {
    const $table = $(node);
    const rows = $table.find('tr').toArray();
    if (!rows.length) return;

    const headerRow = rows.find(r => $(r).find('th').length > 0) || rows[0];
    const headers = $(headerRow).find('th,td').map((_, td) => normalizeHeaderKey($(td).text())).get().filter(Boolean);

    const dataRows = rows.map(r => $(r).find('td').map((__, td) => $(td).text().replace(/\s+/g, ' ').trim()).get());
    const title = getNearbyTitleText($, $table);
    tables.push({ tableIndex: idx, tableNode: $table, headers, title, dataRows });
  });
  return tables;
}

function matchTableType(table) {
  const headersText = table.headers.join('|');
  const contextText = `${table.title}|${headersText}`;

  if (includesAny(contextText, ['通过聆讯', '申請上市', '申请上市', '聆讯'])) {
    return TABLE_TYPE.hearingPassed;
  }

  if (includesAny(contextText, ['今日暗盘', '今日暗盤', '暗盘'])
    && (includesAny(headersText, ['入场费', '每手']) || includesAny(headersText, ['上市价', '招股价']))) {
    return TABLE_TYPE.todayGreyMarket;
  }

  if (includesAny(contextText, ['今日上市'])
    && (includesAny(headersText, ['首日', '开市价', '按盘价', '累积升跌']) || includesAny(headersText, ['上市日期']))) {
    return TABLE_TYPE.todayListed;
  }

  if (includesAny(contextText, ['招股中', '认购中', '認購中'])
    || (includesAny(headersText, ['截止认购', '招股截止']) && includesAny(headersText, ['上市日期']))) {
    return TABLE_TYPE.subscribing;
  }

  if (includesAny(contextText, ['即将上市', '即將上市'])
    || (includesAny(headersText, ['上市日期']) && includesAny(headersText, ['每手', '上市价']) && !includesAny(headersText, ['累积升跌', '首日']))) {
    return TABLE_TYPE.listingSoon;
  }

  if (includesAny(contextText, ['新股信息', '新股資訊', '新股消息'])
    || (includesAny(headersText, ['首日开市价', '按盘价', '累积升跌']) && includesAny(headersText, ['上市日期']))) {
    return TABLE_TYPE.recentNewStocks;
  }

  return null;
}

function isNoiseRow(cells = []) {
  const rowText = cells.join(' ').replace(/\s+/g, ' ').trim();
  if (!rowText) return true;
  return /沒有相關資料|没有相关资料|只供参考|更新时间|免责声明|備註|备注|資料來源/.test(rowText);
}

function getCell(cells, idx) {
  if (typeof idx !== 'number' || idx < 0 || idx >= cells.length) return null;
  return cells[idx];
}

function normalizeByModule(moduleType, raw, filterStats) {
  const code = normalizeCode(raw.code);
  const { name, statusText: parsedStatus } = extractNameStatus(raw.name);
  const listingDate = normalizeDateOrRaw(raw.listingDate);

  if (!code) {
    filterStats.invalidCode += 1;
    return null;
  }
  if (!name) {
    filterStats.invalidName += 1;
    return null;
  }
  if (REQUIRED_LISTING_DATE_MODULES.has(moduleType) && isNullLike(listingDate)) {
    filterStats.invalidListingDate += 1;
    return null;
  }

  const offer = parseOfferPrice(raw.offerPrice);
  const common = {
    code,
    name,
    listingDate,
    currency: isNullLike(raw.currency) ? null : String(raw.currency).trim(),
    offerPrice: offer.offerPrice,
    boardLot: parseLotSize(raw.lotSize),
    entryFee: parseNumeric(raw.entryFee),
  };

  if (moduleType === TABLE_TYPE.todayGreyMarket) {
    return {
      ...common,
      statusText: raw.statusText || parsedStatus || '暗盘/待上市',
    };
  }

  if (moduleType === TABLE_TYPE.todayListed) {
    return {
      ...common,
      subscriptionMultiple: parseNumeric(raw.subscriptionMultiple),
      allotmentRate: parsePercent(raw.allotmentRate),
      firstDayOpen: parseNumeric(raw.firstDayOpen),
      firstDayClose: parseNumeric(raw.firstDayClose),
      firstDayChangePct: parsePercent(raw.firstDayChangePct),
      lotProfit: parseNumeric(raw.lotProfit),
    };
  }

  if (moduleType === TABLE_TYPE.subscribing) {
    return {
      ...common,
      offerPriceRange: offer.offerPriceRange || (isNullLike(raw.offerPrice) ? null : String(raw.offerPrice).trim()),
      lotSize: parseLotSize(raw.lotSize),
      lotAmount: parseNumeric(raw.entryFee),
      offerEndDate: normalizeDateOrRaw(raw.offerEndDate),
    };
  }

  if (moduleType === TABLE_TYPE.listingSoon) {
    return {
      ...common,
      offerEndDate: normalizeDateOrRaw(raw.offerEndDate),
    };
  }

  if (moduleType === TABLE_TYPE.hearingPassed) {
    return {
      code,
      name,
      listingDate,
      statusText: raw.statusText || parsedStatus || '通过聆讯',
    };
  }

  if (moduleType === TABLE_TYPE.recentNewStocks) {
    return {
      ...common,
      subscriptionMultiple: parseNumeric(raw.subscriptionMultiple),
      allotmentRate: parsePercent(raw.allotmentRate),
      firstDayOpen: parseNumeric(raw.firstDayOpen),
      firstDayClose: parseNumeric(raw.firstDayClose),
      firstDayChangePct: parsePercent(raw.firstDayChangePct),
      lotProfit: parseNumeric(raw.lotProfit),
    };
  }

  return null;
}

function parseModuleTable(tableInfo, moduleType) {
  if (!tableInfo || !tableInfo.dataRows?.length) return { records: [], filterStats: null };

  const map = resolveColumnMap(tableInfo.headers);
  const filterStats = {
    module: moduleType,
    totalRows: 0,
    invalidCode: 0,
    invalidName: 0,
    invalidListingDate: 0,
    obviousNoiseRow: 0,
  };

  const list = [];
  for (const cells of tableInfo.dataRows.slice(1)) {
    if (!cells.length) continue;
    filterStats.totalRows += 1;

    if (isNoiseRow(cells)) {
      filterStats.obviousNoiseRow += 1;
      continue;
    }

    const raw = {
      code: getCell(cells, map.code) || cells[0] || null,
      name: getCell(cells, map.name) || cells[1] || null,
      listingDate: getCell(cells, map.listingDate),
      offerEndDate: getCell(cells, map.offerEndDate),
      currency: getCell(cells, map.currency),
      offerPrice: getCell(cells, map.offerPrice),
      lotSize: getCell(cells, map.lotSize),
      entryFee: getCell(cells, map.entryFee),
      subscriptionMultiple: getCell(cells, map.subscriptionMultiple),
      allotmentRate: getCell(cells, map.allotmentRate),
      firstDayOpen: getCell(cells, map.firstDayOpen),
      firstDayClose: getCell(cells, map.firstDayClose),
      firstDayChangePct: getCell(cells, map.firstDayChangePct),
      lotProfit: getCell(cells, map.lotProfit),
      statusText: getCell(cells, map.statusText),
    };

    const normalized = normalizeByModule(moduleType, raw, filterStats);
    if (normalized) list.push(normalized);
  }

  return { records: uniqByCode(list), filterStats };
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
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const res = await axios.get(url, { headers: cfg.headers, timeout: cfg.timeout });
      return res.data;
    } catch (err) {
      console.warn(`[etnet/ipoList] 请求失败(第${attempt}次): ${url} — ${err.message}`);
      if (attempt < retries) await new Promise(r => setTimeout(r, cfg.requestDelay * attempt));
    }
  }
  return null;
}

async function crawlIPOListFromETNet() {
  const url = cfg.baseURL + cfg.urls.ipoList;
  console.log(`[etnet/ipoList] 爬取: ${url}`);

  const html = await fetchWithRetry(url);
  if (!html) throw new Error(`抓取失败，未拿到页面HTML: ${url}`);

  const $ = cheerio.load(html);
  const tables = collectTables($);

  const matched = {
    todayGreyMarket: null,
    todayListed: null,
    subscribing: null,
    listingSoon: null,
    hearingPassed: null,
    recentNewStocks: null,
  };

  for (const table of tables) {
    const type = matchTableType(table);
    if (!type) continue;
    if (!matched[type]) matched[type] = table;
  }

  const parsed = {
    todayGreyMarket: parseModuleTable(matched.todayGreyMarket, TABLE_TYPE.todayGreyMarket),
    todayListed: parseModuleTable(matched.todayListed, TABLE_TYPE.todayListed),
    subscribing: parseModuleTable(matched.subscribing, TABLE_TYPE.subscribing),
    listingSoon: parseModuleTable(matched.listingSoon, TABLE_TYPE.listingSoon),
    hearingPassed: parseModuleTable(matched.hearingPassed, TABLE_TYPE.hearingPassed),
    recentNewStocks: parseModuleTable(matched.recentNewStocks, TABLE_TYPE.recentNewStocks),
  };

  const recentListed = [...parsed.recentNewStocks.records].slice(0, RECENT_LIST_LIMIT).map(item => ({
    ...item,
    status: 'recentListed',
    lotSize: item.boardLot ?? null,
    lotAmount: item.entryFee ?? null,
  }));

  const result = {
    subscribing: parsed.subscribing.records,
    listingSoon: parsed.listingSoon.records,
    recentListed,
    todayGreyMarket: parsed.todayGreyMarket.records,
    todayListed: parsed.todayListed.records,
    hearingPassed: parsed.hearingPassed.records,
    recentNewStocks: parsed.recentNewStocks.records,
    source: 'etnet',
    fetchedAt: new Date().toISOString(),
  };

  const matchedTables = Object.keys(matched).filter(k => matched[k]);
  const filterStats = Object.values(parsed).map(x => x.filterStats).filter(Boolean);

  console.log('[IPO][parser]', {
    matchedTables,
    todayGreyMarketCount: result.todayGreyMarket.length,
    todayListedCount: result.todayListed.length,
    subscribingCount: result.subscribing.length,
    listingSoonCount: result.listingSoon.length,
    hearingPassedCount: result.hearingPassed.length,
    recentNewStocksCount: result.recentNewStocks.length,
    sample: {
      todayGreyMarket: result.todayGreyMarket[0] || null,
      todayListed: result.todayListed[0] || null,
      subscribing: result.subscribing[0] || null,
      listingSoon: result.listingSoon[0] || null,
      hearingPassed: result.hearingPassed[0] || null,
      recentNewStocks: result.recentNewStocks[0] || null,
    },
    filtered: filterStats,
  });

  if (IPO_DEBUG_CODES) {
    console.log('[IPO_DEBUG][match]', matchedTables);
    console.log('[IPO_DEBUG][counts]', {
      todayGreyMarket: result.todayGreyMarket.length,
      todayListed: result.todayListed.length,
      subscribing: result.subscribing.length,
      listingSoon: result.listingSoon.length,
      hearingPassed: result.hearingPassed.length,
      recentNewStocks: result.recentNewStocks.length,
    });
  }

  if (result.listingSoon.length === 0 && result.recentListed.length === 0 && result.subscribing.length === 0) {
    throw new Error('ETNet解析异常：关键模块均为空，拒绝覆盖缓存');
  }

  return result;
}

async function debugRun() {
  const data = await crawlIPOListFromETNet();
  return [
    ...data.subscribing,
    ...data.listingSoon,
    ...data.todayGreyMarket,
    ...data.todayListed,
    ...data.hearingPassed,
    ...data.recentNewStocks,
  ].slice(0, 20);
}

module.exports = {
  crawlIPOListFromETNet,
  debugRun,
};
