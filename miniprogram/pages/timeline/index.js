const { fetchTimelineHome } = require('../../services/timeline');
const { formatUpdatedAt, normalizeText, buildGroups } = require('../../utils/timeline');

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
    errorInfo: null,
  },

  onLoad() {
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
      const res = await fetchTimelineHome();
      const groups = buildGroups(res?.timelineSummary || {});
      const total = groups.subscribing.length + groups.listingSoon.length + groups.recentListed.length;
      const degradedTimeline = !!res?.degraded?.timeline;
      const errorObj = res?.error || null;

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

      if (total === 0 && degradedTimeline) {
        this.setData({
          status: 'error',
          degradedTimeline,
          updatedAtText: formatUpdatedAt(res?.updatedAt),
          groups: normalizedGroups,
          errorInfo: {
            type: errorObj?.type || 'timeline_degraded',
            message: errorObj?.message || '时间表数据降级，请稍后刷新重试',
          },
        });
        return;
      }

      if (total === 0) {
        this.setData({
          status: 'empty',
          degradedTimeline,
          updatedAtText: formatUpdatedAt(res?.updatedAt),
          groups: normalizedGroups,
          errorInfo: null,
        });
        return;
      }

      this.setData({
        status: 'success',
        degradedTimeline,
        updatedAtText: formatUpdatedAt(res?.updatedAt),
        groups: normalizedGroups,
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
    const code = e.detail?.code;
    if (!code) return;
    wx.navigateTo({
      url: `/pages/score/index?code=${code}`,
      fail: () => {
        wx.showToast({ title: '跳转评分页失败', icon: 'none' });
      },
    });
  },
});
