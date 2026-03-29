function toNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toText(value, fallback = '--') {
  return (value === null || value === undefined || value === '') ? fallback : String(value);
}

function isListedStatus(item = {}) {
  const statusText = String(item.status || item.stage || item.phase || item.tag || '').toLowerCase();
  if (!statusText) return true;
  if (/subscribing|listingsoon|招股|待上市|即将上市|明天上市/.test(statusText)) return false;
  if (/recentlisted|listed|已上市|上市/.test(statusText)) return true;
  return true;
}


function isAlreadyListed(item = {}) {
  const rawDate = String(item.listingDate || '').trim();
  if (!rawDate) return true;

  const normalized = rawDate.replace(/\./g, '-').replace(/\//g, '-');
  const date = new Date(`${normalized}T00:00:00`);
  if (Number.isNaN(date.getTime())) return true;

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return date.getTime() <= today.getTime();
}

function pickMainPerformance(item = {}) {
  const firstDay = toNumber(item.firstDayChangePct);
  const cumulative = toNumber(item.cumulativeReturn);
  if (Number.isFinite(firstDay)) return firstDay;
  if (Number.isFinite(cumulative)) return cumulative;
  return null;
}

function hasPerformanceData(item = {}) {
  return Number.isFinite(pickMainPerformance(item));
}

function isRecentListedPerformance(item = {}) {
  return isListedStatus(item) && isAlreadyListed(item) && hasPerformanceData(item);
}

function normalizeRecentListedPerformance(item = {}) {
  const firstDay = toNumber(item.firstDayChangePct);
  const cumulative = toNumber(item.cumulativeReturn);
  const perf = Number.isFinite(firstDay) ? firstDay : cumulative;
  const isUp = Number.isFinite(perf) && perf > 0;
  const isDown = Number.isFinite(perf) && perf < 0;

  return {
    code: item.code || '',
    codeText: item.code || '--',
    nameText: item.name || item.code || '--',
    listingDateText: toText(item.listingDate, ''),
    perfText: Number.isFinite(perf) ? `${perf > 0 ? '+' : ''}${perf.toFixed(2)}%` : '--',
    perfArrow: isUp ? '▲' : isDown ? '▼' : '•',
    perfClass: isUp ? 'perf-up' : isDown ? 'perf-down' : 'perf-flat',
    metrics: [
      { label: '上市价', value: toText(item.offerPrice, '') },
      { label: '累积回报', value: Number.isFinite(cumulative) ? `${cumulative > 0 ? '+' : ''}${cumulative.toFixed(2)}%` : '' },
      { label: '首日表现', value: Number.isFinite(firstDay) ? `${firstDay > 0 ? '+' : ''}${firstDay.toFixed(2)}%` : '' },
      { label: '认购倍数', value: toText(item.subscriptionMultiple, '') },
      { label: '中签率', value: toText(item.allotmentRate, '') },
    ].filter((m) => m.value).slice(0, 2),
  };
}

module.exports = {
  isRecentListedPerformance,
  normalizeRecentListedPerformance,
};
