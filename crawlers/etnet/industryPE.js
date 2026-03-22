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

const CACHE_DIR = path.join(__dirname, '../../cache/etnet');
const SUCCESS_CACHE_TTL_MS = 1 * 24 * 60 * 60 * 1000; // 成功缓存1天
const FAILURE_CACHE_TTL_MS = 10 * 60 * 1000; // 失败短缓存10分钟，避免短时故障放大
const MIN_SAMPLE_SIZE = 3;
const PE_MAX = 200;

const NAME_HEADER_PATTERNS = [/名稱/, /名称/, /公司/, /股份名稱/, /股份名称/];
const PE_HEADER_PATTERNS = [/市盈率/i, /^pe$/i, /^p\s*\/\s*e$/i, /^p\s*e$/i];
const SECONDARY_LISTING_PATTERNS = [
  /[-－]R$/i,
  /[-－]Ｒ$/,
  /[-－]S$/i,
  /[-－]Ｓ$/,
  /第二上市/,
  /secondary\s+listing/i,
  /人民币柜台/,
  /人民幣櫃台/,
  /柜台/,
  /櫃台/
];
const LOSS_PATTERNS = [/虧損/, /亏损/, /loss/i];
const NOT_APPLICABLE_PATTERNS = [/^n\/?a$/i, /^--$/, /^-$/, /不適用/, /不适用/];

if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

async function fetchWithRetry(url, retries = cfg.maxRetries) {
  let lastError = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await axios.get(url, { headers: cfg.headers, timeout: cfg.timeout });
      return { html: res.data, error: null, attempts: attempt };
    } catch (err) {
      lastError = err;
      console.warn(`[etnet/industryPE] 请求失败(第${attempt}次): ${url} — ${err.message}`);
      if (attempt < retries) await new Promise(r => setTimeout(r, cfg.requestDelay * attempt));
    }
  }
  return { html: null, error: lastError, attempts: retries };
}

function median(arr) {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function normalizeText(value) {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function normalizeHeaderText(value) {
  return normalizeText(value)
    .replace(/[：:]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

function getCellText($, cell) {
  return normalizeText($(cell).text());
}

function getRowCells($, row) {
  const cells = $(row).children('th, td').toArray();
  if (cells.length > 0) return cells;
  return $(row).find('th, td').toArray();
}

function detectColumnsFromCells(headerTexts) {
  const normalizedHeaders = headerTexts.map(normalizeHeaderText);
  const matchIndex = (patterns) => normalizedHeaders.findIndex((header) => patterns.some(pattern => pattern.test(header)));

  const nameIndex = matchIndex(NAME_HEADER_PATTERNS);
  const peIndex = matchIndex(PE_HEADER_PATTERNS);

  return {
    nameIndex,
    peIndex,
    normalizedHeaders,
    matched: nameIndex >= 0 && peIndex >= 0,
  };
}

function scoreTableCandidate($, table) {
  const rows = $(table).find('tr').toArray();
  const headerCandidates = [];

  rows.slice(0, 6).forEach((row, rowIndex) => {
    const cells = getRowCells($, row);
    if (!cells.length) return;
    const headerTexts = cells.map(cell => getCellText($, cell));
    const detection = detectColumnsFromCells(headerTexts);
    if (detection.nameIndex >= 0 || detection.peIndex >= 0) {
      const score =
        (detection.nameIndex >= 0 ? 4 : 0) +
        (detection.peIndex >= 0 ? 5 : 0) +
        Math.min(cells.length, 8) * 0.1 -
        rowIndex * 0.05;
      headerCandidates.push({
        rowIndex,
        headerTexts,
        detection,
        score,
        cellCount: cells.length,
      });
    }
  });

  const bestHeader = headerCandidates.sort((a, b) => b.score - a.score)[0] || null;
  const dataRowCount = Math.max(rows.length - ((bestHeader?.rowIndex ?? 0) + 1), 0);

  return {
    element: table,
    rows,
    headerCandidates,
    bestHeader,
    score: (bestHeader?.score || 0) + Math.min(dataRowCount, 20) * 0.05,
    dataRowCount,
  };
}

function detectMainTable($) {
  const candidates = $('table').toArray().map(table => scoreTableCandidate($, table));
  const viable = candidates.filter(candidate => candidate.bestHeader && candidate.bestHeader.detection.matched);

  if (viable.length === 0) {
    return {
      table: null,
      reason: 'main_table_not_found',
      candidates: candidates.map(candidate => ({
        score: candidate.score,
        dataRowCount: candidate.dataRowCount,
        headerCandidates: candidate.headerCandidates.map(header => ({
          rowIndex: header.rowIndex,
          headerTexts: header.headerTexts,
          detection: {
            nameIndex: header.detection.nameIndex,
            peIndex: header.detection.peIndex,
          },
        })),
      })),
    };
  }

  viable.sort((a, b) => b.score - a.score);
  const [best, second] = viable;

  if (second && Math.abs(best.score - second.score) < 0.35) {
    return {
      table: null,
      reason: 'ambiguous_main_table',
      candidates: viable.slice(0, 3).map(candidate => ({
        score: candidate.score,
        dataRowCount: candidate.dataRowCount,
        headerRowIndex: candidate.bestHeader.rowIndex,
        headerTexts: candidate.bestHeader.headerTexts,
        detectedColumns: {
          nameIndex: candidate.bestHeader.detection.nameIndex,
          peIndex: candidate.bestHeader.detection.peIndex,
        },
      })),
    };
  }

  return {
    table: best,
    reason: null,
    candidates: viable.slice(0, 3).map(candidate => ({
      score: candidate.score,
      dataRowCount: candidate.dataRowCount,
      headerRowIndex: candidate.bestHeader.rowIndex,
      headerTexts: candidate.bestHeader.headerTexts,
      detectedColumns: {
        nameIndex: candidate.bestHeader.detection.nameIndex,
        peIndex: candidate.bestHeader.detection.peIndex,
      },
    })),
  };
}

function summarizeRejectedRows(parsedRows) {
  return parsedRows.reduce((summary, row) => {
    if (!row.rejectReason) return summary;
    summary[row.rejectReason] = (summary[row.rejectReason] || 0) + 1;
    return summary;
  }, {});
}

function isSecondaryListing(name) {
  return SECONDARY_LISTING_PATTERNS.some(pattern => pattern.test(name));
}

function classifyPeValue(peRaw) {
  const normalized = normalizeText(peRaw).replace(/,/g, '');

  if (!normalized) {
    return { pe: null, rejectReason: 'empty_pe' };
  }

  if (LOSS_PATTERNS.some(pattern => pattern.test(normalized))) {
    return { pe: null, rejectReason: 'loss_making' };
  }

  if (NOT_APPLICABLE_PATTERNS.some(pattern => pattern.test(normalized))) {
    return { pe: null, rejectReason: 'pe_not_applicable' };
  }

  const pe = Number.parseFloat(normalized);
  if (!Number.isFinite(pe)) {
    return { pe: null, rejectReason: 'non_numeric_pe' };
  }

  if (pe <= 0 || pe >= PE_MAX) {
    return { pe: null, rejectReason: 'non_numeric_pe' };
  }

  return { pe, rejectReason: null };
}

function parseMarketCapValue(raw) {
  const normalized = normalizeText(raw).replace(/,/g, '').replace(/\s+/g, '');
  if (!normalized) return null;
  const matchers = [
    { re: /([\d.]+)億元?/i, multiplier: 1e8 },
    { re: /([\d.]+)亿/i, multiplier: 1e8 },
    { re: /([\d.]+)百萬元?/i, multiplier: 1e6 },
    { re: /([\d.]+)百万/i, multiplier: 1e6 },
    { re: /([\d.]+)萬元?/i, multiplier: 1e4 },
    { re: /([\d.]+)万/i, multiplier: 1e4 },
  ];
  for (const { re, multiplier } of matchers) {
    const match = normalized.match(re);
    if (match) {
      const value = Number.parseFloat(match[1]);
      if (Number.isFinite(value)) return value * multiplier;
    }
  }
  const plain = Number.parseFloat(normalized);
  return Number.isFinite(plain) ? plain : null;
}

function detectCapColumn(headerTexts) {
  const normalizedHeaders = headerTexts.map(normalizeHeaderText);
  return normalizedHeaders.findIndex(header => /市值|marketcap|marketcapitalization/.test(header));
}

function computeMarketCapSimilarity(peerMarketCap, ipoMarketCap) {
  if (!(Number.isFinite(peerMarketCap) && peerMarketCap > 0 && Number.isFinite(ipoMarketCap) && ipoMarketCap > 0)) return 0;
  return Math.exp(-Math.abs(Math.log(peerMarketCap / ipoMarketCap)));
}

function selectTopPeers(rows, ipoMarketCap, limit = 5) {
  const ranked = rows.map((row, index) => {
    const industryMatchScore = 1;
    const marketCapSimilarity = computeMarketCapSimilarity(row.marketCap, ipoMarketCap);
    return {
      ...row,
      industryMatchScore,
      marketCapSimilarity,
      combinedScore: industryMatchScore * marketCapSimilarity,
      originalIndex: index,
    };
  }).filter(row => row.pe !== null);

  if (!(Number.isFinite(ipoMarketCap) && ipoMarketCap > 0)) {
    return ranked.slice(0, limit).map(row => ({ ...row, combinedScore: 1, marketCapSimilarity: null }));
  }

  return ranked
    .sort((a, b) => b.combinedScore - a.combinedScore || a.pe - b.pe || a.originalIndex - b.originalIndex)
    .slice(0, limit);
}

function parseComparableTable($, tableCandidate) {
  const headerRowIndex = tableCandidate.bestHeader.rowIndex;
  const { nameIndex, peIndex, normalizedHeaders } = tableCandidate.bestHeader.detection;
  const capIndex = detectCapColumn(tableCandidate.bestHeader.headerTexts);
  const rows = tableCandidate.rows.slice(headerRowIndex + 1);
  const parsedRows = [];
  const validSamples = [];

  rows.forEach((row) => {
    const cells = getRowCells($, row);
    if (!cells.length) return;

    if (cells.length <= Math.max(nameIndex, peIndex)) {
      parsedRows.push({ name: '', peRaw: '', pe: null, rejectReason: 'malformed_row' });
      return;
    }

    const name = getCellText($, cells[nameIndex]);
    const peRaw = getCellText($, cells[peIndex]);
    const marketCapRaw = capIndex >= 0 && cells.length > capIndex ? getCellText($, cells[capIndex]) : '';

    if (!name && !peRaw) return;

    if (!name) {
      parsedRows.push({ name, peRaw, pe: null, rejectReason: 'empty_name' });
      return;
    }

    if (isSecondaryListing(name)) {
      parsedRows.push({ name, peRaw, pe: null, rejectReason: 'excluded_secondary_listing' });
      return;
    }

    const peResult = classifyPeValue(peRaw);
    const parsed = { name, peRaw, pe: peResult.pe, rejectReason: peResult.rejectReason, marketCapRaw, marketCap: parseMarketCapValue(marketCapRaw) };
    parsedRows.push(parsed);

    if (parsed.pe !== null && !parsed.rejectReason) {
      validSamples.push(parsed.pe);
    }
  });

  return {
    validSamples,
    parsedRows,
    originalRowCount: rows.length,
    parsedRowCount: parsedRows.length,
    rejectedRowSummary: summarizeRejectedRows(parsedRows),
    detectedColumns: { nameIndex, peIndex, capIndex },
    headerDetection: {
      headerRowIndex,
      headerTexts: tableCandidate.bestHeader.headerTexts,
      normalizedHeaders,
    },
  };
}

function getCacheTtlForStatus(status) {
  return status === 'success' ? SUCCESS_CACHE_TTL_MS : FAILURE_CACHE_TTL_MS;
}

function readCache(cacheFile) {
  if (!fs.existsSync(cacheFile)) return null;
  try {
    const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
    const cachedAt = cached.cachedAt || cached._fetchedAt || new Date(fs.statSync(cacheFile).mtimeMs).toISOString();
    const ageMs = Date.now() - new Date(cachedAt).getTime();
    const ttlMs = getCacheTtlForStatus(cached.status);
    if (!Number.isFinite(ageMs) || ageMs > ttlMs) return null;

    const cachedResult = {
      ...cached,
      details: { cacheHit: true, ...(cached.details || {}) },
      cachedAt,
    };
    console.log(`[etnet/industryPE] 命中缓存: ${path.basename(cacheFile)} status=${cachedResult.status} median=${cachedResult.median}`);
    return cachedResult;
  } catch (_) {
    return null;
  }
}

function writeCache(cacheFile, result) {
  const payload = {
    ...result,
    cachedAt: result.cachedAt || new Date().toISOString(),
  };
  fs.writeFileSync(cacheFile, JSON.stringify(payload, null, 2));
}

function buildResult(base, overrides = {}) {
  return {
    median: null,
    sampleSize: 0,
    originalCount: 0,
    reason: '',
    status: 'parse_error',
    details: {},
    ...base,
    ...overrides,
  };
}

function buildCacheKey(natureCode, ipoMarketCap) {
  if (!(Number.isFinite(ipoMarketCap) && ipoMarketCap > 0)) return `pe_${natureCode}.json`;
  const bucket = Math.max(1, Math.round(ipoMarketCap / 1e8));
  return `pe_${natureCode}_cap${bucket}.json`;
}

async function getComparablePE(natureCode, options = {}) {
  const ipoMarketCap = Number.isFinite(options.ipoMarketCap) ? options.ipoMarketCap : null;
  if (!natureCode) {
    return buildResult({
      reason: '无行业代码',
      status: 'industry_mapping_failed',
      details: { natureCode: null },
    });
  }

  const cacheFile = path.join(CACHE_DIR, buildCacheKey(natureCode, ipoMarketCap));
  const cached = readCache(cacheFile);
  if (cached) return cached;

  const url = cfg.baseURL + cfg.urls.industryDetail(natureCode);
  console.log(`[etnet/industryPE] 爬取行业PE: ${url}`);

  await new Promise(r => setTimeout(r, cfg.requestDelay));

  const { html, error, attempts } = await fetchWithRetry(url);
  if (!html) {
    const result = buildResult({
      reason: '网络请求失败',
      status: 'network_error',
      details: {
        natureCode,
        url,
        attempts,
        errorMessage: error ? error.message : 'unknown_error',
      },
      cachedAt: new Date().toISOString(),
    });
    writeCache(cacheFile, result);
    return result;
  }

  const $ = cheerio.load(html);
  const tableDetection = detectMainTable($);
  if (!tableDetection.table) {
    const result = buildResult({
      natureCode,
      reason: tableDetection.reason === 'ambiguous_main_table' ? '主表识别不唯一' : '未识别到包含公司名和市盈率的主表',
      status: 'parse_error',
      details: {
        natureCode,
        url,
        mainTableDetection: tableDetection,
      },
      detectedColumns: null,
      headerDetection: null,
      rejectedRowSummary: {},
      originalRowCount: 0,
      parsedRowCount: 0,
      cachedAt: new Date().toISOString(),
    });
    writeCache(cacheFile, result);
    return result;
  }

  const parsed = parseComparableTable($, tableDetection.table);
  const selectedPeers = selectTopPeers(parsed.parsedRows.filter(row => row.pe !== null && !row.rejectReason), ipoMarketCap, 5);
  const peValues = selectedPeers.map(row => row.pe).sort((a, b) => a - b);

  if (parsed.detectedColumns.nameIndex < 0 || parsed.detectedColumns.peIndex < 0) {
    const result = buildResult({
      natureCode,
      reason: '表头识别失败',
      status: 'parse_error',
      sampleSize: 0,
      originalCount: parsed.originalRowCount,
      details: {
        natureCode,
        url,
        headerDetection: parsed.headerDetection,
      },
      detectedColumns: parsed.detectedColumns,
      peerSelectionMethod: 'industry+cap_similarity',
      peerCountUsed: selectedPeers.length,
      headerDetection: parsed.headerDetection,
      rejectedRowSummary: parsed.rejectedRowSummary,
      originalRowCount: parsed.originalRowCount,
      parsedRowCount: parsed.parsedRowCount,
      cachedAt: new Date().toISOString(),
    });
    writeCache(cacheFile, result);
    return result;
  }

  if (peValues.length < MIN_SAMPLE_SIZE) {
    const result = buildResult({
      natureCode,
      reason: '可比公司不足3家',
      status: 'insufficient_samples',
      sampleSize: peValues.length,
      originalCount: parsed.originalRowCount,
      details: {
        natureCode,
        url,
        stage: 'raw_samples',
        peerSelectionMethod: 'industry+cap_similarity',
        peerCountUsed: selectedPeers.length,
        originalRowCount: parsed.originalRowCount,
        parsedRowCount: parsed.parsedRowCount,
        rejectedRowSummary: parsed.rejectedRowSummary,
      },
      detectedColumns: parsed.detectedColumns,
      headerDetection: parsed.headerDetection,
      rejectedRowSummary: parsed.rejectedRowSummary,
      originalRowCount: parsed.originalRowCount,
      parsedRowCount: parsed.parsedRowCount,
      cachedAt: new Date().toISOString(),
    });
    writeCache(cacheFile, result);
    return result;
  }

  const cutoff = Math.floor(peValues.length * 0.1);
  const trimmed = peValues.slice(cutoff, peValues.length - cutoff);

  if (trimmed.length < MIN_SAMPLE_SIZE) {
    const result = buildResult({
      natureCode,
      reason: '截尾后可比公司不足3家',
      status: 'insufficient_samples',
      sampleSize: trimmed.length,
      originalCount: peValues.length,
      details: {
        natureCode,
        url,
        stage: 'trimmed_samples',
        originalRowCount: parsed.originalRowCount,
        parsedRowCount: parsed.parsedRowCount,
        rawSampleSize: peValues.length,
        trimmedCount: trimmed.length,
        peerSelectionMethod: 'industry+cap_similarity',
        peerCountUsed: selectedPeers.length,
        rejectedRowSummary: parsed.rejectedRowSummary,
      },
      detectedColumns: parsed.detectedColumns,
      headerDetection: parsed.headerDetection,
      rejectedRowSummary: parsed.rejectedRowSummary,
      originalRowCount: parsed.originalRowCount,
      parsedRowCount: parsed.parsedRowCount,
      cachedAt: new Date().toISOString(),
    });
    writeCache(cacheFile, result);
    return result;
  }

  const rawMedian = median(trimmed);
  if (!Number.isFinite(rawMedian)) {
    const result = buildResult({
      natureCode,
      reason: '同行PE解析失败',
      status: 'parse_error',
      sampleSize: trimmed.length,
      originalCount: peValues.length,
      details: {
        natureCode,
        url,
        stage: 'median',
        trimmedCount: trimmed.length,
        peerSelectionMethod: 'industry+cap_similarity',
        peerCountUsed: selectedPeers.length,
      },
      detectedColumns: parsed.detectedColumns,
      headerDetection: parsed.headerDetection,
      rejectedRowSummary: parsed.rejectedRowSummary,
      originalRowCount: parsed.originalRowCount,
      parsedRowCount: parsed.parsedRowCount,
      cachedAt: new Date().toISOString(),
    });
    writeCache(cacheFile, result);
    return result;
  }

  const med = parseFloat(rawMedian.toFixed(2));
  const result = {
    natureCode,
    median: med,
    sampleSize: trimmed.length,
    originalCount: peValues.length,
    reason: `${trimmed.length}家可比公司（截尾后）`,
    status: 'success',
    peerSelectionMethod: 'industry+cap_similarity',
    peerCountUsed: selectedPeers.length,
    details: {
      natureCode,
      url,
      stage: 'completed',
      originalRowCount: parsed.originalRowCount,
      parsedRowCount: parsed.parsedRowCount,
      rawSampleSize: peValues.length,
      trimmedCount: trimmed.length,
      peerSelectionMethod: 'industry+cap_similarity',
      peerCountUsed: selectedPeers.length,
      selectedPeers: selectedPeers.map(row => ({ name: row.name, pe: row.pe, marketCap: row.marketCap, marketCapSimilarity: row.marketCapSimilarity, combinedScore: row.combinedScore })),
      rejectedRowSummary: parsed.rejectedRowSummary,
    },
    detectedColumns: parsed.detectedColumns,
    headerDetection: parsed.headerDetection,
    rejectedRowSummary: parsed.rejectedRowSummary,
    originalRowCount: parsed.originalRowCount,
    parsedRowCount: parsed.parsedRowCount,
    cachedAt: new Date().toISOString(),
    _fetchedAt: new Date().toISOString(),
  };

  writeCache(cacheFile, result);
  console.log(`[etnet/industryPE] 完成: ${natureCode} median=${med} (${trimmed.length}家样本, selected=${selectedPeers.length})`);
  return result;
}

module.exports = {
  getComparablePE,
  __testables: {
    classifyPeValue,
    detectColumnsFromCells,
    detectMainTable,
    getCacheTtlForStatus,
    parseComparableTable,
  },
};
