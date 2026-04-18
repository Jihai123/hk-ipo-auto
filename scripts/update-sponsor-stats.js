#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const { crawlIPOListFromETNet } = require('../crawlers/etnet/ipoList');
const { crawlIPODetail } = require('../crawlers/etnet/ipoDetail');

const DATA_DIR = path.join(__dirname, '..', 'data');
const SPONSORS_BASE_PATH = path.join(DATA_DIR, 'sponsors.json');
const SPONSORS_CURRENT_PATH = path.join(DATA_DIR, 'sponsors.current.json');
const SPONSOR_RECORDS_PATH = path.join(DATA_DIR, 'sponsor-ipo-records.json');
const SPONSOR_ALIAS_MAP_PATH = path.join(DATA_DIR, 'sponsor-alias-map.json');
const SPONSOR_UNMATCHED_PATH = path.join(DATA_DIR, 'sponsor-unmatched.json');

const RECENT_WINDOW_DAYS = 3;

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (error) {
    console.warn(`[sponsorUpdate][warn] readJson failed: ${filePath}`, error.message);
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
}

function normalizeSponsorName(name = '') {
  return String(name || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')')
    .replace(/[，、]/g, ',')
    .replace(/[。]/g, '.')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s*([(),.])\s*/g, '$1')
    .replace(/,+/g, ',')
    .trim();
}

function buildNormalizedSponsorIndex(sponsorStats = {}) {
  const normalizedIndex = new Map();
  for (const canonicalName of Object.keys(sponsorStats || {})) {
    const normalized = normalizeSponsorName(canonicalName);
    if (!normalized) continue;
    if (!normalizedIndex.has(normalized)) normalizedIndex.set(normalized, []);
    normalizedIndex.get(normalized).push(canonicalName);
  }
  return normalizedIndex;
}

function resolveSponsorIdentity(rawName, sponsorStats = {}, aliasMap = {}, normalizedIndex = null) {
  const normalizedName = normalizeSponsorName(rawName);
  const index = normalizedIndex || buildNormalizedSponsorIndex(sponsorStats);
  let mappedName = null;

  if (rawName && Object.prototype.hasOwnProperty.call(sponsorStats, rawName)) {
    return {
      rawName,
      normalizedName,
      mappedName,
      matched: true,
      canonicalName: rawName,
      method: 'direct',
      confidence: 'high',
      reason: 'raw_name_hit',
      sponsorStatsHit: true,
    };
  }

  const normalizedCandidates = index.get(normalizedName) || [];
  if (normalizedCandidates.length === 1) {
    return {
      rawName,
      normalizedName,
      mappedName,
      matched: true,
      canonicalName: normalizedCandidates[0],
      method: 'normalized',
      confidence: 'high',
      reason: 'normalized_name_hit',
      sponsorStatsHit: true,
    };
  }

  mappedName = aliasMap[rawName] || aliasMap[normalizedName] || null;
  if (mappedName) {
    const sponsorStatsHit = Object.prototype.hasOwnProperty.call(sponsorStats, mappedName);
    return {
      rawName,
      normalizedName,
      mappedName,
      matched: sponsorStatsHit,
      canonicalName: sponsorStatsHit ? mappedName : null,
      method: sponsorStatsHit ? 'alias_map' : 'unmatched',
      confidence: sponsorStatsHit ? 'high' : 'low',
      reason: sponsorStatsHit ? 'alias_map_hit' : 'alias_mapped_name_not_in_sponsor_stats',
      sponsorStatsHit,
    };
  }

  return {
    rawName,
    normalizedName,
    mappedName,
    matched: false,
    canonicalName: null,
    method: 'unmatched',
    confidence: 'low',
    reason: 'no_direct_normalized_or_alias_match',
    sponsorStatsHit: false,
  };
}

function toDateOnly(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const normalized = text.replace(/[.年\/]/g, '-').replace(/月/g, '-').replace(/日/g, '');
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    const m = text.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (!m) return null;
    return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  }
  return date.toISOString().slice(0, 10);
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function listRecentListed(ipoList, windowDays) {
  const all = [
    ...(ipoList?.todayListed || []),
    ...(ipoList?.recentListed || []),
    ...(ipoList?.recentNewStocks || []),
  ];
  const today = new Date();
  const floor = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  floor.setUTCDate(floor.getUTCDate() - windowDays);

  const dedup = new Map();
  for (const item of all) {
    const stockCode = String(item?.stockCode || '').padStart(5, '0');
    const listingDate = toDateOnly(item?.listingDate);
    if (!stockCode || !listingDate) continue;
    if (new Date(`${listingDate}T00:00:00Z`) < floor) continue;
    const key = `${stockCode}|${listingDate}`;
    if (!dedup.has(key)) dedup.set(key, { ...item, stockCode, listingDate });
  }
  return [...dedup.values()];
}

function mergeByKey(records = []) {
  const map = new Map();
  for (const record of records) {
    if (!record?.stockCode || !record?.listingDate) continue;
    map.set(`${record.stockCode}|${record.listingDate}`, record);
  }
  return [...map.values()].sort((a, b) => `${a.stockCode}${a.listingDate}`.localeCompare(`${b.stockCode}${b.listingDate}`));
}

function getDisplayName(detail, fallback = null) {
  return detail?.namechitc || detail?.namechisc || detail?.nameeng || fallback || null;
}

function canonicalizeSponsors(rawSponsors, sponsorStats, aliasMap, normalizedIndex, unmatchedPool, context = {}) {
  const rawList = [...new Set((rawSponsors || []).map(v => String(v || '').trim()).filter(Boolean))];
  const canonicalSet = new Set();

  for (const rawName of rawList) {
    const resolved = resolveSponsorIdentity(rawName, sponsorStats, aliasMap, normalizedIndex);
    console.log('[sponsorUpdate][resolve]', {
      rawName,
      canonicalName: resolved.canonicalName,
      matched: resolved.matched,
      method: resolved.method,
      reason: resolved.reason,
    });
    if (resolved.matched && resolved.canonicalName) {
      canonicalSet.add(resolved.canonicalName);
    } else {
      unmatchedPool.push({
        stockCode: context.stockCode || null,
        listingDate: context.listingDate || null,
        rawName,
        normalizedName: resolved.normalizedName,
        reason: resolved.reason,
        at: new Date().toISOString(),
      });
    }
  }

  return {
    sponsorsRaw: rawList,
    sponsorsCanonical: [...canonicalSet],
  };
}

function buildCurrentStats(baseStats, records) {
  const baseWinCounts = new Map();
  const incr = new Map();

  for (const [name, stat] of Object.entries(baseStats || {})) {
    const count = toNumber(stat?.count) || 0;
    const winRate = toNumber(stat?.winRate) || 0;
    const baseWinCount = Math.round(count * winRate / 100);
    baseWinCounts.set(name, { count, winCount: baseWinCount });
    incr.set(name, { incrCount: 0, incrWinCount: 0 });
  }

  for (const record of records) {
    const isUp = record?.isUpOnDebut === true;
    for (const sponsorName of (record?.sponsorsCanonical || [])) {
      if (!incr.has(sponsorName)) incr.set(sponsorName, { incrCount: 0, incrWinCount: 0 });
      const entry = incr.get(sponsorName);
      entry.incrCount += 1;
      if (isUp) entry.incrWinCount += 1;
    }
  }

  const allNames = new Set([...baseWinCounts.keys(), ...incr.keys()]);
  const out = {};
  for (const name of allNames) {
    const base = baseWinCounts.get(name) || { count: 0, winCount: 0 };
    const delta = incr.get(name) || { incrCount: 0, incrWinCount: 0 };
    const totalCount = base.count + delta.incrCount;
    const totalWinCount = base.winCount + delta.incrWinCount;
    if (totalCount <= 0) continue;
    out[name] = {
      count: totalCount,
      winRate: round2((totalWinCount / totalCount) * 100),
    };
  }

  return out;
}

async function main() {
  const sponsorStatsBase = readJson(SPONSORS_BASE_PATH, {});
  const sponsorAliasMap = readJson(SPONSOR_ALIAS_MAP_PATH, {});
  const records = readJson(SPONSOR_RECORDS_PATH, []);
  const unmatched = readJson(SPONSOR_UNMATCHED_PATH, []);

  const normalizedIndex = buildNormalizedSponsorIndex(sponsorStatsBase);

  const existingMap = new Map(mergeByKey(records).map(r => [`${r.stockCode}|${r.listingDate}`, r]));

  let ipoList = null;
  try {
    ipoList = await crawlIPOListFromETNet();
  } catch (error) {
    console.warn('[sponsorUpdate][warn] ETNet IPO list crawl failed, fallback to data/ipo-list.json', error.message);
    ipoList = readJson(path.join(DATA_DIR, 'ipo-list.json'), null);
    if (!ipoList) throw error;
  }
  const recentListed = listRecentListed(ipoList, RECENT_WINDOW_DAYS);
  console.log('[sponsorUpdate][scan]', {
    scannedCount: recentListed.length,
    recentWindowDays: RECENT_WINDOW_DAYS,
  });

  let addedCount = 0;

  for (const item of recentListed) {
    const stockCode = String(item.stockCode || '').padStart(5, '0');
    const listingDate = toDateOnly(item.listingDate);
    if (!stockCode || !listingDate) continue;

    const key = `${stockCode}|${listingDate}`;
    if (existingMap.has(key)) {
      console.log('[sponsorUpdate][skip]', { stockCode, listingDate, reason: 'alreadyProcessed' });
      continue;
    }

    let detail = null;
    try {
      detail = await crawlIPODetail(stockCode);
    } catch (error) {
      console.warn('[sponsorUpdate][warn] ETNet IPO detail crawl failed', { stockCode, message: error.message });
    }
    const sponsorsFromEtnet = Array.isArray(detail?.sponsors) ? detail.sponsors : [];

    const { sponsorsRaw, sponsorsCanonical } = canonicalizeSponsors(
      sponsorsFromEtnet,
      sponsorStatsBase,
      sponsorAliasMap,
      normalizedIndex,
      unmatched,
      { stockCode, listingDate },
    );

    const ipoPrice = toNumber(item.offerPrice) ?? toNumber(detail?.offerPriceMid);
    const closePrice = toNumber(item.firstDayClose);

    if (!Number.isFinite(ipoPrice) || !Number.isFinite(closePrice)) {
      console.log('[sponsorUpdate][skip]', {
        stockCode,
        listingDate,
        reason: 'missingDebutPrice',
        ipoPrice,
        closePrice,
      });
      continue;
    }

    const changePct = round2(((closePrice - ipoPrice) / ipoPrice) * 100);
    const isUpOnDebut = changePct > 0;

    console.log('[sponsorUpdate][debut]', {
      stockCode,
      ipoPrice,
      closePrice,
      changePct,
      isUpOnDebut,
    });

    const now = new Date().toISOString();
    const record = {
      stockCode,
      listingDate,
      displayName: item.name || getDisplayName(detail, item.name) || stockCode,
      legalCompanyName: getDisplayName(detail, null),
      sponsorsRaw,
      sponsorsCanonical,
      ipoPrice,
      closePrice,
      changePct,
      isUpOnDebut,
      source: {
        company: 'etnet',
        sponsor: sponsorsFromEtnet.length > 0 ? 'etnet' : 'none',
        price: 'etnet',
      },
      processedAt: now,
      updatedAt: now,
    };

    existingMap.set(key, record);
    addedCount += 1;
    console.log('[sponsorUpdate][recordSaved]', { stockCode, listingDate });
  }

  const mergedRecords = mergeByKey([...existingMap.values()]);
  const currentStats = buildCurrentStats(sponsorStatsBase, mergedRecords);

  writeJson(SPONSOR_RECORDS_PATH, mergedRecords);
  writeJson(SPONSORS_CURRENT_PATH, currentStats);
  const unmatchedKeyed = new Map();
  for (const item of unmatched) {
    const key = `${item.stockCode || ''}|${item.listingDate || ''}|${item.rawName || ''}|${item.reason || ''}`;
    if (!unmatchedKeyed.has(key)) unmatchedKeyed.set(key, item);
  }
  writeJson(SPONSOR_UNMATCHED_PATH, [...unmatchedKeyed.values()]);

  console.log('[sponsorUpdate][aggregate]', {
    sponsorCount: Object.keys(currentStats).length,
    newRecordCount: addedCount,
    totalRecordCount: mergedRecords.length,
    currentSource: 'sponsors.base + sponsor-ipo-records',
  });
}

main().catch((error) => {
  console.error('[sponsorUpdate][fatal]', error);
  process.exitCode = 1;
});
