const fs = require('fs');
const path = require('path');

const CACHE_PATH = path.join(__dirname, '../../data/ipo-static-fields-cache.json');
const CACHED_FIELDS = ['offerPriceMid', 'totalShares', 'industry'];

function normalizeCode(code) {
  return String(code || '').replace(/\D/g, '').padStart(5, '0');
}

function readCacheFile() {
  if (!fs.existsSync(CACHE_PATH)) {
    return { updatedAt: null, items: {} };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return { updatedAt: null, items: {} };
    return {
      updatedAt: parsed.updatedAt || null,
      items: parsed.items && typeof parsed.items === 'object' ? parsed.items : {},
    };
  } catch (error) {
    console.warn(`[ipoFieldCache] 读取缓存失败: ${error.message}`);
    return { updatedAt: null, items: {} };
  }
}

function writeCacheFile(payload) {
  fs.writeFileSync(CACHE_PATH, JSON.stringify(payload, null, 2), 'utf8');
}

function pickStaticFields(source = {}) {
  const picked = {};
  for (const field of CACHED_FIELDS) {
    const value = source[field];
    if (value === null || value === undefined || value === '') continue;
    if ((field === 'offerPriceMid' || field === 'totalShares') && !Number.isFinite(value)) continue;
    picked[field] = value;
  }
  return picked;
}

function getIPOStaticFieldCache(code) {
  const normalizedCode = normalizeCode(code);
  const payload = readCacheFile();
  const entry = payload.items[normalizedCode];
  if (!entry || typeof entry !== 'object') return null;
  const fields = pickStaticFields(entry);
  return Object.keys(fields).length > 0
    ? { code: normalizedCode, fields, cachedAt: entry.cachedAt || payload.updatedAt || null }
    : null;
}

function updateIPOStaticFieldCache(code, source = {}) {
  const normalizedCode = normalizeCode(code);
  const payload = readCacheFile();
  const fields = pickStaticFields(source);
  if (Object.keys(fields).length === 0) return null;

  const existing = payload.items[normalizedCode] && typeof payload.items[normalizedCode] === 'object'
    ? payload.items[normalizedCode]
    : {};

  payload.items[normalizedCode] = {
    ...existing,
    ...fields,
    cachedAt: new Date().toISOString(),
  };
  payload.updatedAt = new Date().toISOString();
  writeCacheFile(payload);

  return {
    code: normalizedCode,
    fields: pickStaticFields(payload.items[normalizedCode]),
    cachedAt: payload.items[normalizedCode].cachedAt,
  };
}

module.exports = {
  CACHED_FIELDS,
  getIPOStaticFieldCache,
  updateIPOStaticFieldCache,
};
