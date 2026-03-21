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

const CACHE_DIR      = path.join(__dirname, '../../cache/etnet');
const CACHE_TTL_MS   = 7 * 24 * 60 * 60 * 1000; // IPO详情缓存7天

// 确保缓存目录存在
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

/**
 * 带重试的 HTTP GET
 */
async function fetchWithRetry(url, retries = cfg.maxRetries) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await axios.get(url, {
        headers: cfg.headers,
        timeout: cfg.timeout,
      });
      return res.data;
    } catch (err) {
      console.warn(`[etnet/ipoDetail] 请求失败(第${attempt}次): ${url} — ${err.message}`);
      if (attempt < retries) await new Promise(r => setTimeout(r, cfg.requestDelay * attempt));
    }
  }
  return null;
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

/**
 * 爬取并解析 etnet IPO详情页
 * @param {string} code - 5位股票代码字符串，如 "06809"
 * @returns {Object} 结构化IPO数据
 */
async function crawlIPODetail(code) {
  const cacheFile = path.join(CACHE_DIR, `ipo_${code}.json`);

  // 读取本地缓存（7天内有效）
  if (fs.existsSync(cacheFile)) {
    const stat = fs.statSync(cacheFile);
    if (Date.now() - stat.mtimeMs < CACHE_TTL_MS) {
      try {
        const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
        console.log(`[etnet/ipoDetail] 命中缓存: ${code}`);
        return cached;
      } catch (_) { /* 缓存损坏，重新爬取 */ }
    }
  }

  const url = cfg.baseURL + cfg.urls.ipoDetail(code);
  console.log(`[etnet/ipoDetail] 爬取: ${url}`);

  const html = await fetchWithRetry(url);
  if (!html) {
    console.error(`[etnet/ipoDetail] 获取失败: ${code}`);
    return null;
  }

  const $ = cheerio.load(html);
  const result = {
    code,
    industry:             null,
    market:               null,
    lotSize:              null,
    offerPrice:           null,   // 原始字符串
    offerPriceMid:        null,   // 中值（港元）
    marketCapH:           null,   // H股市值（仅展示，不用于PE计算）
    sponsors:             [],
    totalOfferingShares:  null,
    listingDate:          null,
    subscriptionMultiple: null,
    ipoProceeds:          null,   // 募资净额（港元）
    totalShares:          null,   // 页面可得的总股本/上市后股份数
    totalSharesRaw:       null,
    sitePE:               null,   // 页面展示PE，仅用于debug
    marketCapRaw:         null,
    _source:              'etnet',
    _fetchedAt:           new Date().toISOString(),
  };

  // 遍历页面所有表格行，按第一个 td 文本匹配字段
  $('table tr').each((_, row) => {
    const tds  = $(row).find('td');
    if (tds.length < 2) return;
    const key  = $(tds[0]).text().trim().replace(/\s+/g, '');
    const val  = $(tds[1]).text().trim().replace(/\u00a0/g, ' ').trim();

    if (!key || !val) return;

    // 基本资料
    if (/行業|行业/.test(key))              result.industry = val;
    if (/市場|市场/.test(key))              result.market   = val;
    if (/買賣單位|买卖单位/.test(key))      result.lotSize  = parseInt(val.replace(/,/g, ''), 10) || null;

    // 售股统计数字
    if (/發售價|发售价/.test(key)) {
      result.offerPrice    = val;
      result.offerPriceMid = parseOfferPrice(val);
    }
    if (/市值/.test(key)) {
      if (!result.marketCapH) result.marketCapH = val;
      if (!result.marketCapRaw) result.marketCapRaw = val;
    }

    // 全球发售 - 保荐人（可能是多行合并或换行）
    if (/保薦人|保荐人/.test(key)) {
      // 逗号/顿号/及 分隔多个保荐人
      const sponsors = val.split(/[,，、及\n]+/).map(s => s.trim()).filter(Boolean);
      result.sponsors = sponsors;
    }

    // 发售股份总数
    if (/發售股份數目|发售股份数目/.test(key)) result.totalOfferingShares = val;
    if (/上市後已發行股份|上市后已发行股份|已發行股份總數|已发行股份总数|總股本|总股本/.test(key)) {
      result.totalSharesRaw = val;
      result.totalShares = parseShares(val);
    }

    // 时间表
    if (/上市日期/.test(key) && !result.listingDate) result.listingDate = val;

    // 认购结果（配售后才有）
    if (/認購倍數|认购倍数/.test(key)) result.subscriptionMultiple = parseMultiple(val);

    // 募资净额（粗提）
    if (/所得款項凈額|所得款项净额|募集資金|募集资金/.test(key)) {
      result.ipoProceeds = parseProceeds(val);
    }

    if (/市盈率|pe/i.test(key)) {
      result.sitePE = parsePE(val);
    }
  });

  // 写入缓存
  try {
    fs.writeFileSync(cacheFile, JSON.stringify(result, null, 2), 'utf-8');
  } catch (_) { /* 写缓存失败不影响返回 */ }

  console.log(`[etnet/ipoDetail] 完成: ${code} industry=${result.industry} offerPriceMid=${result.offerPriceMid}`);
  return result;
}

module.exports = { crawlIPODetail };
