const { fetchScore } = require('../../services/score.js');
const { mapErrorMessage } = require('../../utils/score');
const { normalizeDimensionName } = require('../../utils/dimensions');
const { REVIEW_MODE } = require('../../utils/review-config');
const { buildDetailViewModel } = require('../../utils/review-adapter');

const LOADING_STEPS = [
  '正在获取公开信息...',
  '正在整理数据字段...',
  '正在生成展示内容...',
];

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toText(value, fallback = '--') {
  return (value === null || value === undefined || value === '') ? fallback : String(value);
}

function getToneClassByRating(ratingLabel = '', score = 0) {
  const text = String(ratingLabel || '');
  if (/强烈关注|建议申购|强烈推荐|可以考虑/.test(text)) return 'rating-positive';
  if (/谨慎|不建议|回避/.test(text)) return 'rating-negative';
  if (score > 0) return 'rating-positive';
  if (score < 0) return 'rating-negative';
  return 'rating-neutral';
}

function getDecisionSentence(score) {
  if (score >= 4) return '信号偏强，可优先复核定价与认购结构';
  if (score >= 0) return '可以考虑，建议结合市场窗口和中签预期';
  if (score >= -2) return '中性观察，等待更多定价与市场确认';
  return '谨慎申购，优先控制风险敞口';
}

function getStatusText(display = {}) {
  const status = String(display.status || '').trim();
  if (/subscribing|招股/.test(status)) return '招股中';
  if (/listingSoon|待上市/.test(status)) return '待上市';
  if (/recentListed|listed|已上市/.test(status)) return '已上市';
  return '状态待更新';
}

function hasMeaningfulEvidence(value) {
  const text = String(value || '').trim();
  return !!text && !['暂无', '暂无可展示原文', '--'].includes(text);
}

function getRawEvidence(item = {}) {
  return item.evidence && typeof item.evidence === 'object'
    ? (item.evidence.raw || item.evidence)
    : {};
}

function formatSignedPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '未提供';
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
}

function toCleanNumber(value) {
  const text = String(value === null || value === undefined ? '' : value).replace(/,/g, '').trim();
  if (!text) return NaN;
  const n = Number(text);
  return Number.isFinite(n) ? n : NaN;
}

function formatOldShareRatio(rawEvidence = {}) {
  const newCount = toCleanNumber(rawEvidence.newSharesCount);
  const saleCount = toCleanNumber(rawEvidence.saleSharesCount);

  if (!Number.isFinite(newCount) || !Number.isFinite(saleCount)) return '';

  const total = newCount + saleCount;
  if (!total) return '';

  return `${(saleCount / total * 100).toFixed(1)}%`;
}

function buildDimensionRows(key, rawEvidence = {}, fallbackEvidence = {}) {
  const rows = [];

  if (rawEvidence.section || fallbackEvidence.source) {
    rows.push({
      label: '搜索范围',
      value: toText(rawEvidence.section || fallbackEvidence.source, '未提供'),
    });
  }

  if (rawEvidence.scoreRule) {
    rows.push({ label: '评分规则', value: toText(rawEvidence.scoreRule, '未提供') });
  }

  if (key === 'oldShares') {
    const newCount = toCleanNumber(rawEvidence.newSharesCount);
    const saleCount = toCleanNumber(rawEvidence.saleSharesCount);
    const ratioText = formatOldShareRatio(rawEvidence);

    if (Number.isFinite(newCount) && Number.isFinite(saleCount)) {
      rows.push({ label: '新股数量', value: `${newCount.toLocaleString()} 股` });
      rows.push({ label: '旧股数量', value: `${saleCount.toLocaleString()} 股` });
      if (ratioText) rows.push({ label: '旧股占比', value: ratioText });
    }

    if (Array.isArray(rawEvidence.sources) && rawEvidence.sources.length > 0) {
      rows.push({
        label: '验证来源',
        value: rawEvidence.sources.map((src) => `${toText(src && src.source, '未知来源')}｜关键词:${toText(src && src.keyword, '无')}`).join('；'),
      });
    }
  }

  if (key === 'sponsor') {
    rows.push({ label: '识别数量', value: `${toNumber(rawEvidence.matchedCount, 0)} 个保荐人` });
    rows.push({ label: '加权平均涨幅', value: formatSignedPercent(rawEvidence.weightedRate) });

    if (Array.isArray(rawEvidence.allMatched) && rawEvidence.allMatched.length > 0) {
      rows.push({
        label: '匹配列表',
        value: rawEvidence.allMatched.slice(0, 5).map((s) => {
          const name = toText(s && s.name, '未知');
          const count = Number(s && s.count);
          const rate = Number(s && s.rate);
          const countText = Number.isFinite(count) ? `${count}单` : '未提供';
          const rateText = Number.isFinite(rate) ? `${rate >= 0 ? '+' : ''}${rate.toFixed(1)}%` : '未提供';
          return `${name} (${countText}, ${rateText})`;
        }).join('；'),
      });
    }

    if (rawEvidence.baseScore !== undefined || rawEvidence.headSponsorBonus !== undefined || rawEvidence.finalScore !== undefined) {
      rows.push({ label: '基础规则命中结果', value: Number.isFinite(Number(rawEvidence.baseScore)) ? `${Number(rawEvidence.baseScore)}` : '未提供' });
      rows.push({ label: '头部保荐人修正', value: Number.isFinite(Number(rawEvidence.headSponsorBonus)) ? `${Number(rawEvidence.headSponsorBonus)}` : '未提供' });
      rows.push({ label: '最终得分', value: Number.isFinite(Number(rawEvidence.finalScore)) ? `${Number(rawEvidence.finalScore)}` : '未提供' });
    }
  }

  if (key === 'cornerstone') {
    if (Array.isArray(rawEvidence.matchedKeywords) && rawEvidence.matchedKeywords.length > 0) {
      rows.push({ label: '匹配关键词', value: rawEvidence.matchedKeywords.join('、') });
    } else if (fallbackEvidence.keywordText) {
      rows.push({ label: '匹配关键词', value: fallbackEvidence.keywordText });
    }

    rows.push({ label: '明星基石名单', value: toText(rawEvidence.starList, '未提供') });
  }

  if (key === 'lockup') {
    const hasPreIPO = (typeof rawEvidence.preIPOFound === 'boolean')
      ? rawEvidence.preIPOFound
      : !!rawEvidence.hasPreIPO;
    const hasLockup = (typeof rawEvidence.lockupFound === 'boolean')
      ? rawEvidence.lockupFound
      : !!rawEvidence.hasLockup;

    rows.push({ label: 'Pre-IPO', value: hasPreIPO ? '发现 Pre-IPO 投资者' : '未发现 Pre-IPO 投资者' });

    if (!hasPreIPO) {
      rows.push({ label: '禁售期', value: '不适用（无 Pre-IPO 投资者）' });
    } else if (hasLockup) {
      rows.push({ label: '禁售期', value: rawEvidence.lockupPeriod ? `发现禁售安排（${rawEvidence.lockupPeriod}）` : '发现禁售安排（按规则 0 分）' });
    } else {
      rows.push({ label: '禁售期', value: '未发现禁售安排（按规则 -2 分）' });
    }
  }

  if (key === 'industry') {
    if (rawEvidence.companyIndustry) {
      rows.push({ label: '公司所属行业', value: toText(rawEvidence.companyIndustry, '未提供') });
    }
    if (rawEvidence.matchedKeyword || fallbackEvidence.keywordText) {
      rows.push({ label: '匹配关键词', value: toText(rawEvidence.matchedKeyword || fallbackEvidence.keywordText, '未提供') });
    }
    if (rawEvidence.trackCategories) {
      const t = rawEvidence.trackCategories;
      rows.push({
        label: '赛道分类',
        value: `热门:${toText(t.hot, '-')}｜成长:${toText(t.growth, '-')}｜中性:${toText(t.neutral, '-')}｜低弹:${toText(t.low, '-')}｜回避:${toText(t.avoid, '-')}`,
      });
    }
  }

  if (rows.length === 0) {
    rows.push({ label: '评分逻辑', value: '维度评分基于规则模型与公开信息综合计算' });
  }

  return rows;
}

function normalizeDimension(item = {}, idx = 0) {
  const score = toNumber(item.score);
  const evidence = item.evidence || {};
  const rawEvidence = getRawEvidence(item);
  const sourceText = String(evidence.source || item.source || '').trim();
  const keywordText = String(evidence.keywords || item.keywords || '').trim();
  const snippetText = String(evidence.snippet || item.detail || '').trim();
  const evidenceMode = hasMeaningfulEvidence(sourceText) || hasMeaningfulEvidence(keywordText) || hasMeaningfulEvidence(snippetText);
  const key = item.key || item.label || `dimension_${idx}`;

  return {
    key,
    label: normalizeDimensionName(item) || item.key || `dimension_${idx}`,
    score,
    scoreText: score > 0 ? `+${score}` : `${score}`,
    summaryText: item.summary || item.reason || '暂无明显信号',
    barWidth: `${Math.min(100, Math.max(8, Math.abs(score) * 18 + 10))}%`,
    barClass: score > 0 ? 'bar-positive' : score < 0 ? 'bar-negative' : 'bar-neutral',
    evidenceMode,
    evidence: {
      sourceText: toText(sourceText, '未提供'),
      keywordText: toText(keywordText, '未提供'),
      snippetText: toText(snippetText, '未提供'),
      rows: buildDimensionRows(key, rawEvidence, {
        source: sourceText,
        keywordText,
      }),
    },
  };
}

function buildMarketInfo(display = {}) {
  const candidates = [
    { key: 'industry', label: '所属行业', value: display.industry },
    { key: 'hasGreenShoe', label: '绿鞋机制', value: display.hasGreenShoe === undefined ? null : (display.hasGreenShoe ? '有' : '无') },
    { key: 'offerPrice', label: '上市价', value: display.offerPrice },
    { key: 'cumulativeReturn', label: '累积回报', value: display.cumulativeReturn },
    { key: 'firstDayChangePct', label: '首日表现', value: display.firstDayChangePct },
    { key: 'subscriptionMultiple', label: '认购倍数', value: display.subscriptionMultiple },
    { key: 'allotmentRate', label: '一手中签率', value: display.allotmentRate },
    { key: 'listingDate', label: '上市日期', value: display.listingDate },
  ];

  const items = candidates
    .filter((item) => item.value !== null && item.value !== undefined && item.value !== '')
    .map((item) => ({ ...item, value: String(item.value) }));

  if (items.length >= 3) return { mode: 'grid', items: items.slice(0, 6) };
  if (items.length >= 1) return { mode: 'compact', items: items.slice(0, 3) };
  return { mode: 'empty', items: [] };
}

Page({
  data: {
    reviewMode: REVIEW_MODE,
    detailViewModel: null,
    code: '',
    status: 'loading',
    loadingText: LOADING_STEPS[0],
    loadingIndex: 0,
    timerId: null,
    scoreData: null,
    keyFactors: [],
    allDimensions: [],
    evidenceOpen: false,
    errorInfo: null,
    marketInfo: {
      mode: 'empty',
      items: [],
    },
  },

  onLoad(options) {
    wx.setNavigationBarTitle({ title: REVIEW_MODE ? '新股信息详情' : '评分详情' });
    const code = String((options && options.code) || '').trim();
    this.setData({ code });

    if (!code) {
      this.setData({
        status: 'empty',
        errorInfo: {
          type: 'missing_code',
          message: '缺少股票代码参数',
        },
      });
      return;
    }

    this.requestScore('on_load');
  },

  onUnload() {
    this.clearLoadingTimer();
  },

  onPullDownRefresh() {
    this.requestScore('pull_down_refresh').finally(() => {
      wx.stopPullDownRefresh();
    });
  },

  startLoadingTimer() {
    this.clearLoadingTimer();
    const timerId = setInterval(() => {
      const nextIndex = (this.data.loadingIndex + 1) % LOADING_STEPS.length;
      this.setData({
        loadingIndex: nextIndex,
        loadingText: LOADING_STEPS[nextIndex],
      });
    }, 1200);

    this.setData({ timerId });
  },

  clearLoadingTimer() {
    if (this.data.timerId) {
      clearInterval(this.data.timerId);
      this.setData({ timerId: null });
    }
  },

  async requestScore(triggerSource = 'manual_retry') {
    this.setData({
      status: 'loading',
      loadingIndex: 0,
      loadingText: LOADING_STEPS[0],
      errorInfo: null,
      evidenceOpen: false,
    });
    this.startLoadingTimer();

    try {
      const res = await fetchScore(this.data.code, { triggerSource });
      const dimensions = Array.isArray(res && res.dimensions) ? res.dimensions : [];
      const hasCoreContent = Number.isFinite(res && res.totalScore) || dimensions.length > 0 || !!(res && res.ratingLabel);

      if (!(res && res.success) && !hasCoreContent) {
        this.setData({
          status: 'empty',
          errorInfo: {
            type: (res && res.error && res.error.type) || 'empty_result',
            message: mapErrorMessage((res && res.error) || {}),
          },
        });
        return;
      }

      if (!(res && res.success)) {
        this.setData({
          status: 'error',
          errorInfo: {
            type: (res && res.error && res.error.type) || 'score_failed',
            message: mapErrorMessage((res && res.error) || {}),
          },
        });
        return;
      }

      const totalScore = toNumber(res.totalScore);
      const allDimensions = dimensions.map(normalizeDimension);
      const keyFactors = allDimensions
        .filter((item) => item.score !== 0)
        .sort((a, b) => Math.abs(b.score) - Math.abs(a.score))
        .slice(0, 2);

      const marketInfo = buildMarketInfo(res.display || {});

      this.setData({
        status: 'success',
        scoreData: {
          code: res.code || this.data.code,
          name: res.name || res.code || this.data.code,
          totalScore,
          totalScoreText: Number.isFinite(res.totalScore) ? String(res.totalScore) : '0',
          ratingLabel: res.ratingLabel || '中性观察',
          toneClass: getToneClassByRating(res.ratingLabel, totalScore),
          decisionSentence: getDecisionSentence(totalScore),
          statusText: getStatusText(res.display || {}),
          performanceText: toText((res.display && res.display.cumulativeReturn) || (res.display && res.display.firstDayChangePct), ''),
        },
        keyFactors,
        allDimensions,
        marketInfo,
        detailViewModel: buildDetailViewModel({
          result: {
            ...res,
            dimensions: allDimensions,
          },
          code: this.data.code,
        }, REVIEW_MODE),
      });
    } catch (err) {
      this.setData({
        status: 'error',
        errorInfo: {
          type: 'network_error',
          message: '网络请求失败，请检查连接后重试',
        },
      });
    } finally {
      this.clearLoadingTimer();
    }
  },

  onRetry() {
    this.requestScore('retry_button');
  },

  onBackHome() {
    wx.navigateBack({
      fail: () => {
        wx.switchTab({
          url: '/pages/home/index',
          fail: () => wx.reLaunch({ url: '/pages/home/index' }),
        });
      },
    });
  },

  toggleEvidenceOpen() {
    this.setData({ evidenceOpen: !this.data.evidenceOpen });
  },
});
