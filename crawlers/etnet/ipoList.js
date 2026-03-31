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
  TABLE_TYPE.subscribing,
  TABLE_TYPE.listingSoon,
  TABLE_TYPE.recentNewStocks,
]);

const HEADER_ALIASES = {
  code: ['代号', '編號', '编号', '股份代号', '股票编号', '股票代号'],
  name: ['名称', '名稱', '股份名称', '公司名称', '公司'],
  listingDate: ['上市日期', '挂牌日期', '掛牌日期', '预期上市日期'],
  offerEndDate: ['截止日期', '截止认购日', '截止認購日', '招股截止', '认购截止', '認購截止'],
  currency: ['货币', '貨幣', '币别', '幣別'],
  offerPrice: ['上市价', '上市價', '招股价', '招股價', '发售价', '發售價', '定价', '定價'],
  lotSize: ['每手股数', '每手', '每手股數', 'lotsize', '稳中一手', '穩中一手'],
  entryFee: ['入场费', '入場費', '每手入场费', '每手入場費', 'lotamount', '每手金额'],
  subscriptionMultiple: ['认购倍数', '認購倍數', '超额认购', '超額認購'],
  allotmentRate: ['一手中签率', '一手中籤率', '中签率', '中籤率', '分配比率'],
  firstDayOpen: ['首日开市价', '首日開市價', '开市价', '開市價', '开盘价', '開盤價'],
  firstDayClose: ['按盘价', '按盤價', '收盘价', '收盤價', '现价', '現價'],
  firstDayChangePct: ['首日升跌', '累积升跌', '累計升跌', '首日表现', '首日表現', '累计升跌'],
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

function parseLabeledNumeric(raw = '', labels = []) {
  const text = String(raw || '').replace(/\s+/g, ' ');
  for (const label of labels) {
    const m = text.match(new RegExp(`${label}\\s*[:：]?\\s*([+-]?[\\d,]+(?:\\.\\d+)?)`));
    if (m) {
      return parseNumeric(m[1]);
    }
  }
  return null;
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

function matchTitleText(text = '', include = [], exact = false) {
  const normText = normalizeHeaderKey(text);
  return include.some((keyword) => {
    const normKeyword = normalizeHeaderKey(keyword);
    if (!normKeyword) return false;
    if (exact) return normText === normKeyword;
    return normText.includes(normKeyword);
  });
}

function findHeaderIndex(headers = [], aliases = []) {
  return headers.findIndex(h => aliases.some(alias => h.includes(normalizeHeaderKey(alias))));
}

function resolveColumnMap(headers = [], moduleType = '') {
  const baseMap = {
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

  if (moduleType === TABLE_TYPE.todayListed) {
    return {
      ...baseMap,
      code: findHeaderIndex(headers, ['代号']),
      name: findHeaderIndex(headers, ['名称']),
      firstDayClose: findHeaderIndex(headers, ['按盘价', '按盤價']),
      offerPrice: findHeaderIndex(headers, ['上市价', '上市價']),
      firstDayOpen: findHeaderIndex(headers, ['开市价', '開市價']),
      currency: findHeaderIndex(headers, ['货币', '貨幣']),
    };
  }

  if (moduleType === TABLE_TYPE.hearingPassed) {
    return {
      ...baseMap,
      name: findHeaderIndex(headers, ['名称', '名稱']),
      statusText: findHeaderIndex(headers, ['市场', '市場']),
      listingDate: -1,
      code: -1,
    };
  }

  return baseMap;
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
  const tableLookup = new Map();
  const tables = [];
  $('table').each((idx, node) => {
    const $table = $(node);
    const rows = $table.find('tr').toArray();
    if (!rows.length) return;

    const headerRow = rows.find(r => $(r).find('th').length > 0) || rows[0];
    const headers = $(headerRow).find('th,td').map((_, td) => normalizeHeaderKey($(td).text())).get().filter(Boolean);

    const dataRows = rows.map(r => $(r).find('td').map((__, td) => $(td).text().replace(/\s+/g, ' ').trim()).get());
    const title = getNearbyTitleText($, $table);
    const tableInfo = {
      tableIndex: idx,
      tableNode: $table,
      rawNode: node,
      headers,
      title,
      dataRows,
      text: $table.text().replace(/\s+/g, ' ').trim(),
    };
    tables.push(tableInfo);
    tableLookup.set(node, tableInfo);
  });
  return { tables, tableLookup };
}

function isLikelyDataTable(table = null) {
  if (!table) return false;
  const text = table.text || '';
  if (!text) return false;
  if (/沒有相關資料|没有相关资料/.test(text)) return true;
  if (/免責聲明|免责声明|資料來源|资料来源/.test(text)) return false;
  return table.headers.length >= 2 || table.dataRows.some(r => r.length >= 3);
}

function collectCandidateTablesFromAnchor($, $anchor, tableLookup, tableFilter = null, limit = 20) {
  const seen = new Set();
  const candidates = [];
  const meta = {
    anchorFound: !!($anchor && $anchor.length),
    anchorTag: $anchor?.[0]?.tagName || null,
    containerFound: false,
    containerType: null,
    tablesFoundInContainer: 0,
  };
  if (!$anchor || !$anchor.length) return { candidates, meta };

  const $container = $anchor.closest('.DivFigureBox');
  if ($container.length) {
    meta.containerFound = true;
    meta.containerType = 'DivFigureBox';
    const primaryTables = $container.find('.DivFigureContent table.figureTable');
    meta.tablesFoundInContainer = primaryTables.length;

    const acceptNode = (node) => {
      if (!node || seen.has(node)) return;
      seen.add(node);
      const info = tableLookup.get(node);
      if (!info || !isLikelyDataTable(info)) return;
      if (typeof tableFilter === 'function' && !tableFilter(info)) return;
      candidates.push(info);
    };

    primaryTables.each((_, node) => acceptNode(node));
    if (candidates.length < limit) {
      $container.find('table').each((_, node) => acceptNode(node));
    }
  } else {
    const $fallbackRoot = $anchor.closest('.DivTemplateB,.shadow,.content,.container,section').first();
    const $tables = $fallbackRoot.length ? $fallbackRoot.find('table') : $anchor.parent().find('table').slice(0, 6);
    $tables.each((_, node) => {
      if (seen.has(node)) return;
      seen.add(node);
      const info = tableLookup.get(node);
      if (!info || !isLikelyDataTable(info)) return;
      if (typeof tableFilter === 'function' && !tableFilter(info)) return;
      candidates.push(info);
    });
  }

  return { candidates: candidates.slice(0, limit), meta };
}

function getTableCandidateFeatures(table = null) {
  if (!table) return null;
  const headersText = table.headers.join('|');
  const rows = table.dataRows.slice(1);
  const rowsCount = rows.length;
  const hasHeaderRow = table.headers.length >= 2;
  const hasNoDataText = /沒有相關資料|没有相关资料/.test(table.text || '');
  const hasCodeLink = /(?:\/quote|\/stocks|\b\d{4,5}\b)/i.test(table.text || '');
  const hasListingDateLike = includesAny(headersText, ['上市日期', '挂牌日期', '掛牌日期', '预期上市日期']);
  const candidateDataRows = rows.filter(cells => {
    if (!cells.length) return false;
    if (isNoiseRow(cells)) return false;
    const rowText = cells.join(' ');
    return !!(normalizeCode(rowText) || normalizeDate(rowText) || rowText.length >= 8);
  }).length;
  return {
    rowsCount,
    hasHeaderRow,
    hasNoDataText,
    hasCodeLink,
    hasListingDateLike,
    candidateDataRows,
  };
}

function scoreCandidateTable(table = null, moduleType = '') {
  const f = getTableCandidateFeatures(table);
  if (!f) return -1;
  const headersText = table.headers.join('|');
  const text = table.text || '';
  let score = 0;
  if (f.hasHeaderRow) score += 3;
  if (f.hasListingDateLike) score += 2;
  if (f.hasCodeLink) score += 2;
  score += Math.min(f.candidateDataRows, 6);
  if (f.hasNoDataText) score += 1;
  if (/免責聲明|免责声明|資料來源|资料来源/.test(text)) score -= 5;
  if (/上市时间表|上市時間表|即将上市新股|即將上市新股/.test(text)) score -= 4;

  if (moduleType === TABLE_TYPE.recentNewStocks) {
    const keyHits = [
      '每手股数',
      '入场费',
      '认购倍数',
      '一手中签率',
      '按盘价',
      '累积升跌',
    ].reduce((acc, k) => acc + (includesAny(headersText, [k]) ? 1 : 0), 0);
    score += keyHits * 3;
    if (f.rowsCount <= 3 && keyHits <= 2) score -= 6;
  }
  return score;
}

function findModuleTableByTitle($, tableLookup, options) {
  const {
    include = [],
    exclude = [],
    tableFilter = null,
    moduleType = '',
    exact = false,
  } = options || {};
  const candidates = $(
    '.DivFigureBox .DivTemplateBHdr,.DivFigureBox [class*="Hdr"],div.DivTemplateBHdr,h1,h2,h3,h4,h5,strong,b,div,span,p,td,th,a'
  );
  let best = null;
  let bestScore = -1;
  const debugCandidates = [];
  let selectedMeta = {
    anchorFound: false,
    anchorTag: null,
    containerFound: false,
    containerType: null,
    tablesFoundInContainer: 0,
  };

  for (let i = 0; i < candidates.length; i += 1) {
    const el = candidates[i];
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    if (!text) continue;
    if (text.length > 120 && !$(el).is('.DivTemplateBHdr,[class*="Hdr"]')) continue;
    const hit = matchTitleText(text, include, exact);
    if (!hit) continue;
    if (exclude.some(keyword => text.includes(keyword))) continue;
    selectedMeta.anchorFound = true;
    selectedMeta.anchorTag = el.tagName || null;

    const { candidates: foundTables, meta } = collectCandidateTablesFromAnchor(
      $,
      $(el),
      tableLookup,
      tableFilter,
      moduleType === TABLE_TYPE.recentNewStocks ? 30 : 20,
    );
    selectedMeta = { ...selectedMeta, ...meta };
    foundTables.forEach((table) => {
      const features = getTableCandidateFeatures(table);
      const score = scoreCandidateTable(table, moduleType);
      debugCandidates.push({ tableIndex: table.tableIndex, ...features, score });
      if (score > bestScore) {
        bestScore = score;
        best = table;
      }
    });
    if (best && bestScore >= 8) break;
  }

  const titleLabel = include.join('/');
  console.log('[IPO][parser][title-scan]', {
    module: moduleType || titleLabel,
    title: titleLabel,
    anchorFound: selectedMeta.anchorFound,
    anchorTag: selectedMeta.anchorTag,
    containerFound: selectedMeta.containerFound,
    containerType: selectedMeta.containerType,
    tablesFoundInContainer: selectedMeta.tablesFoundInContainer,
    candidateCount: debugCandidates.length,
    candidates: debugCandidates.slice(0, 8),
    selectedTableIndex: best ? best.tableIndex : null,
    selectedScore: bestScore,
  });

  return { table: best, meta: selectedMeta };
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

function getCellByModule(cells, idx, headers, moduleType) {
  if (moduleType !== TABLE_TYPE.todayListed) return getCell(cells, idx);
  if (typeof idx !== 'number' || idx < 0) return null;
  const blankBefore = headers.slice(0, idx).filter(h => !h).length;
  const adjustedIdx = headers.length > cells.length ? idx - blankBefore : idx;
  return getCell(cells, adjustedIdx);
}

function getRowsLogPrefix(moduleType) {
  if (moduleType === TABLE_TYPE.todayListed) return '[IPO][parser][rows][todayListed]';
  if (moduleType === TABLE_TYPE.hearingPassed) return '[IPO][parser][rows][hearingPassed]';
  if (moduleType === TABLE_TYPE.recentNewStocks) return '[IPO][parser][rows][recentNewStocks]';
  return null;
}

function logRowsDebug(prefix, payload) {
  console.log(`${prefix} ${JSON.stringify(payload, null, 2)}`);
}

function normalizeByModule(moduleType, raw, filterStats, rowDebug = null) {
  const code = normalizeCode(raw.code);
  const { name, statusText: parsedStatus } = extractNameStatus(raw.name);
  const listingDate = normalizeDateOrRaw(raw.listingDate);
  const rowText = String(raw.rowText || '').replace(/\s+/g, ' ');
  const requireCode = moduleType !== TABLE_TYPE.hearingPassed;
  const requireListingDate = REQUIRED_LISTING_DATE_MODULES.has(moduleType);

  if (requireCode && !code) {
    filterStats.invalidCode += 1;
    if (rowDebug) rowDebug.filterReason = 'invalidCode';
    return null;
  }
  if (!name) {
    filterStats.invalidName += 1;
    if (rowDebug) rowDebug.filterReason = 'invalidName';
    return null;
  }
  if (requireListingDate && isNullLike(listingDate)) {
    filterStats.invalidListingDate += 1;
    if (rowDebug) rowDebug.filterReason = 'invalidListingDate';
    return null;
  }

  const offer = parseOfferPrice(raw.offerPrice);
  const fallbackOfferPrice = offer.offerPrice ?? parseLabeledNumeric(rowText, ['上市价', '上市價', '招股价', '招股價', '发售价', '發售價']);
  const fallbackBoardLot = parseLotSize(raw.lotSize) ?? parseLabeledNumeric(rowText, ['每手股数', '每手股數', '每手']);
  const fallbackEntryFee = parseNumeric(raw.entryFee) ?? parseLabeledNumeric(rowText, ['入场费', '入場費', '每手入场费', '每手入場費']);
  const common = {
    code,
    name,
    listingDate,
    currency: isNullLike(raw.currency) ? null : String(raw.currency).trim(),
    offerPrice: fallbackOfferPrice,
    boardLot: fallbackBoardLot,
    entryFee: fallbackEntryFee,
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
      offerEndDate: isNullLike(raw.offerEndDate) ? null : normalizeDateOrRaw(raw.offerEndDate),
    };
  }

  if (moduleType === TABLE_TYPE.hearingPassed) {
    const applicationDate = normalizeDateOrRaw(raw.offerEndDate);
    return {
      code,
      name,
      listingDate: null,
      offerEndDate: isNullLike(applicationDate) ? null : applicationDate,
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
  if (!tableInfo || !tableInfo.dataRows?.length) {
    return { records: [], filterStats: null, matched: false, emptyState: false };
  }

  const rowsLogPrefix = getRowsLogPrefix(moduleType);
  const enableRowsLog = !!rowsLogPrefix;
  const map = resolveColumnMap(tableInfo.headers, moduleType);
  const filterStats = {
    module: moduleType,
    totalRows: 0,
    invalidCode: 0,
    invalidName: 0,
    invalidListingDate: 0,
    obviousNoiseRow: 0,
    emptyStateRows: 0,
  };
  if (enableRowsLog) {
    logRowsDebug(rowsLogPrefix, {
      stage: 'tableSelected',
      tableIndex: tableInfo.tableIndex ?? null,
      rowsCount: Math.max((tableInfo.dataRows?.length || 0) - 1, 0),
      headerRowRawText: (tableInfo.dataRows?.[0] || []).join(' | ') || null,
      headerCells: tableInfo.dataRows?.[0] || [],
      normalizedHeaders: tableInfo.headers || [],
      columnMap: map,
    });
    if (moduleType === TABLE_TYPE.recentNewStocks) {
      logRowsDebug(rowsLogPrefix, {
        stage: 'headerAliasMapping',
        mapping: {
          每手股数: map.lotSize,
          入场费: map.entryFee,
          认购倍数: map.subscriptionMultiple,
          一手中签率: map.allotmentRate,
          按盘价: map.firstDayClose,
          累积升跌: map.firstDayChangePct,
        },
      });
    }
  }

  const tableText = tableInfo.text || '';
  const hasEmptyStateText = /沒有相關資料|没有相关资料/.test(tableText);
  const list = [];
  for (const [rowIndex, cells] of tableInfo.dataRows.slice(1).entries()) {
    if (!cells.length) continue;
    filterStats.totalRows += 1;
    const rowText = cells.join(' ');

    if (enableRowsLog) {
      logRowsDebug(rowsLogPrefix, {
        stage: 'rowRaw',
        rowIndex,
        rawText: rowText || null,
        cellTexts: cells,
      });
    }

    if (isNoiseRow(cells)) {
      if (/沒有相關資料|没有相关资料/.test(rowText)) {
        filterStats.emptyStateRows += 1;
      } else {
        filterStats.obviousNoiseRow += 1;
      }
      if (enableRowsLog) {
        logRowsDebug(rowsLogPrefix, {
          stage: 'rowFiltered',
          rowIndex,
          kept: false,
          filterReason: 'obviousNoiseRow',
        });
      }
      continue;
    }

    const raw = {
      code: getCellByModule(cells, map.code, tableInfo.headers, moduleType) || cells[0] || null,
      name: getCellByModule(cells, map.name, tableInfo.headers, moduleType) || cells[1] || null,
      rowText: cells.join(' | '),
      listingDate: getCellByModule(cells, map.listingDate, tableInfo.headers, moduleType),
      offerEndDate: getCellByModule(cells, map.offerEndDate, tableInfo.headers, moduleType),
      currency: getCellByModule(cells, map.currency, tableInfo.headers, moduleType),
      offerPrice: getCellByModule(cells, map.offerPrice, tableInfo.headers, moduleType),
      lotSize: getCellByModule(cells, map.lotSize, tableInfo.headers, moduleType),
      entryFee: getCellByModule(cells, map.entryFee, tableInfo.headers, moduleType),
      subscriptionMultiple: getCellByModule(cells, map.subscriptionMultiple, tableInfo.headers, moduleType),
      allotmentRate: getCellByModule(cells, map.allotmentRate, tableInfo.headers, moduleType),
      firstDayOpen: getCellByModule(cells, map.firstDayOpen, tableInfo.headers, moduleType),
      firstDayClose: getCellByModule(cells, map.firstDayClose, tableInfo.headers, moduleType),
      firstDayChangePct: getCellByModule(cells, map.firstDayChangePct, tableInfo.headers, moduleType),
      lotProfit: getCellByModule(cells, map.lotProfit, tableInfo.headers, moduleType),
      statusText: getCellByModule(cells, map.statusText, tableInfo.headers, moduleType),
    };

    const rowDebug = { filterReason: null };
    const normalized = normalizeByModule(moduleType, raw, filterStats, rowDebug);
    if (enableRowsLog) {
      const rowExtracted = {
        code: normalized?.code ?? normalizeCode(raw.code),
        name: normalized?.name ?? extractNameStatus(raw.name).name,
        listingDate: normalized?.listingDate ?? normalizeDateOrRaw(raw.listingDate),
        currency: normalized?.currency ?? (isNullLike(raw.currency) ? null : String(raw.currency).trim()),
        offerPrice: normalized?.offerPrice ?? parseOfferPrice(raw.offerPrice).offerPrice ?? parseLabeledNumeric(raw.rowText, ['上市价', '上市價', '招股价', '招股價', '发售价', '發售價']),
        boardLot: normalized?.boardLot ?? parseLotSize(raw.lotSize) ?? parseLabeledNumeric(raw.rowText, ['每手股数', '每手股數', '每手']),
        entryFee: normalized?.entryFee ?? parseNumeric(raw.entryFee) ?? parseLabeledNumeric(raw.rowText, ['入场费', '入場費', '每手入场费', '每手入場費']),
        subscriptionMultiple: normalized?.subscriptionMultiple ?? parseNumeric(raw.subscriptionMultiple),
        allotmentRate: normalized?.allotmentRate ?? parsePercent(raw.allotmentRate),
        firstDayOpen: normalized?.firstDayOpen ?? parseNumeric(raw.firstDayOpen),
        firstDayClose: normalized?.firstDayClose ?? parseNumeric(raw.firstDayClose),
        firstDayChangePct: normalized?.firstDayChangePct ?? parsePercent(raw.firstDayChangePct),
        lotProfit: normalized?.lotProfit ?? parseNumeric(raw.lotProfit),
        statusText: normalized?.statusText ?? raw.statusText ?? null,
      };

      let filterReason = rowDebug.filterReason || null;
      if (!normalized && !filterReason) {
        filterReason = map.code < 0 || map.name < 0 ? 'columnMismatch' : 'other';
      }
      if (normalized) filterReason = null;

      const boardLotEntryFeeReason = moduleType === TABLE_TYPE.recentNewStocks ? {
        boardLotReason: map.lotSize < 0
          ? 'missingHeaderAlias'
          : (map.lotSize >= cells.length
              ? 'wrongColumnIndex'
              : (isNullLike(raw.lotSize)
                  ? 'emptyCell'
                  : (parseLotSize(raw.lotSize) === null ? 'parseNumberFailed' : null))),
        entryFeeReason: map.entryFee < 0
          ? 'missingHeaderAlias'
          : (map.entryFee >= cells.length
              ? 'wrongColumnIndex'
              : (isNullLike(raw.entryFee)
                  ? 'emptyCell'
                  : (parseNumeric(raw.entryFee) === null ? 'parseNumberFailed' : null))),
      } : null;

      logRowsDebug(rowsLogPrefix, {
        stage: 'rowParsed',
        rowIndex,
        extracted: rowExtracted,
        kept: !!normalized,
        filterReason,
        columnMap: enableRowsLog ? map : undefined,
        boardLotEntryFeeReason,
      });
    }
    if (normalized) list.push(normalized);
  }

  const emptyState = hasEmptyStateText && list.length === 0;
  const records = moduleType === TABLE_TYPE.hearingPassed
    ? uniqByName(list)
    : uniqByCode(list);
  return { records, filterStats, matched: true, emptyState };
}

function parseTodayGreyMarketCard($) {
  const blocks = [];
  $('body').children().slice(0, 30).each((_, node) => {
    blocks.push(node);
    $(node).find('table,div,section,tr').slice(0, 12).each((__, child) => blocks.push(child));
  });
  for (let i = 0; i < blocks.length; i += 1) {
    const text = $(blocks[i]).text().replace(/\s+/g, ' ').trim();
    if (!text || text.length < 30 || text.length > 1600) continue;
    if (!/(\d{4,5})/.test(text)) continue;
    if (!/按盘价|按盤價|累积升跌|累計升跌|暗盘|暗盤|明天上市|明日上市|待上市/.test(text)) continue;
    if (/招股中|即将上市新股|上市时间表|新股信息|申请上市/.test(text)) continue;

    const code = normalizeCode(text);
    const dateTextMatch = text.match(/(\d{4}[\/.\-年]\d{1,2}[\/.\-月]\d{1,2}|\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{4})/);
    const listingDate = normalizeDateOrRaw(dateTextMatch ? dateTextMatch[1] : null);
    if (!code || isNullLike(listingDate)) continue;

    const anchorText = $(blocks[i]).find('a').first().text().replace(/\s+/g, ' ').trim();
    const { name } = extractNameStatus(anchorText || text);
    if (isNullLike(name)) continue;

    return [{
      code,
      name,
      listingDate,
      currency: /usd/i.test(text) ? 'USD' : 'HKD',
      offerPrice: parseLabeledNumeric(text, ['上市价', '上市價', '招股价', '招股價', '发售价', '發售價']),
      boardLot: parseLabeledNumeric(text, ['每手股数', '每手股數', '每手']),
      entryFee: parseLabeledNumeric(text, ['入场费', '入場費', '每手入场费', '每手入場費']),
      statusText: /明天上市|明日上市/.test(text) ? '明天上市' : '暗盘/待上市',
    }];
  }
  return [];
}

function uniqByCode(items = []) {
  const map = new Map();
  for (const item of items) {
    if (!item || !item.code) continue;
    if (!map.has(item.code)) map.set(item.code, item);
  }
  return Array.from(map.values());
}

function uniqByName(items = []) {
  const map = new Map();
  for (const item of items) {
    if (!item || !item.name) continue;
    const key = `${item.name}|${item.statusText || ''}|${item.offerEndDate || ''}`;
    if (!map.has(key)) map.set(key, item);
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
  const { tables, tableLookup } = collectTables($);

  const matched = {
    todayGreyMarket: false,
    todayListed: false,
    subscribing: false,
    listingSoon: false,
    hearingPassed: false,
    recentNewStocks: false,
  };

  const todayListedFound = findModuleTableByTitle($, tableLookup, {
    include: ['今日上市'],
    moduleType: TABLE_TYPE.todayListed,
    exact: true,
  });
  const todayGreyMarketFound = findModuleTableByTitle($, tableLookup, {
    include: ['今日暗盘', '今日暗盤', '暗盘', '暗盤'],
    exclude: ['今日上市', '新股信息', '新股資訊'],
    moduleType: TABLE_TYPE.todayGreyMarket,
  });
  const subscribingFound = findModuleTableByTitle($, tableLookup, {
    include: ['招股中'],
    moduleType: TABLE_TYPE.subscribing,
    exact: true,
  });
  const listingSoonFound = findModuleTableByTitle($, tableLookup, {
    include: ['即将上市', '即將上市'],
    exclude: ['即将上市新股', '即將上市新股', '上市时间表', '上市時間表'],
    tableFilter: (info) => !/上市时间表|上市時間表/.test(info.text),
    moduleType: TABLE_TYPE.listingSoon,
    exact: true,
  });
  const hearingPassedFound = findModuleTableByTitle($, tableLookup, {
    include: ['申请上市', '申請上市', '通过聆讯', '通過聆訊'],
    moduleType: TABLE_TYPE.hearingPassed,
  });
  const recentNewStocksFound = findModuleTableByTitle($, tableLookup, {
    include: ['新股信息', '新股資訊', '新股消息'],
    moduleType: TABLE_TYPE.recentNewStocks,
  });

  const todayListedTable = todayListedFound.table;
  const subscribingTable = subscribingFound.table;
  const listingSoonTable = listingSoonFound.table;
  const hearingPassedTable = hearingPassedFound.table;
  const recentNewStocksTable = recentNewStocksFound.table
    || (!recentNewStocksFound.meta.anchorFound
      ? tables.find(t => includesAny(t.headers.join('|'), ['每手股数', '入场费', '认购倍数', '一手中签率', '按盘价', '累积升跌']))
      : null);
  const todayGreyMarketTable = todayGreyMarketFound.table;

  matched.todayListed = !!todayListedTable;
  matched.todayGreyMarket = !!todayGreyMarketTable;
  matched.subscribing = !!subscribingTable;
  matched.listingSoon = !!listingSoonTable;
  matched.hearingPassed = !!hearingPassedTable;
  matched.recentNewStocks = !!recentNewStocksTable;

  const parsed = {
    todayGreyMarket: parseModuleTable(todayGreyMarketTable, TABLE_TYPE.todayGreyMarket),
    todayListed: parseModuleTable(todayListedTable, TABLE_TYPE.todayListed),
    subscribing: parseModuleTable(subscribingTable, TABLE_TYPE.subscribing),
    listingSoon: parseModuleTable(listingSoonTable, TABLE_TYPE.listingSoon),
    hearingPassed: parseModuleTable(hearingPassedTable, TABLE_TYPE.hearingPassed),
    recentNewStocks: parseModuleTable(recentNewStocksTable, TABLE_TYPE.recentNewStocks),
  };
  const todayGreyMarket = parsed.todayGreyMarket.records.length > 0
    ? parsed.todayGreyMarket.records
    : parseTodayGreyMarketCard($);
  matched.todayGreyMarket = matched.todayGreyMarket || todayGreyMarket.length > 0;

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
    todayGreyMarket,
    todayListed: parsed.todayListed.records,
    hearingPassed: parsed.hearingPassed.records,
    recentNewStocks: parsed.recentNewStocks.records,
    source: 'etnet',
    fetchedAt: new Date().toISOString(),
  };

  const matchedTables = Object.keys(matched).filter(k => matched[k]);
  const filterStats = Object.values(parsed).map(x => x.filterStats).filter(Boolean);
  const boardLotMapped = result.recentNewStocks.filter(x => x.boardLot !== null && x.boardLot !== undefined).length;
  const entryFeeMapped = result.recentNewStocks.filter(x => x.entryFee !== null && x.entryFee !== undefined).length;

  console.log('[IPO][parser]', {
    matchedTables,
    modules: {
      todayGreyMarket: { matched: matched.todayGreyMarket, emptyState: false, count: result.todayGreyMarket.length },
      todayListed: { matched: parsed.todayListed.matched, emptyState: parsed.todayListed.emptyState, count: result.todayListed.length },
      subscribing: { matched: parsed.subscribing.matched, emptyState: parsed.subscribing.emptyState, count: result.subscribing.length },
      listingSoon: { matched: parsed.listingSoon.matched, emptyState: parsed.listingSoon.emptyState, count: result.listingSoon.length },
      hearingPassed: { matched: parsed.hearingPassed.matched, emptyState: parsed.hearingPassed.emptyState, count: result.hearingPassed.length },
      recentNewStocks: { matched: parsed.recentNewStocks.matched, emptyState: parsed.recentNewStocks.emptyState, count: result.recentNewStocks.length },
    },
    sample: {
      todayGreyMarket: result.todayGreyMarket[0] || null,
      todayListed: result.todayListed[0] || null,
      subscribing: result.subscribing[0] || null,
      listingSoon: result.listingSoon[0] || null,
      hearingPassed: result.hearingPassed[0] || null,
      recentNewStocks: result.recentNewStocks[0] || null,
    },
    filtered: filterStats,
    recentNewStocksMapped: { boardLotMapped, entryFeeMapped },
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
