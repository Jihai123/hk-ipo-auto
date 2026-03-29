const { fetchHome } = require('../../services/home');
const {
  sanitizeCodeInput,
  normalizeStockCode,
  loadSearchHistory,
  pushSearchHistory,
} = require('../../utils/search');

function toText(value) {
  return (value === null || value === undefined || value === '') ? '--' : value;
}

function normalizeTopItem(item = {}) {
  const ratingLabelText = item.ratingLabel || item.legacyRating || '';
  return {
    ...item,
    ratingLabelText,
    listingDateText: toText(item.listingDate),
    nameText: item.name || item.code || '--',
    scoreText: toText(item.score),
    statusText: ratingLabelText || '未评级',
    extraText: `${ratingLabelText} · 上市日 ${toText(item.listingDate)}`,
  };
}

function normalizeTimelineItem(item = {}) {
  return {
    ...item,
    listingDateText: toText(item.listingDate),
    offerEndDateText: toText(item.offerEndDate),
    firstDayChangePctText: toText(item.firstDayChangePct),
    nameText: item.name || item.code || '--',
    codeText: item.code || '--',
  };
}

function normalizeMarket(market = {}) {
  return {
    ...market,
    avgReturnText: toText(market.avgReturn),
    breakRateText: toText(market.breakRate),
    heatIndexText: toText(market.heatIndex),
  };
}

Page({
  data: {
    loading: true,
    error: '',
    searchCode: '',
    recentSearches: [],
    updatedAt: '',
    updatedAtText: '--',
    degraded: {
      topList: false,
      timeline: false,
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
      avgReturnText: '--',
      breakRateText: '--',
      heatIndexText: '--',
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
        throw new Error(res && res.error && res.error.message ? res.error.message : 'HOME_API_ERROR');
      }

      const timelineSummary = res.timelineSummary || {};

      this.setData({
        loading: false,
        updatedAt: res.updatedAt || '',
        updatedAtText: toText(res.updatedAt),
        degraded: res.degraded || { topList: true, timeline: true, market: true },
        topList: (Array.isArray(res.topList) ? res.topList : []).map(normalizeTopItem),
        timelineSummary: {
          subscribing: (timelineSummary.subscribing || []).map(normalizeTimelineItem),
          listingSoon: (timelineSummary.listingSoon || []).map(normalizeTimelineItem),
          recentListed: (timelineSummary.recentListed || []).map(normalizeTimelineItem),
        },
        market: normalizeMarket(res.market),
      });
    } catch (err) {
      this.setData({
        loading: false,
        error: err && err.message ? err.message : '网络请求失败，请重试',
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
    const code = e.currentTarget.dataset.code;
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
