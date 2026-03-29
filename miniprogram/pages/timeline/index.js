const { fetchTimelineHome, fetchTimelineCurrent } = require('../../services/timeline');
const { formatUpdatedAt, normalizeText, buildGroups } = require('../../utils/timeline');
const {
  isRecentListedPerformance,
  normalizeRecentListedPerformance,
  compareByListingDateDesc,
} = require('../../utils/recent-listed');

Page({
  data: {
    status: 'loading', // loading | success | empty | error
    updatedAtText: '--',
    degradedTimeline: false,
    groups: {
      subscribing: [],
      listingSoon: [],
      recentListed: [],
    },
    recentPerformance: [],
    viewMode: 'timeline', // timeline | recentPerformance
    errorInfo: null,
  },

  onLoad(options = {}) {
    const viewMode = options.mode === 'recentPerformance' ? 'recentPerformance' : 'timeline';
    this.setData({ viewMode });
    wx.setNavigationBarTitle({
      title: viewMode === 'recentPerformance' ? '近期上市表现' : '新股时间表',
    });
    this.loadTimeline();
  },

  onPullDownRefresh() {
    this.loadTimeline().finally(() => {
      wx.stopPullDownRefresh();
    });
  },

  async loadTimeline() {
    this.setData({ status: 'loading', errorInfo: null });

    try {
      const isRecentPerformanceMode = this.data.viewMode === 'recentPerformance';
      const res = isRecentPerformanceMode ? await fetchTimelineCurrent() : await fetchTimelineHome();
      const summary = isRecentPerformanceMode ? (res?.data || {}) : (res?.timelineSummary || {});
      const groups = buildGroups(summary);
      const total = groups.subscribing.length + groups.listingSoon.length + groups.recentListed.length;
      const degradedTimeline = isRecentPerformanceMode ? false : !!res?.degraded?.timeline;
      const errorObj = isRecentPerformanceMode ? null : (res?.error || null);

      const normalizedGroups = {
        subscribing: groups.subscribing.map(item => ({
          code: normalizeText(item.code, ''),
          name: normalizeText(item.name, normalizeText(item.code, '--')),
          listingDate: normalizeText(item.listingDate, ''),
          offerEndDate: normalizeText(item.offerEndDate, ''),
        })),
        listingSoon: groups.listingSoon.map(item => ({
          code: normalizeText(item.code, ''),
          name: normalizeText(item.name, normalizeText(item.code, '--')),
          listingDate: normalizeText(item.listingDate, ''),
          offerEndDate: normalizeText(item.offerEndDate, ''),
        })),
        recentListed: groups.recentListed.map(item => ({
          code: normalizeText(item.code, ''),
          name: normalizeText(item.name, normalizeText(item.code, '--')),
          listingDate: normalizeText(item.listingDate, ''),
          offerEndDate: normalizeText(item.offerEndDate, ''),
        })),
      };
      const recentPerformance = groups.recentListed
        .filter(isRecentListedPerformance)
        .sort(compareByListingDateDesc)
        .map(normalizeRecentListedPerformance);
      const totalForCurrentView = this.data.viewMode === 'recentPerformance'
        ? recentPerformance.length
        : total;

      if (totalForCurrentView === 0 && degradedTimeline) {
        this.setData({
          status: 'error',
          degradedTimeline,
          updatedAtText: formatUpdatedAt(res?.updatedAt),
          groups: normalizedGroups,
          recentPerformance,
          errorInfo: {
            type: errorObj?.type || 'timeline_degraded',
            message: errorObj?.message || '时间表数据降级，请稍后刷新重试',
          },
        });
        return;
      }

      if (totalForCurrentView === 0) {
        this.setData({
          status: 'empty',
          degradedTimeline,
          updatedAtText: formatUpdatedAt(res?.updatedAt),
          groups: normalizedGroups,
          recentPerformance,
          errorInfo: null,
        });
        return;
      }

      this.setData({
        status: 'success',
        degradedTimeline,
        updatedAtText: formatUpdatedAt(res?.updatedAt),
        groups: normalizedGroups,
        recentPerformance,
        errorInfo: errorObj,
      });
    } catch (err) {
      this.setData({
        status: 'error',
        errorInfo: {
          type: 'network_error',
          message: '网络请求失败，请下拉刷新重试',
        },
      });
    }
  },

  onRetry() {
    this.loadTimeline();
  },

  onTapStock(e) {
    const code = (e.detail && e.detail.code) || (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.code);
    if (!code) return;
    wx.navigateTo({
      url: `/pages/score/index?code=${code}`,
      fail: () => {
        wx.showToast({ title: '跳转评分页失败', icon: 'none' });
      },
    });
  },
});
