const DIMENSION_NAME_MAP = {
  oldShares: '旧股发售',
  sponsor: '保荐人业绩',
  cornerstone: '基石投资者',
  lockup: 'Pre-IPO禁售',
  industry: '行业赛道',
  pe: 'PE估值',
  ipoSize: '募资规模',
};

function normalizeDimensionName(item = {}) {
  const key = item.key || item.dimensionKey || '';
  const text = item.label || item.name || item.title || '';
  if (text) return String(text);
  if (key && DIMENSION_NAME_MAP[key]) return DIMENSION_NAME_MAP[key];
  if (key) return String(key);
  return '';
}

module.exports = {
  DIMENSION_NAME_MAP,
  normalizeDimensionName,
};
