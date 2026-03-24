/**
 * etnet IPO详情页爬虫
 * 爬取 ci_ipo_detail.php?code={code}
 * 提取: 行业、市场、发售价、市值、保荐人、上市日期、认购倍数、募资规模等
 */

const axios  = require('axios');
const cheerio = require('cheerio');
const path   = require('path');
const fs     = require('fs');
const cfg    = require('./config');

const SELECTOR_CANDIDATES = [
  'table tr',
  '.sectionTable tr',
  '.tableContent tr',
  'tr',
];

const CACHE_DIR      = path.join(__dirname, '../../cache/etnet');
const CACHE_TTL_MS   = 7 * 24 * 60 * 60 * 1000; // IPO详情缓存7天

// 确保缓存目录存在
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

/**
 * 带重试的 HTTP GET
 */
async function fetchWithRetry(url, retries = cfg.maxRetries) {
  let lastError = null;
  let lastStatus = null;
  let lastHtml = null;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`[etnet/ipoDetail] fetch attempt=${attempt}/${retries} timeout=${cfg.timeout}ms url=${url}`);
      const res = await axios.get(url, {
        headers: cfg.headers,
        timeout: cfg.timeout,
        validateStatus: () => true,
      });

      lastStatus = res.status;
      lastHtml = res.data;

      if (res.status === 200) {
        return {
          html: res.data,
          statusCode: res.status,
          httpError: false,
          error: null,
          attempts: attempt,
          timedOut: false,
        };
      }

      console.warn(`[etnet/ipoDetail] HTTP非200(第${attempt}次): status=${res.status} url=${url}`);
      if (attempt < retries) await new Promise(r => setTimeout(r, cfg.requestDelay * attempt));
    } catch (err) {
      lastError = err;
      const timedOut = err.code === 'ECONNABORTED' || /timeout/i.test(err.message || '');
      console.warn(`[etnet/ipoDetail] 请求失败(第${attempt}次): ${url} — ${err.message}`);
      if (attempt < retries) await new Promise(r => setTimeout(r, cfg.requestDelay * attempt));
      if (timedOut) {
        console.warn(`[etnet/ipoDetail] timeout detected on attempt=${attempt}`);
      }
    }
  }

  if (lastStatus !== null) {
    return {
      html: lastHtml,
      statusCode: lastStatus,
      httpError: true,
      error: null,
      attempts: retries,
      timedOut: false,
    };
  }

  return {
    html: null,
    statusCode: null,
    httpError: false,
    error: lastError,
    attempts: retries,
    timedOut: !!(lastError && (lastError.code === 'ECONNABORTED' || /timeout/i.test(lastError.message || ''))),
  };
}

function collectCandidateRows($) {
  const seen = new Set();
  const rows = [];
  for (const selector of SELECTOR_CANDIDATES) {
    const matched = $(selector).toArray();
    console.log(`[etnet/ipoDetail] selector=${selector} matchedRows=${matched.length}`);
    for (const row of matched) {
      if (seen.has(row)) continue;
      seen.add(row);
      rows.push(row);
    }
  }
  return rows;
}

function cleanCellText(raw) {
  return String(raw || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[：:]\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeLabel(raw) {
  return cleanCellText(raw).replace(/\s+/g, '');
}

function addFieldEvidence(result, field, { label, value, rule }) {
  if (!field || !value) return;
  if (!result._debug.fieldEvidence[field]) {
    result._debug.fieldEvidence[field] = {
      matchedLabel: label || null,
      rawValue: value,
      parserRule: rule,
    };
  }
}

function extractLabelValuePairs($, rows) {
  const pairs = [];
  rows.forEach((row) => {
    const cells = $(row).find('th,td').toArray();
    if (cells.length < 2) return;
    for (let i = 0; i < cells.length - 1; i += 2) {
      const label = normalizeLabel($(cells[i]).text());
      const value = cleanCellText($(cells[i + 1]).text());
      if (label && value) {
        pairs.push({ label, value, rule: `row_pair_${i}->${i + 1}` });
      }
    }

    // 兜底：防止奇数列布局导致错位，至少保留首对
    const firstLabel = normalizeLabel($(cells[0]).text());
    const firstValue = cleanCellText($(cells[1]).text());
    if (firstLabel && firstValue && !pairs.some((p) => p.label === firstLabel && p.value === firstValue)) {
      pairs.push({ label: firstLabel, value: firstValue, rule: 'row_first_two_cells' });
    }
  });
  return pairs;
}

/**
 * 解析发售价字符串，返回中值（港元）
 * 示例: "$42.00 - $48.00" → 45.0
 *       "$106.89"          → 106.89
 */
function parseOfferPrice(raw) {
  if (!raw) return null;
  const nums = (raw.match(/[\d.]+/g) || []).map(Number).filter(n => n > 0);
  if (nums.length === 0) return null;
  if (nums.length === 1) return nums[0];
  // 取区间中值
  return (nums[0] + nums[nums.length - 1]) / 2;
}

/**
 * 解析认购倍数字符串
 * 示例: "707.30倍" → 707.3
 */
function parseMultiple(raw) {
  if (!raw) return null;
  const m = raw.match(/[\d.]+/);
  return m ? parseFloat(m[0]) : null;
}

/**
 * 解析募资金额（尽力提取港元净额）
 * 页面通常显示 "约港币XXXX百万元"
 */
function parseProceeds(raw) {
  if (!raw) return null;
  // 清理万/亿/百万等单位
  const hundredMillion = /约?港币?([\d.]+)亿元?/.exec(raw);
  if (hundredMillion) return Math.round(parseFloat(hundredMillion[1]) * 1e8);
  const million = /约?港币?([\d.]+)百万元?/.exec(raw);
  if (million) return Math.round(parseFloat(million[1]) * 1e6);
  const wan = /约?港币?([\d.]+)万元?/.exec(raw);
  if (wan) return Math.round(parseFloat(wan[1]) * 1e4);
  // 纯数字（元）
  const plain = /[\d,]+/.exec(raw.replace(/,/g, ''));
  if (plain) return parseInt(plain[0].replace(/,/g, ''), 10);
  return null;
}

function parseShares(raw) {
  if (!raw) return null;
  const cleaned = raw.replace(/,/g, '');
  const m = cleaned.match(/([\d.]+)\s*(亿股|億股|millionshares|million|百萬股|百万股|股)?/i);
  if (!m) return null;
  const value = parseFloat(m[1]);
  if (!Number.isFinite(value)) return null;
  const unit = m[2] || '';
  if (/亿股|億股/i.test(unit)) return Math.round(value * 1e8);
  if (/百萬股|百万股|million/i.test(unit)) return Math.round(value * 1e6);
  if (/股/.test(unit) || !unit) return Math.round(value);
  return null;
}

function parsePE(raw) {
  if (!raw) return null;
  const m = raw.match(/[\d.]+/);
  return m ? parseFloat(m[0]) : null;
}

function parseMarketCap(raw) {
  if (!raw) return null;
  const normalized = String(raw).replace(/,/g, '').replace(/\s+/g, '');
  const matchers = [
    { re: /([\d.]+)億元?/i, multiplier: 1e8 },
    { re: /([\d.]+)亿港元?/i, multiplier: 1e8 },
    { re: /([\d.]+)百萬元?/i, multiplier: 1e6 },
    { re: /([\d.]+)百万港元?/i, multiplier: 1e6 },
    { re: /([\d.]+)萬元?/i, multiplier: 1e4 },
    { re: /([\d.]+)万港元?/i, multiplier: 1e4 },
  ];
  for (const { re, multiplier } of matchers) {
    const m = normalized.match(re);
    if (m) {
      const value = Number.parseFloat(m[1]);
      if (Number.isFinite(value)) return Math.round(value * multiplier);
    }
  }
  const plain = normalized.match(/([\d.]+)/);
  if (!plain) return null;
  const value = Number.parseFloat(plain[1]);
  return Number.isFinite(value) ? Math.round(value) : null;
}


function normalizeDateString(raw) {
  if (!raw) return null;
  const t = String(raw).replace(/\s+/g, ' ').trim();
  const m = t.match(/(\d{4})[.\/-年]\s*(\d{1,2})[.\/-月]\s*(\d{1,2})/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function inferStatusByTimeline({ subscriptionEndDate, listingDate }) {
  if (!listingDate) return null;
  const today = new Date().toISOString().slice(0, 10);
  if (subscriptionEndDate && today < subscriptionEndDate) return 'subscribing';
  if (today < listingDate) return 'allotted';
  return 'listed';
}

/**
 * 爬取并解析 etnet IPO详情页
 * @param {string} code - 5位股票代码字符串，如 "06809"
 * @returns {Object} 结构化IPO数据
 */
async function crawlIPODetail(code, { noCache = false } = {}) {
  const cacheFile = path.join(CACHE_DIR, `ipo_${code}.json`);

  // 读取本地缓存（7天内有效）
  if (!noCache && fs.existsSync(cacheFile)) {
    const stat = fs.statSync(cacheFile);
    if (Date.now() - stat.mtimeMs < CACHE_TTL_MS) {
      try {
        const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
        console.log(`[etnet/ipoDetail] 命中缓存: ${code}`);
        return {
          ...cached,
          _dataSource: 'cache',
          _cacheHit: true,
          _fetchStatus: {
            ...(cached._fetchStatus || {}),
            fromCache: true,
          },
        };
      } catch (_) { /* 缓存损坏，重新爬取 */ }
    }
  }

  const url = cfg.baseURL + cfg.urls.ipoDetail(code);
  console.log(`[etnet/ipoDetail] 爬取: ${url}`);

  const fetchResult = await fetchWithRetry(url);
  const html = fetchResult.html;
  if (!html) {
    console.error(`[etnet/ipoDetail] 获取失败: ${code}, attempts=${fetchResult.attempts}, reason=${fetchResult.error ? fetchResult.error.message : 'unknown_error'}`);
    return {
      code,
      _source: 'etnet',
      _dataSource: 'fallback',
      _fetchedAt: new Date().toISOString(),
      _fetchStatus: {
        status: 'network_error',
        reason: fetchResult.error ? fetchResult.error.message : 'unknown_error',
        attempts: fetchResult.attempts || cfg.maxRetries,
        timedOut: !!fetchResult.timedOut,
        httpStatus: fetchResult.statusCode || null,
      },
    };
  }

  const $ = cheerio.load(html);
  const result = {
    code,
    name:                 null,
    status:               null,
    industry:             null,
    market:               null,
    lotSize:              null,
    offerPrice:           null,   // 原始字符串
    offerPriceMid:        null,   // 中值（港元）
    marketCapH:           null,   // H股市值（仅展示，不用于PE计算）
    marketCapUpper:       null,
    marketCapLower:       null,
    marketCapMid:         null,
    sponsors:             [],
    totalOfferingShares:  null,
    listingDate:          null,
    subscriptionMultiple: null,
    allotmentRate:        null,
    firstDayClose:        null,
    ipoProceeds:          null,   // 募资净额（港元）
    totalShares:          null,   // 页面可得的总股本/上市后股份数
    totalSharesRaw:       null,
    sitePE:               null,   // 页面展示PE，仅用于debug
    marketCapRaw:         null,
    _source:              'etnet',
    _dataSource:          'live_http',
    _fetchedAt:           new Date().toISOString(),
    _fetchStatus:         {
      status: fetchResult.httpError ? 'http_error' : 'success',
      reason: fetchResult.httpError ? `HTTP ${fetchResult.statusCode}` : '',
      attempts: fetchResult.attempts || 1,
      timedOut: false,
      httpStatus: fetchResult.statusCode || null,
      fromCache: false,
    },
    _debug:               { selectorCandidates: [], extractedKeys: [] },
  };

  // 遍历页面所有表格行，支持多种表格布局与标签提取方式
  const rows = collectCandidateRows($);
  result._debug.selectorCandidates = SELECTOR_CANDIDATES.map(selector => ({ selector, count: $(selector).length }));
  result._debug.fieldEvidence = {};
  const labelValuePairs = extractLabelValuePairs($, rows);
  result._debug.labelValuePairs = labelValuePairs;

  let subscriptionEndDate = null;

  labelValuePairs.forEach(({ label: key, value: val, rule }) => {
    if (!key || !val) return;

    // 股票名称：仅允许来自详情页 label，缺失时在后续用列表页兜底
    if (/股票名稱|股票名称|公司名稱|公司名称|上市公司/.test(key) && !result.name) {
      result.name = val.replace(/\(\d{4,5}\)|\d{4,5}\.HK/ig, '').trim() || val;
      addFieldEvidence(result, 'name', { label: key, value: val, rule });
    }

    // 仅保留业务允许的 label 语义字段
    if (/行業|行业/.test(key) && !result.industry) {
      result.industry = val;
      addFieldEvidence(result, 'industry', { label: key, value: val, rule });
    }

    if (/買賣單位|买卖单位/.test(key) && !result.lotSize) {
      result.lotSize = parseInt(val.replace(/,/g, ''), 10) || null;
      addFieldEvidence(result, 'lotSize', { label: key, value: val, rule });
    }

    if (/發售價|发售价/.test(key) && !result.offerPrice) {
      result.offerPrice = val;
      result.offerPriceMid = parseOfferPrice(val);
      addFieldEvidence(result, 'offerPriceMid', { label: key, value: val, rule });
    }

    if (/發售股份數目|发售股份数目/.test(key) && !result.totalOfferingShares) {
      result.totalOfferingShares = val;
      result.totalSharesRaw = val;
      result.totalShares = parseShares(val);
      addFieldEvidence(result, 'totalShares', { label: key, value: val, rule });
    }

    if (/上市日期/.test(key) && !result.listingDate) {
      result.listingDate = val;
      addFieldEvidence(result, 'listingDate', { label: key, value: val, rule });
    }

    if (/招股截止|截止認購|截止认购|認購截止|认购截止/.test(key) && !subscriptionEndDate) {
      subscriptionEndDate = normalizeDateString(val);
      addFieldEvidence(result, 'subscriptionEndDate', { label: key, value: val, rule });
    }

    if (/市值/.test(key)) {
      if (!result.marketCapH) result.marketCapH = val;
      if (!result.marketCapRaw) result.marketCapRaw = val;
      addFieldEvidence(result, 'marketCapRaw', { label: key, value: val, rule });
    }
    if (/市值（?上限）?|上限市值/.test(key) && !Number.isFinite(result.marketCapUpper)) {
      result.marketCapUpper = parseMarketCap(val);
      if (!result.marketCapRaw) result.marketCapRaw = val;
      addFieldEvidence(result, 'marketCapUpper', { label: key, value: val, rule });
    }
    if (/市值（?下限）?|下限市值/.test(key) && !Number.isFinite(result.marketCapLower)) {
      result.marketCapLower = parseMarketCap(val);
      if (!result.marketCapRaw) result.marketCapRaw = val;
      addFieldEvidence(result, 'marketCapLower', { label: key, value: val, rule });
    }

    if (/市盈率|pe/i.test(key) && !result.sitePE) {
      result.sitePE = parsePE(val);
    }

    result._debug.extractedKeys.push(`${key}=>${val}`);
  });

  const normalizedListingDate = normalizeDateString(result.listingDate);
  if (normalizedListingDate) {
    result.status = inferStatusByTimeline({
      subscriptionEndDate,
      listingDate: normalizedListingDate,
    });
    addFieldEvidence(result, 'status', {
      label: subscriptionEndDate ? '招股截止+上市日期' : '上市日期',
      value: subscriptionEndDate ? `${subscriptionEndDate} -> ${normalizedListingDate}` : normalizedListingDate,
      rule: subscriptionEndDate ? 'timeline_inference_subscription_end_and_listing_date' : 'timeline_inference_listing_date_only',
    });
  }


  if (Number.isFinite(result.marketCapUpper) && Number.isFinite(result.marketCapLower)) {
    result.marketCapMid = Math.round((result.marketCapUpper + result.marketCapLower) / 2);
  }

  if (!result.offerPriceMid || !result.totalShares || !result.industry) {
    console.warn(`[etnet/ipoDetail] 容错提示: code=${code} missing=${[!result.offerPriceMid && 'offerPriceMid', !result.totalShares && 'totalShares', !result.industry && 'industry'].filter(Boolean).join(',') || 'none'}`);
  }

  // 写入缓存
  try {
    fs.writeFileSync(cacheFile, JSON.stringify(result, null, 2), 'utf-8');
  } catch (_) { /* 写缓存失败不影响返回 */ }

  console.log(`[etnet/ipoDetail] 完成: ${code} industry=${result.industry} offerPriceMid=${result.offerPriceMid}`);
  return result;
}

module.exports = { crawlIPODetail };
