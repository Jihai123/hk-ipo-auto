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
  const m = String(raw).replace(/,/g, '').match(/(\d+)/);
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
    name: item.name || `股票${code}`,
    status: STATUS_MAP[status] || status,
    listingDate: normalizeDate(item.listingDate),
    offerPrice,
    offerPriceRange,
    lotSize: parseLotSize(item.lotSize),
    lotAmount: parseLotAmount(item.lotAmount),
  };
}

function extractFromRows($, rows, status) {
  const list = [];
  rows.each((_, row) => {
    const tds = $(row).find('td');
    if (tds.length < 2) return;

    const columns = tds.map((i, td) => $(td).text().replace(/\s+/g, ' ').trim()).get();
    const code = columns.find(c => /\b\d{4,5}\b/.test(c))?.match(/\d{4,5}/)?.[0] || null;
    const name = columns[1] || columns[0] || null;
    const listingDate = columns.find(c => /\d{4}[\/.\-年]\d{1,2}/.test(c)) || null;
    const priceCol = columns.find(c => /\$|HK\$|港元|\d+\.?\d*\s*[-~]\s*\d+\.?\d*/i.test(c)) || null;
    const lotSizeCol = columns.find(c => /股|手/.test(c) && /\d/.test(c)) || null;
    const lotAmountCol = columns.find(c => /(入场费|一手|认购额|HK\$|\$)/i.test(c) && /\d/.test(c)) || null;

    const normalized = normalizeItem({
      code,
      name,
      listingDate,
      offerPriceRaw: priceCol,
      lotSize: lotSizeCol,
      lotAmount: lotAmountCol,
    }, status);

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
    const items = extractFromRows($, table.find('tr'), status);
    result[status] = result[status].concat(items);
  });

  // 解析策略2：全页兜底（若策略1拿不到）
  if (result.subscribing.length + result.listingSoon.length + result.recentListed.length === 0) {
    const allRows = $('table tr');
    const all = extractFromRows($, allRows, 'subscribing');
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

module.exports = {
  crawlIPOListFromETNet,
};
