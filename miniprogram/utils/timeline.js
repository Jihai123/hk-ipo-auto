function formatUpdatedAt(value) {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${d} ${hh}:${mm}`;
}

function normalizeText(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const str = String(value).trim();
  return str || fallback;
}

function buildGroups(summary = {}) {
  return {
    todayGreyMarket: Array.isArray(summary.todayGreyMarket) ? summary.todayGreyMarket : [],
    todayListed: Array.isArray(summary.todayListed) ? summary.todayListed : [],
    subscribing: Array.isArray(summary.subscribing) ? summary.subscribing : [],
    listingSoon: Array.isArray(summary.listingSoon) ? summary.listingSoon : [],
    hearingPassed: Array.isArray(summary.hearingPassed) ? summary.hearingPassed : [],
    recentNewStocks: Array.isArray(summary.recentNewStocks) ? summary.recentNewStocks : [],
    recentListed: Array.isArray(summary.recentListed) ? summary.recentListed : [],
  };
}

module.exports = {
  formatUpdatedAt,
  normalizeText,
  buildGroups,
};
