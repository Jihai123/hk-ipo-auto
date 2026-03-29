const { fetchScore } = require('../../services/score');
const { mapErrorMessage } = require('../../utils/score');

const LOADING_STEPS = [
  '正在获取评分...',
  '正在分析招股书...',
  '正在整理结果...',
];

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function getToneClass(score) {
  if (score > 0) return 'rating-positive';
  if (score < 0) return 'rating-negative';
  return 'rating-neutral';
}

function getDecisionSentence(score) {
  if (score >= 2) return '可以考虑';
  if (score >= 0) return '中性观察';
  return '谨慎/回避';
}

function normalizeDimension(item = {}, idx = 0) {
  const score = toNumber(item.score);
  const evidence = item.evidence || {};
  const sourceText = evidence.source || item.source || '招股书 / ETNet';
  const keywordText = evidence.keywords || item.keywords || '暂无';
  const snippetText = evidence.snippet || item.detail || '暂无可展示原文';
  return {
    key: item.key || item.label || `dimension_${idx}`,
    label: item.label || item.name || '未命名维度',
    score,
    scoreText: score > 0 ? `+${score}` : `${score}`,
    summaryText: item.summary || '暂无明显信号',
    sourceText,
    keywordText,
    snippetText,
    evidenceOpen: false,
    icon: score > 0 ? '🔥' : score < 0 ? '⚠️' : '•',
  };
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

      this.setData({
        status: 'success',
        scoreData: {
          code: res.code || this.data.code,
          name: res.name || res.code || this.data.code,
          totalScore,
          totalScoreText: Number.isFinite(res.totalScore) ? String(res.totalScore) : '0',
          ratingLabel: res.ratingLabel || '中性观察',
          toneClass: getToneClass(totalScore),
          decisionSentence: getDecisionSentence(totalScore),
        },
        keyFactors,
        allDimensions,
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

  toggleDimensionEvidence(e) {
    const index = Number(e.currentTarget.dataset.index);
    if (!Number.isInteger(index) || index < 0) return;
    const key = `allDimensions[${index}].evidenceOpen`;
    this.setData({ [key]: !this.data.allDimensions[index].evidenceOpen });
  },
});
