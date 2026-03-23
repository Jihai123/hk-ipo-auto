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
const BRACKET_CONTENT_RE = /[（(［【].*?[）)］】]/g;
const FULLWIDTH_RE = /[！-～]/g;
const SPACE_RE = /\s+/g;
const COMMON_SUFFIXES = ['行業', '行业', '產業', '产业', '服務', '服务', '設備', '设备', '科技'];
const CHAR_VARIANTS = {
  體: '体', 導: '导', 醫: '医', 療: '疗', 器: '器', 械: '械', 軟: '软', 件: '件', 務: '务', 業: '业',
  產: '产', 設: '设', 備: '备', 金: '金', 融: '融', 科: '科', 技: '技', 電: '电',
  腦: '脑', 網: '网', 絡: '络', 雲: '云', 訊: '讯', 通: '通', 新: '新',
  能: '能', 源: '源', 車: '车', 汽: '汽', 光: '光', 伏: '伏', 生: '生', 物: '物',
  藥: '药', 銀: '银', 證: '证', 券: '券', 險: '险', 費: '费'
};
const HIGH_CONFIDENCE_ALIASES = {
  fintech: ['金融科技'],
  saas: ['软件服务', '軟件服務'],
  semiconductor: ['半导体', '半導體'],
  'semiconductor equipment': ['半导体设备', '半導體設備'],
  semicon: ['半导体', '半導體'],
  'healthcare equipment': ['医疗器械', '醫療器械'],
  healthcare: ['醫療保健業', '医疗保健业', '醫療保健', '医疗保健'],
  'medical and healthcare': ['醫療保健業', '医疗保健业', '醫療保健', '医疗保健'],
  'software services': ['軟件服務', '软件服务'],
  'software and services': ['軟件服務', '软件服务'],
  'new energy': ['新能源'],
  consumption: ['消費', '消费'],
  consumer: ['消費', '消费'],
  industrial: ['工業製品', '工业制品', '工業', '工业'],
  manufacturing: ['工業製品', '工业制品', '工業製造', '工业制造'],
};


const HIGH_CONFIDENCE_NORMALIZED_ALIASES = {
  医疗保健: ['醫療保健業', '医疗保健业', '醫療保健', '医疗保健'],
  軟件服務: ['軟件服務', '软件服务'],
  软件服务: ['軟件服務', '软件服务'],
  半導體: ['半導體', '半导体'],
  半导体: ['半導體', '半导体'],
  新能源: ['新能源'],
  消費: ['消費', '消费'],
  消费: ['消費', '消费'],
  工業製造: ['工業製品', '工业制品', '工業製造', '工业制造'],
  工业制造: ['工業製品', '工业制品', '工業製造', '工业制造'],
};
function toHalfWidth(value = '') {
  return value
    .replace(FULLWIDTH_RE, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/　/g, ' ');
}

function toSimpleChinese(value = '') {
  return Array.from(value).map(ch => CHAR_VARIANTS[ch] || ch).join('');
}

function stripCommonSuffix(name) {
  let result = name;
  for (const suffix of COMMON_SUFFIXES) {
    if (result.endsWith(suffix)) {
      const trimmed = result.slice(0, -suffix.length);
      if (trimmed.length >= 2) return trimmed;
    }
  }
  return result;
}

function normalizeIndustryName(name) {
  if (!name || typeof name !== 'string') return '';

  let normalized = toHalfWidth(name)
    .trim()
    .replace(SPACE_RE, ' ')
    .replace(BRACKET_CONTENT_RE, '')
    .replace(/[()（）\[\]【】]/g, ' ')
    .replace(/[／/]/g, ' ')
    .replace(/[-–—]/g, ' ')
    .replace(SPACE_RE, ' ')
    .trim();

  normalized = toSimpleChinese(normalized);
  normalized = normalized.toLowerCase();
  const compact = normalized.replace(SPACE_RE, '');
  return stripCommonSuffix(compact);
}

function addVariant(index, key, value) {
  if (!key) return;
  if (!index[key]) index[key] = value;
}

function createIndustryCodeMapFromRaw(rawMap = {}) {
  const map = {};
  const normalizedIndex = {};
  const aliasIndex = {};
  const entries = [];

  for (const [rawName, code] of Object.entries(rawMap)) {
    if (!rawName || !code) continue;
    const value = String(code).toUpperCase();
    const normalizedName = normalizeIndustryName(rawName);
    entries.push({ rawName, normalizedName, code: value });
    addVariant(map, rawName, value);
    addVariant(normalizedIndex, normalizedName, value);
    addVariant(map, normalizedName, value);
  }

  for (const [alias, targets] of Object.entries(HIGH_CONFIDENCE_ALIASES)) {
    const aliasKey = normalizeIndustryName(alias);
    for (const target of targets) {
      const targetKey = normalizeIndustryName(target);
      const code = normalizedIndex[targetKey] || map[target] || map[targetKey];
      if (code) {
        addVariant(aliasIndex, aliasKey, code);
        addVariant(map, aliasKey, code);
        break;
      }
    }
  }

  for (const [alias, targets] of Object.entries(HIGH_CONFIDENCE_NORMALIZED_ALIASES)) {
    const aliasKey = normalizeIndustryName(alias);
    for (const target of targets) {
      const targetKey = normalizeIndustryName(target);
      const code = normalizedIndex[targetKey] || aliasIndex[targetKey] || map[target] || map[targetKey];
      if (code) {
        addVariant(aliasIndex, aliasKey, code);
        addVariant(map, aliasKey, code);
        break;
      }
    }
  }

  return {
    ...map,
    _meta: {
      rawMap: { ...rawMap },
      normalizedIndex,
      aliasIndex,
      entries,
      generatedAt: new Date().toISOString(),
    },
  };
}

function getTopSimilarCandidates(normalizedIndustry, entries, limit = 3) {
  if (!normalizedIndustry) return [];

  return entries
    .map(entry => {
      const candidate = entry.normalizedName;
      let score = 0;
      if (!candidate) return null;
      if (candidate.startsWith(normalizedIndustry) || normalizedIndustry.startsWith(candidate)) score += 3;
      if (candidate.includes(normalizedIndustry) || normalizedIndustry.includes(candidate)) score += 2;
      const commonPrefix = Array.from(candidate).findIndex((ch, idx) => normalizedIndustry[idx] !== ch);
      const prefixLength = commonPrefix === -1 ? Math.min(candidate.length, normalizedIndustry.length) : commonPrefix;
      score += Math.min(prefixLength, 4) * 0.5;
      if (score <= 0) return null;
      return {
        rawIndustry: entry.rawName,
        normalizedIndustry: candidate,
        natureCode: entry.code,
        score,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || a.normalizedIndustry.length - b.normalizedIndustry.length)
    .slice(0, limit)
    .map(({ score, ...rest }) => rest);
}

function resolveIndustryNatureCode(industry, codeMap = {}) {
  const originalIndustry = typeof industry === 'string' ? industry : '';
  const normalizedIndustry = normalizeIndustryName(originalIndustry);
  const meta = codeMap._meta || {};
  const rawMap = meta.rawMap || {};
  const normalizedIndex = meta.normalizedIndex || {};
  const aliasIndex = meta.aliasIndex || {};
  const entries = meta.entries || Object.entries(rawMap).map(([rawName, code]) => ({ rawName, normalizedName: normalizeIndustryName(rawName), code }));
  const triedMatchLevels = [];

  if (originalIndustry && rawMap[originalIndustry]) {
    triedMatchLevels.push('exact');
    return {
      natureCode: rawMap[originalIndustry],
      matchLevel: 'exact',
      mappingFailed: false,
      debug: { originalIndustry, normalizedIndustry, triedMatchLevels, topSimilarCandidates: [] },
    };
  }

  triedMatchLevels.push('exact');
  if (normalizedIndustry && normalizedIndex[normalizedIndustry]) {
    triedMatchLevels.push('normalized');
    return {
      natureCode: normalizedIndex[normalizedIndustry],
      matchLevel: 'normalized',
      mappingFailed: false,
      debug: { originalIndustry, normalizedIndustry, triedMatchLevels, topSimilarCandidates: [] },
    };
  }

  triedMatchLevels.push('normalized');
  if (normalizedIndustry && aliasIndex[normalizedIndustry]) {
    triedMatchLevels.push('alias');
    return {
      natureCode: aliasIndex[normalizedIndustry],
      matchLevel: 'alias',
      mappingFailed: false,
      debug: { originalIndustry, normalizedIndustry, triedMatchLevels, topSimilarCandidates: [] },
    };
  }

  triedMatchLevels.push('alias');
  if (normalizedIndustry) {
    const fallbackMatches = entries.filter(entry => {
      if (!entry.normalizedName || entry.normalizedName === normalizedIndustry) return false;
      return entry.normalizedName.startsWith(normalizedIndustry) || normalizedIndustry.startsWith(entry.normalizedName);
    });

    const exactPrefixMatches = fallbackMatches
      .sort((a, b) => a.normalizedName.length - b.normalizedName.length)
      .filter(entry => {
        const shorter = entry.normalizedName.length <= normalizedIndustry.length ? entry.normalizedName : normalizedIndustry;
        return shorter.length >= 2;
      });

    if (exactPrefixMatches.length === 1) {
      triedMatchLevels.push('fallback');
      return {
        natureCode: exactPrefixMatches[0].code,
        matchLevel: 'fallback',
        mappingFailed: false,
        debug: {
          originalIndustry,
          normalizedIndustry,
          triedMatchLevels,
          topSimilarCandidates: [{
            rawIndustry: exactPrefixMatches[0].rawName,
            normalizedIndustry: exactPrefixMatches[0].normalizedName,
            natureCode: exactPrefixMatches[0].code,
          }],
        },
      };
    }
  }

  triedMatchLevels.push('fallback');
  return {
    natureCode: null,
    matchLevel: 'failed',
    mappingFailed: true,
    debug: {
      originalIndustry,
      normalizedIndustry,
      triedMatchLevels,
      topSimilarCandidates: getTopSimilarCandidates(normalizedIndustry, entries, 3),
    },
  };
}

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
        if (cached && cached._meta?.rawMap) {
          console.log(`[etnet/industryCodeMap] 命中缓存(${Object.keys(cached._meta.rawMap).length}个行业)`);
          return cached;
        }
        const rebuilt = createIndustryCodeMapFromRaw(cached || {});
        console.log(`[etnet/industryCodeMap] 命中旧缓存并完成增强重建(${Object.keys(rebuilt._meta.rawMap).length}个行业)`);
        fs.writeFileSync(MAP_PATH, JSON.stringify(rebuilt, null, 2), 'utf-8');
        return rebuilt;
      } catch (_) { /* 损坏则重建 */ }
    }
  }

  const url = cfg.baseURL + cfg.urls.industryMain;
  console.log(`[etnet/industryCodeMap] 爬取行业列表: ${url}`);

  const html = await fetchWithRetry(url);
  if (!html) {
    console.error('[etnet/industryCodeMap] 获取失败，返回空映射');
    return createIndustryCodeMapFromRaw({});
  }

  const $ = cheerio.load(html);
  const rawMap = {};

  // 提取所有指向 industry_detail.php?nature=XXX 的链接
  $('a[href*="industry_detail.php"]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const name = $(el).text().trim().replace(/\s+/g, '');
    const match = /nature=([A-Z0-9]+)/i.exec(href);
    if (match && name) {
      rawMap[name] = match[1].toUpperCase();
    }
  });

  const enhancedMap = createIndustryCodeMapFromRaw(rawMap);

  // 确保 data/ 目录存在
  const dataDir = path.dirname(MAP_PATH);
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  fs.writeFileSync(MAP_PATH, JSON.stringify(enhancedMap, null, 2), 'utf-8');
  console.log(`[etnet/industryCodeMap] 构建完成，共${Object.keys(rawMap).length}个原始行业，扩展键${Object.keys(enhancedMap).filter(key => key !== '_meta').length}个`);
  return enhancedMap;
}

module.exports = { buildIndustryCodeMap, normalizeIndustryName, resolveIndustryNatureCode, createIndustryCodeMapFromRaw };
