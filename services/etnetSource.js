const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const cfg = require('../crawlers/etnet/config');
const { crawlIPODetail } = require('../crawlers/etnet/ipoDetail');

const DEFAULT_LIST_URL = 'https://stocks.etnetchina.cn/stocks';

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
  const normalized = String(value).replace(/[.]/g, '-').replace(/\//g, '-').trim();
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

async function fetchStockCodesFromPage(url = DEFAULT_LIST_URL, verbose = false) {
  const res = await axios.get(url, {
    timeout: 15000,
    headers: cfg.headers,
    validateStatus: () => true,
  });

  if (verbose) {
    console.log(`[etnetSource] URL=${url} status=${res.status}`);
  }

  if (res.status >= 400) {
    throw new Error(`HTTP ${res.status} while fetching list page`);
  }

  const $ = cheerio.load(res.data);
  const codes = new Set();
  $('a[href*="code="]').each((_, a) => {
    const href = $(a).attr('href') || '';
    const m = href.match(/code=(\d{1,5})/);
    if (m) codes.add(normalizeCode(m[1]));
  });

  if (codes.size === 0) {
    String(res.data).replace(/code=(\d{1,5})/g, (_, code) => {
      codes.add(normalizeCode(code));
      return _;
    });
  }

  return {
    url,
    status: res.status,
    codes: Array.from(codes).filter(Boolean),
  };
}

function mapDetailToDashboard(detail) {
  const lotSize = toNumber(detail.lotSize);
  const offerPrice = toNumber(detail.offerPriceMid || detail.offerPrice);
  const lotCost = Number.isFinite(lotSize) && Number.isFinite(offerPrice) ? lotSize * offerPrice : null;

  return {
    code: normalizeCode(detail.code),
    name: detail.name || null,
    status: detail.status || null,
    listing_date: parseDate(detail.listingDate),
    offer_price: offerPrice,
    lot_size: lotSize,
    lot_cost: lotCost,
    subscription_multiple: toNumber(detail.subscriptionMultiple),
    success_rate: toNumber(detail.allotmentRate),
    first_day_close: toNumber(detail.firstDayClose),
    source_url: `${cfg.baseURL}${cfg.urls.ipoDetail(normalizeCode(detail.code))}`,
  };
}

function loadFixtureData() {
  const fixtureDir = path.join(__dirname, '../tests/fixtures/etnet');
  const files = fs.existsSync(fixtureDir) ? fs.readdirSync(fixtureDir).filter((f) => f.endsWith('.html')) : [];
  const codes = files.map((f) => normalizeCode(path.basename(f, '.html'))).filter(Boolean);
  return { codes, fixtureDir };
}

async function fetchIPODetailRecord(code, { verbose = false } = {}) {
  const normalizedCode = normalizeCode(code);
  const detail = await crawlIPODetail(normalizedCode);
  const record = mapDetailToDashboard(detail);
  if (verbose) {
    console.log(`[etnetSource] detail ${normalizedCode}`, record);
  }
  return { record, raw: detail };
}

async function fetchIPOBatch({ limit = 20, verbose = false } = {}) {
  const mode = process.env.IPO_DATA_MODE || 'live';
  let codes = [];
  let listMeta = { url: DEFAULT_LIST_URL, status: null };

  if (mode === 'fixture') {
    const fixture = loadFixtureData();
    codes = fixture.codes;
    listMeta = { url: fixture.fixtureDir, status: 200 };
    const items = codes.slice(0, limit).map((code, idx) => ({
      code,
      name: `Fixture IPO ${code}`,
      status: idx % 2 === 0 ? 'subscribing' : 'coming',
      listing_date: null,
      offer_price: null,
      lot_size: null,
      lot_cost: null,
      subscription_multiple: null,
      success_rate: null,
      first_day_close: null,
      source_url: path.join(fixture.fixtureDir, `${code}.html`),
    }));
    return {
      mode,
      fetched_at: new Date().toISOString(),
      list_meta: listMeta,
      total_codes: codes.length,
      items,
      warnings: [],
    };
  } else {
    const listResult = await fetchStockCodesFromPage(DEFAULT_LIST_URL, verbose);
    codes = listResult.codes;
    listMeta = { url: listResult.url, status: listResult.status };
  }

  const target = codes.slice(0, limit);
  const items = [];
  const warnings = [];

  for (const code of target) {
    try {
      const { record, raw } = await fetchIPODetailRecord(code, { verbose });
      record.name = record.name || raw.name || `IPO ${code}`;
      record.status = record.status || raw._fetchStatus?.status || 'unknown';
      items.push(record);
    } catch (error) {
      warnings.push({ code, message: error.message });
      console.warn(`[etnetSource] warning: ${code} ${error.message}`);
    }
  }

  return {
    mode,
    fetched_at: new Date().toISOString(),
    list_meta: listMeta,
    total_codes: codes.length,
    items,
    warnings,
  };
}

module.exports = {
  fetchStockCodesFromPage,
  fetchIPODetailRecord,
  fetchIPOBatch,
  normalizeCode,
  toNumber,
  parseDate,
};
