const { fetchTimelineCurrent } = require('../../services/timeline');
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
      todayGreyMarket: [],
      todayListed: [],
      subscribing: [],
      listingSoon: [],
      hearingPassed: [],
      recentNewStocks: [],
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
      const res = await fetchTimelineCurrent();
      const summary = res?.data || {};
      const groups = buildGroups(summary);
      const total = groups.todayGreyMarket.length
        + groups.todayListed.length
        + groups.subscribing.length
        + groups.listingSoon.length
        + groups.hearingPassed.length
        + groups.recentNewStocks.length;
      const degradedTimeline = false;
      const errorObj = null;

      const withBasics = (item = {}) => ({
        code: normalizeText(item.code, ''),
        name: normalizeText(item.name, normalizeText(item.code, '--')),
        listingDate: normalizeText(item.listingDate, ''),
      });

      const buildMetrics = (item = {}, defs = []) => defs
        .map((def) => {
          const raw = item[def.key];
          if (raw === null || raw === undefined || raw === '') return null;
          const value = def.format ? def.format(raw) : String(raw);
          return value ? { label: def.label, value } : null;
        })
        .filter(Boolean);

      const normalizedGroups = {
        todayGreyMarket: groups.todayGreyMarket.map(item => ({
          ...withBasics(item),
          statusText: normalizeText(item.statusText, '暗盘/待上市'),
          metrics: buildMetrics(item, [
            { key: 'currency', label: '货币' },
            { key: 'offerPrice', label: '上市价' },
            { key: 'boardLot', label: '每手股数' },
            { key: 'entryFee', label: '入场费' },
          ]),
        })),
        todayListed: groups.todayListed.map(item => ({
          ...withBasics(item),
          statusText: '今日上市',
          metrics: buildMetrics(item, [
            { key: 'firstDayOpen', label: '开盘价' },
            { key: 'firstDayClose', label: '收盘价' },
            { key: 'firstDayChangePct', label: '首日升跌', format: v => `${v}%` },
            { key: 'lotProfit', label: '一手收益' },
          ]),
        })),
        subscribing: groups.subscribing.map(item => ({
          ...withBasics(item),
          offerEndDate: normalizeText(item.offerEndDate, ''),
          statusText: '招股中',
        })),
        listingSoon: groups.listingSoon.map(item => ({
          ...withBasics(item),
          offerEndDate: normalizeText(item.offerEndDate, ''),
          statusText: '即将上市',
        })),
        hearingPassed: groups.hearingPassed.map(item => ({
          ...withBasics(item),
          statusText: normalizeText(item.statusText, '通过聆讯'),
        })),
        recentNewStocks: groups.recentNewStocks.map(item => ({
          ...withBasics(item),
          statusText: '近期新股信息',
          metrics: buildMetrics(item, [
            { key: 'currency', label: '货币' },
            { key: 'offerPrice', label: '上市价' },
            { key: 'boardLot', label: '每手股数' },
            { key: 'entryFee', label: '入场费' },
            { key: 'subscriptionMultiple', label: '认购倍数' },
            { key: 'allotmentRate', label: '一手中签率', format: v => `${v}%` },
            { key: 'firstDayChangePct', label: '首日表现', format: v => `${v}%` },
          ]),
        })),
        recentListed: groups.recentListed.map(item => ({
          ...withBasics(item),
          offerEndDate: normalizeText(item.offerEndDate, ''),
        })),
      };
      const recentPerformance = groups.recentNewStocks
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
