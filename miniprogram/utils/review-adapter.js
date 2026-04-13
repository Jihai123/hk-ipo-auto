function toText(value, fallback = '--') {
  return (value === null || value === undefined || value === '') ? fallback : String(value);
}

function buildStatusText(status = '') {
  if (status === 'todayGreyMarket') return '待上市';
  if (status === 'todayListed') return '已上市';
  if (status === 'subscribing') return '招股中';
  if (status === 'listingSoon') return '待上市';
  if (status === 'hearingPassed') return '已披露';
  if (status === 'recentNewStocks') return '已披露';
  if (status === 'recentListed') return '已上市';
  return '状态待更新';
}

function pickDateInfo(item = {}) {
  return item.offerEndDate || item.listingDate || item.updatedAt || '--';
}

function buildHomeViewModel(input = {}, reviewMode = false) {
  if (!reviewMode) return {};
  const statusMap = input.statusMap || {};
  const topList = Array.isArray(input.topList) ? input.topList : [];
  const timelineSummary = input.timelineSummary || {};

  const cards = topList.slice(0, 6).map((item) => {
    const statusKey = statusMap[item.code] || item.status || '';
    return {
      code: item.code || '',
      nameText: toText(item.name || item.code),
      codeText: toText(item.code),
      statusText: buildStatusText(statusKey),
      dateInfoText: pickDateInfo(item),
      metaRows: [
        { label: '发售区间', value: toText(item.offerPriceRange || item.offerPrice || '--') },
        { label: '每手股数', value: toText(item.boardLot || item.lotSize || '--') },
        { label: '数据更新时间', value: toText(item.updatedAt || input.updatedAt || '--') },
        { label: '历史表现', value: '可查看' },
      ],
      actionText: '查看详情',
    };
  });

  return {
    headerTitle: '新股信息参考',
    headerSubtitle: '公开信息｜市场数据｜历史表现',
    searchPlaceholder: '输入代码查看相关信息',
    searchActionText: '查看详情',
    summaryTitle: '今日数据更新',
    summaryText: `公开信息已整理，共 ${cards.length} 条可查看数据`,
    sectionTitle: '公开信息概览',
    sectionNote: '近期动态',
    infoListTitle: '信息列表',
    cards,
    timelineInfo: {
      title: '近期动态',
      subscribingCount: Array.isArray(timelineSummary.subscribing) ? timelineSummary.subscribing.length : 0,
      listingSoonCount: Array.isArray(timelineSummary.listingSoon) ? timelineSummary.listingSoon.length : 0,
      listedCount: Array.isArray(timelineSummary.todayListed) ? timelineSummary.todayListed.length : 0,
    },
    disclaimer: '本工具仅提供公开信息整理、历史数据展示与信息参考，不构成任何建议，请以官方披露信息为准。',
  };
}

function buildDetailViewModel(input = {}, reviewMode = false) {
  if (!reviewMode) return {};
  const res = input.result || {};
  const display = res.display || {};
  const dimensions = Array.isArray(res.dimensions) ? res.dimensions : [];

  const detailSections = dimensions.map((item, index) => ({
    key: item.key || `section_${index}`,
    title: toText(item.label || item.key, '指标信息'),
    rows: [
      { label: '公开信息', value: toText(item.reason || item.summary || '已提取相关公开信息') },
      { label: '参考值', value: toText(item.score, '--') },
      { label: '说明', value: '仅作信息参考' },
    ],
  }));

  return {
    pageTitle: '新股信息详情',
    infoTitle: '数据概览',
    summaryRows: [
      { label: '代码', value: toText(res.code || input.code) },
      { label: '当前状态', value: toText(display.status || '状态待更新') },
      { label: '数据更新时间', value: toText(display.updatedAt || input.updatedAt || '--') },
      { label: '相关日期', value: toText(display.listingDate || display.offerEndDate || '--') },
    ],
    summaryText: '公开信息已整理，相关数据仅供参考',
    sections: [
      {
        key: 'basic',
        title: '基本信息',
        rows: [
          { label: '名称', value: toText(res.name || res.code || input.code) },
          { label: '代码', value: toText(res.code || input.code) },
          { label: '行业', value: toText(display.industry, '未提供') },
        ],
      },
      {
        key: 'offer',
        title: '公开发售信息',
        rows: [
          { label: '上市日期', value: toText(display.listingDate, '--') },
          { label: '发售价', value: toText(display.offerPrice, '--') },
          { label: '每手股数', value: toText(display.boardLot, '--') },
        ],
      },
      {
        key: 'market',
        title: '市场信息',
        rows: [
          { label: '首日表现数据', value: toText(display.firstDayChangePct, '--') },
          { label: '区间表现', value: toText(display.cumulativeReturn, '--') },
          { label: '公开数据汇总', value: '可结合披露材料进一步查看' },
        ],
      },
      {
        key: 'history',
        title: '历史表现',
        rows: [
          { label: '首日表现数据', value: toText(display.firstDayChangePct, '--') },
          { label: '区间表现', value: toText(display.cumulativeReturn, '--') },
        ],
      },
      {
        key: 'source',
        title: '数据来源',
        rows: [
          { label: '来源说明', value: '公开披露信息与历史数据整理' },
          { label: '使用提示', value: '请以官方披露信息为准' },
        ],
      },
      {
        key: 'indicator',
        title: '指标说明',
        rows: detailSections.length ? [] : [{ label: '说明', value: '指标信息整理中' }],
      },
      ...detailSections,
    ],
    disclaimer: '本工具仅提供公开信息整理、历史数据展示与信息参考，不构成任何建议，请以官方披露信息为准。',
  };
}

module.exports = {
  buildHomeViewModel,
  buildDetailViewModel,
};
