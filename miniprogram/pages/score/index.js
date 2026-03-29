const { fetchScore } = require('../../services/score');
const { mapErrorMessage } = require('../../utils/score');

const LOADING_STEPS = [
  '正在获取评分...',
  '正在分析招股书...',
  '正在整理结果...',
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

function normalizeDimension(item = {}, idx = 0) {
  const score = toNumber(item.score);
  const evidence = item.evidence || {};
  const rawEvidence = getRawEvidence(item);
  const sourceText = String(evidence.source || item.source || '').trim();
  const keywordText = String(evidence.keywords || item.keywords || '').trim();
  const snippetText = String(evidence.snippet || item.detail || '').trim();
  const evidenceMode = hasMeaningfulEvidence(sourceText) || hasMeaningfulEvidence(keywordText) || hasMeaningfulEvidence(snippetText);

  return {
    key: item.key || item.label || `dimension_${idx}`,
    label: item.label || item.name || '未命名维度',
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
    },
    rule: {
      logicText: item.summary || item.reason || '维度评分基于规则模型与公开信息综合计算',
      sourceType: evidenceMode ? '接口证据' : '规则推断',
      dataStatus: evidenceMode ? '已提取到证据字段' : '接口未返回证据字段',
      scoreRule: rawEvidence.scoreRule || '',
    },
  };
}

function buildMarketInfo(display = {}) {
  const candidates = [
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
    const code = String(options?.code || '').trim();
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

    this.requestScore();
  },

  onUnload() {
    this.clearLoadingTimer();
  },

  onPullDownRefresh() {
    this.requestScore().finally(() => {
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

  async requestScore() {
    this.setData({
      status: 'loading',
      loadingIndex: 0,
      loadingText: LOADING_STEPS[0],
      errorInfo: null,
      evidenceOpen: false,
    });
    this.startLoadingTimer();

    try {
      const res = await fetchScore(this.data.code);
      const dimensions = Array.isArray(res?.dimensions) ? res.dimensions : [];
      const hasCoreContent = Number.isFinite(res?.totalScore) || dimensions.length > 0 || !!res?.ratingLabel;

      if (!res?.success && !hasCoreContent) {
        this.setData({
          status: 'empty',
          errorInfo: {
            type: res?.error?.type || 'empty_result',
            message: mapErrorMessage(res?.error || {}),
          },
        });
        return;
      }

      if (!res?.success) {
        this.setData({
          status: 'error',
          errorInfo: {
            type: res?.error?.type || 'score_failed',
            message: mapErrorMessage(res?.error || {}),
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
          performanceText: toText(res.display?.cumulativeReturn || res.display?.firstDayChangePct, ''),
        },
        keyFactors,
        allDimensions,
        marketInfo,
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
    this.requestScore();
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
