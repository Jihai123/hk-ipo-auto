const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const cfg = require('../crawlers/etnet/config');
const { crawlIPODetail } = require('../crawlers/etnet/ipoDetail');

const BOARD_URL = process.env.ETNET_IPO_BOARD_URL || 'https://www.etnet.com.hk/www/sc/stocks/ci_ipo.php';
const DEFAULT_LIST_URL = BOARD_URL;
const PARSER_VERSION = 'etnet-board-v2';

const SOURCE_SECTIONS = {
  GREY_MARKET: 'grey_market',
  LISTED_TODAY: 'listed_today',
  TIMETABLE: 'timetable',
  SUBSCRIBING: 'subscribing',
  LISTING_SOON: 'listing_soon',
  IPO_INFO: 'ipo_info',
  HEARING_PASSED: 'hearing_passed',
};

function normalizeCode(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  return digits ? digits.padStart(5, '0').slice(-5) : null;
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(String(value).replace(/,/g, '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function parseDate(value) {
  if (!value) return null;
  const text = String(value);
  const m = text.match(/(20\d{2})[.\/-年\s]*(\d{1,2})[.\/-月\s]*(\d{1,2})/);
  if (!m) return null;
  return `${m[1]}-${String(Number(m[2])).padStart(2, '0')}-${String(Number(m[3])).padStart(2, '0')}`;
}

function text(v) {
  return String(v || '').replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractCodeFromText(v) {
  const m = String(v || '').match(/(\d{4,5})/);
  return m ? normalizeCode(m[1]) : null;
}

function safeHeaderToKey(v) {
  return text(v).toLowerCase().replace(/[\s\-_/()（）]/g, '');
}

function normalizeStatus(value) {
  const s = String(value || '').toLowerCase();
  if (s.includes('grey') || s.includes('暗盘')) return 'grey_market';
  if (s.includes('today') || s.includes('今日上市')) return 'listed_today';
  if (s.includes('subscrib') || s.includes('招股')) return 'subscribing';
  if (s.includes('listing_soon') || s.includes('即将上市')) return 'listing_soon';
  if (s.includes('hearing') || s.includes('聆讯')) return 'hearing_passed';
  if (s.includes('allotment') || s.includes('中签')) return 'allotment_pending';
  if (s.includes('listed') || s.includes('已上市')) return 'listed';
  return value || null;
}

function sectionStatus(section) {
  const map = {
    [SOURCE_SECTIONS.HEARING_PASSED]: 'hearing_passed',
    [SOURCE_SECTIONS.SUBSCRIBING]: 'subscribing',
    [SOURCE_SECTIONS.TIMETABLE]: 'allotment_pending',
    [SOURCE_SECTIONS.LISTING_SOON]: 'listing_soon',
    [SOURCE_SECTIONS.GREY_MARKET]: 'grey_market',
    [SOURCE_SECTIONS.LISTED_TODAY]: 'listed_today',
    [SOURCE_SECTIONS.IPO_INFO]: 'listed',
  };
  return map[section] || null;
}

function fetchByAliases(row, aliases = []) {
  const keys = Object.keys(row || {});
  for (const alias of aliases) {
    const cleaned = safeHeaderToKey(alias);
    const hit = keys.find((k) => safeHeaderToKey(k).includes(cleaned));
    if (hit && row[hit] !== undefined && row[hit] !== null && row[hit] !== '') return row[hit];
  }
  return null;
}

function parseTableRows($, tableEl) {
  const rows = [];
  const headers = [];
  $(tableEl).find('tr').each((rowIdx, tr) => {
    const cells = $(tr).find('th,td').toArray().map((c) => text($(c).text()));
    if (!cells.length) return;
    if (rowIdx === 0 && $(tr).find('th').length) {
      headers.push(...cells);
      return;
    }
    if (!headers.length) {
      cells.forEach((_, idx) => headers[idx] = `col_${idx}`);
    }
    const row = {};
    headers.forEach((h, idx) => {
      row[h || `col_${idx}`] = cells[idx] || null;
    });
    rows.push(row);
  });
  return rows;
}

function parseBoardSectionsFromHtml(html, { sourceUrl = BOARD_URL } = {}) {
  const $ = cheerio.load(html);
  const sections = {
    [SOURCE_SECTIONS.GREY_MARKET]: [],
    [SOURCE_SECTIONS.LISTED_TODAY]: [],
    [SOURCE_SECTIONS.TIMETABLE]: [],
    [SOURCE_SECTIONS.SUBSCRIBING]: [],
    [SOURCE_SECTIONS.LISTING_SOON]: [],
    [SOURCE_SECTIONS.IPO_INFO]: [],
    [SOURCE_SECTIONS.HEARING_PASSED]: [],
  };

  $('table').each((_, table) => {
    const title = text($(table).prevAll('h1,h2,h3,h4,.title,.section-title').first().text()) || text($(table).attr('data-section'));
    const rows = parseTableRows($, table);
    if (!rows.length) return;

    const t = title.toLowerCase();
    let section = null;
    if (/暗盤|暗盘|grey/i.test(t)) section = SOURCE_SECTIONS.GREY_MARKET;
    else if (/今日上市|listed today/i.test(t)) section = SOURCE_SECTIONS.LISTED_TODAY;
    else if (/時間表|时间表|timetable/i.test(t)) section = SOURCE_SECTIONS.TIMETABLE;
    else if (/招股中|subscribing/i.test(t)) section = SOURCE_SECTIONS.SUBSCRIBING;
    else if (/即將上市|即将上市|listing soon/i.test(t)) section = SOURCE_SECTIONS.LISTING_SOON;
    else if (/新股資訊|新股信息|ipo info/i.test(t)) section = SOURCE_SECTIONS.IPO_INFO;
    else if (/聆訊|聆讯|hearing/i.test(t)) section = SOURCE_SECTIONS.HEARING_PASSED;

    if (!section) return;

    rows.forEach((row) => {
      const code = normalizeCode(fetchByAliases(row, ['code', '代號', '代号', '股票代码']) || extractCodeFromText(fetchByAliases(row, ['名稱', '名称', 'name'])));
      const name = text(fetchByAliases(row, ['name', '名稱', '名称', '公司']) || '').replace(/\(\d{4,5}\)/g, '').trim() || null;
      const listingDate = parseDate(fetchByAliases(row, ['listing date', '上市日期']));
      const offerEndDate = parseDate(fetchByAliases(row, ['offer end', '截止', '截止認購', '截止认购']));
      const record = {
        code,
        name,
        listing_date: listingDate,
        offer_end_date: offerEndDate,
        currency: fetchByAliases(row, ['currency', '幣別', '货币']),
        ipo_price: toNumber(fetchByAliases(row, ['ipo', '招股價', '招股价', 'price'])),
        offer_price_range: fetchByAliases(row, ['招股價', '招股价区间', 'price range']),
        lot_size: toNumber(fetchByAliases(row, ['lot size', '每手', '每手股數', '每手股数'])),
        lot_cost: toNumber(fetchByAliases(row, ['lot cost', '入場費', '入场费'])),
        subscription_multiple: toNumber(fetchByAliases(row, ['認購倍數', '认购倍数', 'subscription multiple'])),
        guaranteed_lot: fetchByAliases(row, ['穩獲一手', '稳获一手', 'guaranteed lot']),
        success_rate: toNumber(fetchByAliases(row, ['中籤率', '中签率', 'success rate'])),
        hammer_lot_count: toNumber(fetchByAliases(row, ['甲組', '甲组', 'hammer lot'])),
        current_price: toNumber(fetchByAliases(row, ['現價', '现价', 'current'])),
        change: toNumber(fetchByAliases(row, ['change', '升跌'])),
        change_pct: toNumber(fetchByAliases(row, ['change%', '升跌%', '升跌幅'])),
        open_price: toNumber(fetchByAliases(row, ['open', '開市', '开盘'])),
        high_price: toNumber(fetchByAliases(row, ['high', '最高'])),
        low_price: toNumber(fetchByAliases(row, ['low', '最低'])),
        turnover: toNumber(fetchByAliases(row, ['turnover', '成交額', '成交额'])),
        first_day_open_price: toNumber(fetchByAliases(row, ['首日開', '首日开'])),
        current_or_last_price: toNumber(fetchByAliases(row, ['現價', '现价', '收市'])),
        cumulative_return: toNumber(fetchByAliases(row, ['累計回報', '累计回报', '累計升跌'])),
        prospectus_link: $(table).find('a[href*="prospectus"],a[href*="hkexnews"]').first().attr('href') || null,
        status: sectionStatus(section),
        source_section: section,
        source_url: sourceUrl,
        fetched_at: new Date().toISOString(),
        parser_version: PARSER_VERSION,
      };

      if (section === SOURCE_SECTIONS.GREY_MARKET) {
        record.grey_quotes = [];
        const broker = fetchByAliases(row, ['broker', '券商']);
        if (broker) {
          record.grey_quotes.push({
            broker,
            grey_price: toNumber(fetchByAliases(row, ['暗盤價', '暗盘价', 'grey price'])),
            grey_change: toNumber(fetchByAliases(row, ['暗盤升跌', '暗盘升跌', 'grey change'])),
            grey_change_pct: toNumber(fetchByAliases(row, ['暗盤升跌%', '暗盘升跌%'])),
            grey_high: toNumber(fetchByAliases(row, ['暗盤高', '暗盘高', 'grey high'])),
            grey_low: toNumber(fetchByAliases(row, ['暗盤低', '暗盘低', 'grey low'])),
            grey_volume: toNumber(fetchByAliases(row, ['成交量', 'volume'])),
            lot_profit: toNumber(fetchByAliases(row, ['每手賺蝕', '每手赚蚀', 'lot profit'])),
          });
        }
      }

      sections[section].push(record);
    });
  });

  const all = Object.values(sections).flat().filter((r) => r.code || r.name);
  return { sections, all };
}

function inferStatusByTimeline(base = {}) {
  const now = new Date().toISOString().slice(0, 10);
  if (base.offer_end_date && base.offer_end_date >= now) return 'subscribing';
  if (base.listing_date) {
    if (base.listing_date === now) return 'listed_today';
    if (base.listing_date > now) return 'listing_soon';
    return 'listed';
  }
  return base.status || null;
}

function pickFirst(arr, mapper) {
  for (const item of arr) {
    const v = mapper(item);
    if (v !== null && v !== undefined && v !== '') return v;
  }
  return null;
}

function buildFusionRecord(code, grouped, detail, sourceUrl) {
  const entries = grouped || [];
  const bySection = (s) => entries.filter((x) => x.source_section === s);

  const nameFromList = pickFirst(entries, (e) => e.name);
  const detailName = (detail && detail.name && detail?._debug?.fieldEvidence?.name && !/title|body/i.test(detail._debug.fieldEvidence.name.parserRule || '')) ? detail.name : null;
  const name = nameFromList || detailName || null;

  const statusFromSection = pickFirst(entries, (e) => sectionStatus(e.source_section));
  const status = normalizeStatus(statusFromSection || inferStatusByTimeline(pickFirst(entries, (e) => e) || {}));

  const offerPrice = pickFirst(entries, (e) => e.ipo_price || toNumber(e.offer_price));
  const lotSize = pickFirst(entries, (e) => e.lot_size) || toNumber(detail?.lotSize);
  const lotCost = pickFirst(entries, (e) => e.lot_cost) || (Number.isFinite(offerPrice) && Number.isFinite(lotSize) ? offerPrice * lotSize : null);

  const subSources = [SOURCE_SECTIONS.IPO_INFO, SOURCE_SECTIONS.LISTING_SOON, SOURCE_SECTIONS.GREY_MARKET]
    .map((s) => bySection(s))
    .flat();

  const currentSources = [SOURCE_SECTIONS.LISTED_TODAY, SOURCE_SECTIONS.GREY_MARKET, SOURCE_SECTIONS.IPO_INFO]
    .map((s) => bySection(s))
    .flat();

  const fieldSources = {
    name: nameFromList ? entries.find((x) => x.name === nameFromList)?.source_section : (detailName ? 'detail' : 'fallback'),
    status: statusFromSection ? entries.find((x) => sectionStatus(x.source_section) === statusFromSection)?.source_section : 'timeline_infer',
    offer_price: pickFirst(entries, (e) => e.ipo_price) !== null ? 'board' : (detail?.offerPriceMid ? 'detail' : 'fallback'),
    lot_size: pickFirst(entries, (e) => e.lot_size) !== null ? 'board' : (detail?.lotSize ? 'detail' : 'fallback'),
    lot_cost: pickFirst(entries, (e) => e.lot_cost) !== null ? 'board' : 'derived',
    subscription_multiple: pickFirst(subSources, (e) => e.subscription_multiple) !== null ? 'board' : 'fallback',
    success_rate: pickFirst(subSources, (e) => e.success_rate) !== null ? 'board' : 'fallback',
    current_price: pickFirst(currentSources, (e) => e.current_price || e.current_or_last_price) !== null ? 'board' : 'fallback',
  };

  const topGrey = pickFirst(bySection(SOURCE_SECTIONS.GREY_MARKET), (e) => (e.grey_quotes || [])[0]);
  const sourceCoverage = Array.from(new Set(entries.map((e) => e.source_section)));

  const record = {
    code,
    name,
    status,
    listing_date: pickFirst(entries, (e) => e.listing_date) || parseDate(detail?.listingDate),
    offer_end_date: pickFirst(entries, (e) => e.offer_end_date) || parseDate(detail?.subscriptionEndDate),
    offer_price: offerPrice,
    offer_price_range: pickFirst(entries, (e) => e.offer_price_range) || detail?.offerPrice || null,
    lot_size: lotSize,
    lot_cost: lotCost,
    subscription_multiple: pickFirst(subSources, (e) => e.subscription_multiple) || toNumber(detail?.subscriptionMultiple),
    guaranteed_lot: pickFirst(subSources, (e) => e.guaranteed_lot),
    success_rate: pickFirst(subSources, (e) => e.success_rate) || toNumber(detail?.allotmentRate),
    current_price: pickFirst(currentSources, (e) => e.current_price || e.current_or_last_price),
    cumulative_return: pickFirst(currentSources, (e) => e.cumulative_return),
    grey_market_top_quote: topGrey || null,
    industry: detail?.industry || null,
    market: detail?.market || null,
    sponsor: detail?.sponsor || null,
    underwriters: detail?.underwriters || null,
    offer_price_mid: toNumber(detail?.offerPriceMid),
    market_cap: toNumber(detail?.marketCapMid),
    nav_per_share: toNumber(detail?.navPerShare),
    offered_shares: toNumber(detail?.totalShares),
    ipo_source_meta: sourceCoverage.map((source_section) => ({
      code,
      source_section,
      source_url: sourceUrl,
      fetched_at: new Date().toISOString(),
      parser_version: PARSER_VERSION,
    })),
    _source: {
      field_sources: fieldSources,
      status_evidence: statusFromSection ? 'board_section' : 'timeline_infer',
      name_evidence: fieldSources.name,
      source_sections: sourceCoverage,
      list_source: sourceUrl,
      detail_source: `${cfg.baseURL}${cfg.urls.ipoDetail(code)}`,
      fallback_source: 'local_or_derived',
    },
  };

  const important = ['name', 'status', 'listing_date', 'offer_price', 'lot_size', 'lot_cost', 'subscription_multiple', 'success_rate', 'current_price'];
  const filled = important.filter((k) => record[k] !== null && record[k] !== undefined && record[k] !== '').length;
  record.data_completeness = Number(((filled / important.length) * 100).toFixed(2));
  record.source_coverage = sourceCoverage.length;
  return record;
}

function loadFixtureData() {
  const fixtureDir = path.join(__dirname, '../tests/fixtures/etnet');
  const boardFiles = {
    ipoBoard: path.join(fixtureDir, 'ipo-board.html'),
    greyMarket: path.join(fixtureDir, 'grey-market.html'),
    listedToday: path.join(fixtureDir, 'listed-today.html'),
    subscribing: path.join(fixtureDir, 'subscribing.html'),
  };
  return { fixtureDir, boardFiles };
}

async function fetchBoardHtml({ verbose = false } = {}) {
  const res = await axios.get(BOARD_URL, {
    timeout: 20000,
    headers: cfg.headers,
    validateStatus: () => true,
  });
  if (verbose) console.log(`[etnetSource] board ${BOARD_URL} status=${res.status}`);
  if (res.status >= 400) throw new Error(`HTTP ${res.status} while fetching board page`);
  return { html: res.data, status: res.status, url: BOARD_URL };
}

async function fetchIPODetailRecord(code, { verbose = false, noCache = false } = {}) {
  const normalizedCode = normalizeCode(code);
  const detail = await crawlIPODetail(normalizedCode, { noCache });
  if (verbose) console.log(`[etnetSource] detail ${normalizedCode} status=${detail?._fetchStatus?.status}`);
  return { record: detail, raw: detail };
}

async function fetchIPOBatch({ limit = 20, verbose = false } = {}) {
  const mode = process.env.IPO_DATA_MODE || 'live';
  let parsed;
  let sourceUrl = BOARD_URL;
  let listMeta = { url: BOARD_URL, status: null };

  if (mode === 'fixture') {
    const fixture = loadFixtureData();
    const htmlParts = Object.values(fixture.boardFiles).filter((file) => fs.existsSync(file)).map((file) => fs.readFileSync(file, 'utf-8'));
    if (!htmlParts.length) throw new Error('fixture board html not found');
    parsed = parseBoardSectionsFromHtml(htmlParts.join('\n'), { sourceUrl: fixture.fixtureDir });
    sourceUrl = fixture.fixtureDir;
    listMeta = { url: fixture.fixtureDir, status: 200 };
  } else {
    const board = await fetchBoardHtml({ verbose });
    parsed = parseBoardSectionsFromHtml(board.html, { sourceUrl: board.url });
    sourceUrl = board.url;
    listMeta = { url: board.url, status: board.status };
  }

  const codeSet = new Set(parsed.all.map((x) => x.code).filter(Boolean));
  const codes = Array.from(codeSet).slice(0, limit);
  const items = [];
  const warnings = [];

  for (const code of codes) {
    try {
      const grouped = parsed.all.filter((x) => x.code === code);
      const detail = mode === 'fixture' ? {} : (await fetchIPODetailRecord(code, { verbose })).raw;
      const fused = buildFusionRecord(code, grouped, detail, sourceUrl);
      items.push(fused);
    } catch (error) {
      warnings.push({ code, message: error.message });
      if (verbose) console.warn(`[etnetSource] warning ${code}: ${error.message}`);
    }
  }

  return {
    mode,
    fetched_at: new Date().toISOString(),
    list_meta: listMeta,
    total_codes: codeSet.size,
    section_counts: Object.fromEntries(Object.entries(parsed.sections).map(([k, arr]) => [k, arr.length])),
    items,
    warnings,
  };
}

module.exports = {
  SOURCE_SECTIONS,
  fetchIPODetailRecord,
  fetchIPOBatch,
  parseBoardSectionsFromHtml,
  normalizeCode,
  toNumber,
  parseDate,
};
