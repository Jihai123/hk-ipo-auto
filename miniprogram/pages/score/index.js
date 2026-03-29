const { fetchScore } = require('../../services/score');
const {
  getConclusionTag,
  getScoreTone,
  mapErrorMessage,
  buildDisplayFields,
} = require('../../utils/score');

const LOADING_STEPS = [
  '正在获取评分...',
  '正在分析招股书...',
  '正在整理结果...',
];

Page({
  data: {
    code: '',
    status: 'loading', // loading | success | empty | error
    loadingText: LOADING_STEPS[0],
    loadingIndex: 0,
    timerId: null,
    scoreData: null,
    displayFields: [],
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

      const displayFields = buildDisplayFields(res.display || {});
      const scoreData = {
        code: res.code || this.data.code,
        name: res.name || res.code || this.data.code,
        totalScore: Number.isFinite(res.totalScore) ? res.totalScore : 0,
        rating: res.rating || 'neutral',
        ratingLabel: res.ratingLabel || '未评级',
        conclusion: getConclusionTag(res.rating),
        tone: getScoreTone(res.totalScore),
        elapsed: res.elapsed,
        dimensions,
      };

      this.setData({
        status: 'success',
        scoreData,
        displayFields,
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

  onSearchAgain() {
    wx.reLaunch({ url: '/pages/home/index' });
  },
});
