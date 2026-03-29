const { fetchHome } = require('../../services/home');
const {
  sanitizeCodeInput,
  normalizeStockCode,
  loadSearchHistory,
  pushSearchHistory,
} = require('../../utils/search');

Page({
  data: {
    loading: true,
    error: '',
    searchCode: '',
    recentSearches: [],
    updatedAt: '',
    degraded: {
      topList: false,
      market: false,
    },
    topList: [],
    timelineSummary: {
      subscribing: [],
      listingSoon: [],
      recentListed: [],
    },
    market: {
      avgReturn: null,
      breakRate: null,
      heatIndex: null,
    },
  },

  onLoad() {
    this.setData({ recentSearches: loadSearchHistory() });
    this.loadHomeData();
  },

  onPullDownRefresh() {
    this.loadHomeData().finally(() => {
      wx.stopPullDownRefresh();
    });
  },

  async loadHomeData() {
    this.setData({ loading: true, error: '' });

    try {
      const res = await fetchHome();
      if (!res || !res.success) {
        throw new Error(res?.error || 'HOME_API_ERROR');
      }

      this.setData({
        loading: false,
        updatedAt: res.updatedAt || '',
        degraded: res.degraded || { topList: true, market: true },
        topList: Array.isArray(res.topList) ? res.topList : [],
        timelineSummary: res.timelineSummary || {
          subscribing: [],
          listingSoon: [],
          recentListed: [],
        },
        market: res.market || {
          avgReturn: null,
          breakRate: null,
          heatIndex: null,
        },
      });
    } catch (err) {
      this.setData({
        loading: false,
        error: err.message || '网络请求失败，请重试',
      });
    }
  },

  onSearchInput(e) {
    this.setData({ searchCode: sanitizeCodeInput(e.detail.value || '') });
  },

  onSearchSubmit() {
    const normalized = normalizeStockCode(this.data.searchCode || '');
    if (!normalized.ok) {
      wx.showToast({ title: normalized.message, icon: 'none' });
      return;
    }
    this.goToScoreDetail(normalized.code);
  },

  onTapRecent(e) {
    const code = e.currentTarget.dataset.code;
    if (!code) return;
    this.goToScoreDetail(code);
  },

  goToTimeline() {
    wx.navigateTo({
      url: '/pages/timeline/index',
      fail: () => {
        wx.showToast({ title: '时间表页面暂不可用', icon: 'none' });
      },
    });
  },

  onTapTopItem(e) {
    const code = e.detail?.code;
    if (!code) return;
    this.goToScoreDetail(code);
  },

  onTapTimelineItem(e) {
    const code = e.currentTarget.dataset.code;
    if (!code) return;
    this.goToScoreDetail(code);
  },

  goToScoreDetail(code) {
    const nextHistory = pushSearchHistory(code);
    this.setData({ recentSearches: nextHistory, searchCode: code });

    // 统一跳转评分详情页
    wx.navigateTo({
      url: `/pages/score/index?code=${code}`,
      fail: () => {
        wx.showToast({
          title: `已预留评分页路径：${code}`,
          icon: 'none',
        });
      },
    });
  },
});
