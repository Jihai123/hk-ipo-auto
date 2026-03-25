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

function normalizeCode(raw = '') {
  const code = String(raw).replace(/[^0-9]/g, '');
  if (!code) return null;
  return code.padStart(5, '0');
}

function normalizeDate(raw = '') {
  const text = String(raw).trim();
  if (!text) return null;
  const m = text.match(/(\d{4})[\/.\-年](\d{1,2})[\/.\-月](\d{1,2})/);
  if (!m) return text;
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
  if (!code) return null;

  const { offerPrice, offerPriceRange } = parsePriceRange(item.offerPriceRaw || item.offerPrice);

  return {
    code,
    name: sanitizeName(item.name) || `股票${code}`,
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
  const firstSegment = noCode.split(/[|｜\/\n\r]/)[0].split(/\s{2,}/)[0].trim();
  if (!firstSegment) return null;
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

function parseRowByHeader(columns = [], headerIndexes = {}) {
  const byIndex = (key) => {
    const idx = headerIndexes[key];
    if (typeof idx !== 'number' || idx < 0 || idx >= columns.length) return null;
    return columns[idx] || null;
  };

  const codeCandidate = byIndex('code')
    || columns.find(c => /\b\d{4,5}\b/.test(c))
    || null;
  const nameCandidate = byIndex('name')
    || null;
  const listingDateCandidate = byIndex('listingDate')
    || columns.find(c => /\d{4}[\/.\-年]\d{1,2}/.test(c))
    || null;
  const priceCandidate = byIndex('offerPrice')
    || null;
  // lotSize 严格只从「每手股数」列读取，禁止跨列拼接
  const lotSizeCandidate = byIndex('lotSize');
  const lotAmountCandidate = byIndex('lotAmount')
    || null;

  return {
    code: codeCandidate?.match(/\d{4,5}/)?.[0] || null,
    name: getPrimaryText(nameCandidate || ''),
    listingDate: listingDateCandidate,
    offerPriceRaw: priceCandidate,
    lotSize: lotSizeCandidate,
    lotAmount: lotAmountCandidate,
  };
}

function extractFromRows($, table, status, debug = false) {
  const list = [];
  const rows = table.find('tr');
  if (!rows || rows.length === 0) return list;

  const headerRow = rows.first();
  const headers = headerRow.find('th,td').map((_, cell) => normalizeHeader($(cell).text())).get();
  const hasHeader = headers.some(h => /代號|代码|編號|编号|名稱|名称|上市|招股|每手|入場|入场|發售|发售/.test(h));

  const headerIndexes = {
    code: detectColumnIndex(headers, [/代號|代码|編號|编号|股份代號|股份代码|stockcode|code/]),
    name: detectColumnIndex(headers, [/簡稱|简称|名稱|名称|公司|股份|stockname|name/]),
    listingDate: detectColumnIndex(headers, [/上市日|上市日期|挂牌|listing/]),
    offerPrice: detectColumnIndex(headers, [/招股價|招股价|發售價|发售价|定價|定价|price/]),
    lotSize: detectColumnIndex(headers, [/每手股數|每手股数|一手股數|一手股数|每手/]),
    lotAmount: detectColumnIndex(headers, [/入場費|入场费|一手入場|一手入场|min|認購額|认购额/]),
  };

  const dataRows = hasHeader ? rows.slice(1) : rows;
  dataRows.each((rowIndex, row) => {
    const tds = $(row).find('td');
    if (tds.length < 2) return;

    const columns = tds.map((i, td) => $(td).text().replace(/\s+/g, ' ').trim()).get();
    const parsedRow = parseRowByHeader(columns, headerIndexes);
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

  // 解析策略1：按标题附近表格
  $('h1, h2, h3, h4, .title, .section-title, .tb-title').each((_, el) => {
    const title = $(el).text().replace(/\s+/g, '');
    if (!title) return;

    let status = null;
    if (/招股|公开发售|認購中|认购中/.test(title)) status = 'subscribing';
    else if (/待上市|即将上市|上市日程|上市時間表/.test(title)) status = 'listingSoon';
    else if (/近期上市|已上市|最近上市/.test(title)) status = 'recentListed';

    if (!status) return;

    const table = $(el).nextAll('table').first();
    if (!table || table.length === 0) return;
    const items = extractFromRows($, table, status);
    result[status] = result[status].concat(items);
  });

  // 解析策略2：全页兜底（若策略1拿不到）
  if (result.subscribing.length + result.listingSoon.length + result.recentListed.length === 0) {
    const allRows = $('table tr');
    const tempTable = $('<table></table>');
    tempTable.append(allRows.clone());
    const all = extractFromRows($, tempTable, 'subscribing');
    // 克制策略：兜底时默认放入 subscribing，后续由日期归类
    result.subscribing = result.subscribing.concat(all);
  }

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
    const rows = $(table).find('tr');
    if (rows.length === 0) return;
    const items = extractFromRows($, $(table), 'subscribing', true);
    if (items.length > 0) {
      console.log(`[etnet/ipoList][debug] table#${tableIdx + 1} items=${items.length}`);
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
