/**
 * etnet 行业代码映射爬虫
 * 爬取 industry.php，提取所有行业名称 → nature代码 的映射
 * 缓存到 data/industry_code_map.json（30天有效）
 */

const axios   = require('axios');
const cheerio = require('cheerio');
const path    = require('path');
const fs      = require('fs');
const cfg     = require('./config');

const MAP_PATH    = path.join(__dirname, '../../data/industry_code_map.json');
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30天

/**
 * 带重试的 HTTP GET
 */
async function fetchWithRetry(url, retries = cfg.maxRetries) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await axios.get(url, { headers: cfg.headers, timeout: cfg.timeout });
      return res.data;
    } catch (err) {
      console.warn(`[etnet/industryCodeMap] 请求失败(第${attempt}次): ${url} — ${err.message}`);
      if (attempt < retries) await new Promise(r => setTimeout(r, cfg.requestDelay * attempt));
    }
  }
  return null;
}

/**
 * 从 industry.php 构建行业名称 → nature代码 映射
 * @param {boolean} forceRefresh - 强制忽略缓存
 * @returns {Object} { 半导体: 'SEM', 汽车: 'AUT', ... }
 */
async function buildIndustryCodeMap(forceRefresh = false) {
  // 检查缓存
  if (!forceRefresh && fs.existsSync(MAP_PATH)) {
    const stat = fs.statSync(MAP_PATH);
    if (Date.now() - stat.mtimeMs < CACHE_TTL_MS) {
      try {
        const cached = JSON.parse(fs.readFileSync(MAP_PATH, 'utf-8'));
        console.log(`[etnet/industryCodeMap] 命中缓存(${Object.keys(cached).length}个行业)`);
        return cached;
      } catch (_) { /* 损坏则重建 */ }
    }
  }

  const url = cfg.baseURL + cfg.urls.industryMain;
  console.log(`[etnet/industryCodeMap] 爬取行业列表: ${url}`);

  const html = await fetchWithRetry(url);
  if (!html) {
    console.error('[etnet/industryCodeMap] 获取失败，返回空映射');
    return {};
  }

  const $ = cheerio.load(html);
  const map = {};

  // 提取所有指向 industry_detail.php?nature=XXX 的链接
  $('a[href*="industry_detail.php"]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const name = $(el).text().trim().replace(/\s+/g, '');
    const match = /nature=([A-Z0-9]+)/i.exec(href);
    if (match && name) {
      map[name] = match[1].toUpperCase();
    }
  });

  // 确保 data/ 目录存在
  const dataDir = path.dirname(MAP_PATH);
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  fs.writeFileSync(MAP_PATH, JSON.stringify(map, null, 2), 'utf-8');
  console.log(`[etnet/industryCodeMap] 构建完成，共${Object.keys(map).length}个行业`);
  return map;
}

module.exports = { buildIndustryCodeMap };
