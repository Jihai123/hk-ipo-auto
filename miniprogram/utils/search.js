const SEARCH_HISTORY_KEY = 'hk_ipo_recent_searches_v1';
const SEARCH_HISTORY_LIMIT = 6;

function sanitizeCodeInput(raw = '') {
  return String(raw).trim().replace(/\D/g, '');
}

function normalizeStockCode(raw = '') {
  const digits = sanitizeCodeInput(raw);
  if (!digits) {
    return { ok: false, code: '', message: '请输入股票代码' };
  }

  if (digits.length > 5) {
    return { ok: false, code: '', message: '股票代码最多 5 位数字' };
  }

  return {
    ok: true,
    code: digits.padStart(5, '0'),
    message: '',
  };
}

function loadSearchHistory() {
  try {
    const list = wx.getStorageSync(SEARCH_HISTORY_KEY);
    if (!Array.isArray(list)) return [];
    return list.filter(item => /^\d{5}$/.test(item));
  } catch (_) {
    return [];
  }
}

function saveSearchHistory(list = []) {
  try {
    wx.setStorageSync(SEARCH_HISTORY_KEY, list.slice(0, SEARCH_HISTORY_LIMIT));
  } catch (_) {
    // ignore storage failures
  }
}

function pushSearchHistory(code) {
  if (!/^\d{5}$/.test(code)) return loadSearchHistory();
  const current = loadSearchHistory();
  const next = [code, ...current.filter(item => item !== code)].slice(0, SEARCH_HISTORY_LIMIT);
  saveSearchHistory(next);
  return next;
}

module.exports = {
  SEARCH_HISTORY_LIMIT,
  sanitizeCodeInput,
  normalizeStockCode,
  loadSearchHistory,
  pushSearchHistory,
};
