/**
 * etnet 行业可比PE爬虫
 * 爬取 industry_detail.php?nature={code}&subtype=all
 * 提取所有可比公司的市盈率，计算截尾中位数
 *
 * 过滤规则：
 *   1. PE > 0 且 < 200
 *   2. 排除 -Ｒ 人民币柜台（避免重复计数）
 *   3. 排除 -Ｓ 第二上市
 *   4. 截尾：去掉最高/最低各 10%
 *   5. 取剩余中位数（非均值）
 */

const axios   = require('axios');
const cheerio = require('cheerio');
const path    = require('path');
const fs      = require('fs');
const cfg     = require('./config');

const CACHE_DIR    = path.join(__dirname, '../../cache/etnet');
const CACHE_TTL_MS = 1 * 24 * 60 * 60 * 1000; // 行业PE缓存1天

if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

async function fetchWithRetry(url, retries = cfg.maxRetries) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await axios.get(url, { headers: cfg.headers, timeout: cfg.timeout });
      return res.data;
    } catch (err) {
      console.warn(`[etnet/industryPE] 请求失败(第${attempt}次): ${url} — ${err.message}`);
      if (attempt < retries) await new Promise(r => setTimeout(r, cfg.requestDelay * attempt));
    }
  }
  return null;
}

/**
 * 计算数组的中位数
 */
function median(arr) {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * 获取指定行业的可比公司PE中位数
 * @param {string} natureCode - etnet 行业代码，如 "SEM"
 * @returns {{ median: number|null, sampleSize: number, reason: string }}
 */
async function getComparablePE(natureCode) {
  if (!natureCode) return { median: null, sampleSize: 0, reason: '无行业代码' };

  const cacheFile = path.join(CACHE_DIR, `pe_${natureCode}.json`);
  if (fs.existsSync(cacheFile)) {
    const stat = fs.statSync(cacheFile);
    if (Date.now() - stat.mtimeMs < CACHE_TTL_MS) {
      try {
        const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
        console.log(`[etnet/industryPE] 命中缓存: ${natureCode} median=${cached.median}`);
        return cached;
      } catch (_) { /* 损坏则重新爬 */ }
    }
  }

  const url = cfg.baseURL + cfg.urls.industryDetail(natureCode);
  console.log(`[etnet/industryPE] 爬取行业PE: ${url}`);

  // 礼貌延迟
  await new Promise(r => setTimeout(r, cfg.requestDelay));

  const html = await fetchWithRetry(url);
  if (!html) {
    return { median: null, sampleSize: 0, reason: '网络请求失败' };
  }

  const $ = cheerio.load(html);
  const peValues = [];

  // 页面表格列顺序：代号 | 名称 | 升/跌 | 按盘价 | 变动率 | 市盈率
  // 使用索引匹配（不依赖 th 文字，因页面结构可能变化）
  $('table tr').each((_, row) => {
    const tds = $(row).find('td');
    if (tds.length < 6) return;

    const name = $(tds[1]).text().trim();
    const peRaw = $(tds[5]).text().trim().replace(/,/g, '');

    // 过滤规则2/3：排除人民币柜台和第二上市
    if (/[-－]Ｒ$/.test(name) || /[-－]Ｓ$/.test(name)) return;

    const pe = parseFloat(peRaw);
    // 过滤规则1：PE合理区间
    if (!isNaN(pe) && pe > 0 && pe < 200) {
      peValues.push(pe);
    }
  });

  if (peValues.length < 3) {
    const res = { median: null, sampleSize: peValues.length, reason: '可比公司不足3家' };
    fs.writeFileSync(cacheFile, JSON.stringify(res, null, 2));
    return res;
  }

  // 过滤规则4：截尾（去掉最高/最低各10%）
  peValues.sort((a, b) => a - b);
  const cutoff = Math.floor(peValues.length * 0.1);
  const trimmed = peValues.slice(cutoff, peValues.length - cutoff);

  if (trimmed.length < 3) {
    const res = { median: null, sampleSize: trimmed.length, reason: '截尾后可比公司不足3家' };
    fs.writeFileSync(cacheFile, JSON.stringify(res, null, 2));
    return res;
  }

  // 过滤规则5：取中位数
  const med = parseFloat(median(trimmed).toFixed(2));

  const result = {
    natureCode,
    median: med,
    sampleSize: trimmed.length,
    originalCount: peValues.length,
    reason: `${trimmed.length}家可比公司（截尾后）`,
    _fetchedAt: new Date().toISOString(),
  };

  fs.writeFileSync(cacheFile, JSON.stringify(result, null, 2));
  console.log(`[etnet/industryPE] 完成: ${natureCode} median=${med} (${trimmed.length}家样本)`);
  return result;
}

module.exports = { getComparablePE };
