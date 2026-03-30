const IPO_FRONT_DEBUG = true;

function debugLog(prefix, payload) {
  if (!IPO_FRONT_DEBUG) return;
  console.log(prefix, JSON.stringify(payload, null, 2));
}

function getCount(source, key) {
  return Array.isArray(source && source[key]) ? source[key].length : 0;
}

function pickSample(item) {
  if (!item) return null;
  return {
    code: item.code ?? null,
    name: item.name ?? null,
    status: item.status ?? null,
    statusText: item.statusText ?? null,
    listingDate: item.listingDate ?? null,
    offerPrice: item.offerPrice ?? null,
    boardLot: item.boardLot ?? null,
    lotSize: item.lotSize ?? null,
    entryFee: item.entryFee ?? null,
    lotAmount: item.lotAmount ?? null,
    allotmentRate: item.allotmentRate ?? null,
    firstDayChangePct: item.firstDayChangePct ?? null,
  };
}

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
  debugLog('[ipo/front/mp][buildGroups-input]', {
    payloadKeys: Object.keys(summary || {}),
    payloadDataKeys: summary && summary.data && typeof summary.data === 'object' ? Object.keys(summary.data) : null,
    counts: {
      todayGreyMarket: getCount(summary, 'todayGreyMarket'),
      todayListed: getCount(summary, 'todayListed'),
      subscribing: getCount(summary, 'subscribing'),
      listingSoon: getCount(summary, 'listingSoon'),
      hearingPassed: getCount(summary, 'hearingPassed'),
      recentNewStocks: getCount(summary, 'recentNewStocks'),
      recentListed: getCount(summary, 'recentListed'),
    },
    samples: {
      todayGreyMarketFirst: pickSample(summary?.todayGreyMarket?.[0]),
      todayListedFirst: pickSample(summary?.todayListed?.[0]),
      hearingPassedFirst: pickSample(summary?.hearingPassed?.[0]),
      recentNewStocksFirst: pickSample(summary?.recentNewStocks?.[0]),
    },
  });

  const result = {
    todayGreyMarket: Array.isArray(summary.todayGreyMarket) ? summary.todayGreyMarket : [],
    todayListed: Array.isArray(summary.todayListed) ? summary.todayListed : [],
    subscribing: Array.isArray(summary.subscribing) ? summary.subscribing : [],
    listingSoon: Array.isArray(summary.listingSoon) ? summary.listingSoon : [],
    hearingPassed: Array.isArray(summary.hearingPassed) ? summary.hearingPassed : [],
    recentNewStocks: Array.isArray(summary.recentNewStocks) ? summary.recentNewStocks : [],
    recentListed: Array.isArray(summary.recentListed) ? summary.recentListed : [],
  };
  debugLog('[ipo/front/mp][buildGroups-output]', {
    groupsCount: Object.keys(result).length,
    groups: Object.keys(result).map((key) => ({
      key,
      title: key === 'todayGreyMarket' ? '今日暗盘'
        : key === 'todayListed' ? '今日上市'
        : key === 'hearingPassed' ? '申请上市（通过聆讯）'
        : key === 'recentNewStocks' ? '近期新股信息'
        : key,
      itemsLength: getCount(result, key),
      first: pickSample(result[key][0]),
    })),
  });
  return result;
}

module.exports = {
  formatUpdatedAt,
  normalizeText,
  buildGroups,
};
