function getConclusionTag(rating) {
  const map = {
    buy: '可重点关注',
    neutral: '建议谨慎评估',
    avoid: '风险偏高',
  };
  return map[rating] || '需进一步判断';
}

function getScoreTone(score) {
  if (!Number.isFinite(score)) return 'neutral';
  if (score > 0) return 'positive';
  if (score < 0) return 'negative';
  return 'neutral';
}

function mapErrorMessage(error = {}) {
  const type = error.type;
  const fallback = error.message || '评分请求失败，请稍后重试';
  const map = {
    invalid_code: '股票代码格式不正确，请返回重新输入',
    prospectus_not_found: '未找到招股书，请确认代码或稍后再试',
    pdf_candidates_failed: '招股书解析失败，请稍后重试',
    score_failed: '评分过程异常，请稍后重试',
  };
  return map[type] || fallback;
}

function buildDisplayFields(display = {}) {
  const fields = [
    { key: 'listingDate', label: '上市日期' },
    { key: 'subscriptionMultiple', label: '认购倍数' },
    { key: 'hasGreenShoe', label: '绿鞋机制' },
  ];

  return fields
    .map((item) => {
      const value = display[item.key];
      if (value === null || value === undefined || value === '') return null;
      if (item.key === 'hasGreenShoe') {
        return { ...item, value: value ? '有' : '无' };
      }
      return { ...item, value: String(value) };
    })
    .filter(Boolean);
}

module.exports = {
  getConclusionTag,
  getScoreTone,
  mapErrorMessage,
  buildDisplayFields,
};
