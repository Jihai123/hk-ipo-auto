const { fetchHome } = require('../../services/home');
const { fetchTimelineCurrent } = require('../../services/timeline');
const {
  sanitizeCodeInput,
  normalizeStockCode,
  loadSearchHistory,
  pushSearchHistory,
} = require('../../utils/search');
const {
  isRecentListedPerformance,
  normalizeRecentListedPerformance,
  compareByListingDateDesc,
} = require('../../utils/recent-listed');

const IPO_FRONT_DEBUG = true;

function debugLog(prefix, payload) {
  if (!IPO_FRONT_DEBUG) return;
  console.log(prefix, JSON.stringify(payload, null, 2));
}

function getCount(source, key) {
  return Array.isArray(source && source[key]) ? source[key].length : 0;
}

function summarizeLayer(source = {}) {
  return {
    counts: {
      todayGreyMarket: getCount(source, 'todayGreyMarket'),
      todayListed: getCount(source, 'todayListed'),
      subscribing: getCount(source, 'subscribing'),
      listingSoon: getCount(source, 'listingSoon'),
      hearingPassed: getCount(source, 'hearingPassed'),
      recentNewStocks: getCount(source, 'recentNewStocks'),
      recentListed: getCount(source, 'recentListed'),
    },
    samples: {
      todayGreyMarketFirst: source?.todayGreyMarket?.[0] || null,
      todayListedFirst: source?.todayListed?.[0] || null,
      recentNewStocksFirst: source?.recentNewStocks?.[0] || null,
    },
  };
}

function toText(value, fallback = '--') {
  return (value === null || value === undefined || value === '') ? fallback : String(value);
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function getMainRating(score = 0) {
  if (score >= 4) return { text: '强烈关注', className: 'rating-positive' };
  if (score >= 0) return { text: '可以考虑', className: 'rating-positive' };
  if (score >= -2) return { text: '中性观察', className: 'rating-neutral' };
  return { text: '谨慎申购', className: 'rating-negative' };
}

function getStatusMeta(status = '') {
  if (status === 'todayGreyMarket') return { text: '今日暗盘', className: 'status-soon' };
  if (status === 'todayListed') return { text: '今日上市', className: 'status-listed' };
  if (status === 'subscribing') return { text: '招股中', className: 'status-sub' };
  if (status === 'listingSoon') return { text: '待上市', className: 'status-soon' };
  if (status === 'hearingPassed') return { text: '通过聆讯', className: 'status-soon' };
  if (status === 'recentNewStocks') return { text: '近期新股信息', className: 'status-listed' };
  if (status === 'recentListed') return { text: '已上市', className: 'status-listed' };
  return { text: '状态待更新', className: 'status-unknown' };
}

function getShortReasonText(item = {}) {
  const raw = String(item.shortReason || item.reason || '').trim();
  if (raw) return raw;
  const score = toNumber(item.score);
  if (score >= 4) return '综合信号较强，优先跟踪定价与分配';
  if (score >= 0) return '维度偏正向，建议结合市场热度判断';
  if (score >= -2) return '暂无明确优势，建议继续观察';
  return '维度偏弱，注意风险暴露';
}

function normalizeRecommendItem(item = {}, statusMap = {}) {
  const score = toNumber(item.score);
  const ratingMeta = getMainRating(score);
  const statusMeta = getStatusMeta(statusMap[item.code] || item.status || '');
  return {
    code: item.code || '',
    codeText: item.code || '--',
    nameText: item.name || item.code || '--',
    score,
    scoreText: toText(item.score, '0'),
    listingDateText: toText(item.listingDate, ''),
    mainRatingText: ratingMeta.text,
    mainRatingClass: ratingMeta.className,
    shortReasonText: getShortReasonText(item),
    statusText: statusMeta.text,
    statusClass: statusMeta.className,
  };
}

function normalizeTimelineItem(item = {}) {
  return {
    code: item.code || '',
    codeText: item.code || '--',
    nameText: item.name || item.code || '--',
    listingDateText: toText(item.listingDate),
  };
}

function mapSentiment(market = {}) {
  const heat = Number(market.heatIndex);
  if (Number.isFinite(heat) && heat >= 70) {
    return { text: '偏热', className: 'sentiment-hot' };
  }
  if (Number.isFinite(heat) && heat <= 35) {
    return { text: '偏冷', className: 'sentiment-cold' };
  }
  return { text: '中性', className: 'sentiment-neutral' };
}

function buildStatusMap(timelineSummary = {}) {
  const map = {};
  (timelineSummary.todayGreyMarket || []).forEach((item) => { if (item.code) map[item.code] = 'todayGreyMarket'; });
  (timelineSummary.todayListed || []).forEach((item) => { if (item.code) map[item.code] = 'todayListed'; });
  (timelineSummary.subscribing || []).forEach((item) => { if (item.code) map[item.code] = 'subscribing'; });
  (timelineSummary.listingSoon || []).forEach((item) => { if (item.code) map[item.code] = 'listingSoon'; });
  (timelineSummary.hearingPassed || []).forEach((item) => { if (item.code) map[item.code] = 'hearingPassed'; });
  (timelineSummary.recentNewStocks || []).forEach((item) => { if (item.code) map[item.code] = 'recentNewStocks'; });
  (timelineSummary.recentListed || []).forEach((item) => { if (item.code) map[item.code] = 'recentListed'; });
  return map;
}

function buildHeroConclusion(topRecommendations, sentimentText) {
  const highScoreCount = topRecommendations.filter((item) => item.score >= 4).length;
  const considerCount = topRecommendations.filter((item) => item.score >= 0).length;
  if (highScoreCount > 0) return `今日有 ${highScoreCount} 只强势标的，优先复核定价与分配`; 
  if (considerCount > 0 && sentimentText === '偏热') return `市场${sentimentText}，有 ${considerCount} 只可考虑标的`;
  if (sentimentText === '偏冷') return '市场偏冷，建议控制仓位并精选标的';
  return '今日暂无明确强信号，建议保持观察';
}

Page({
  data: {
    loading: true,
    error: '',
    searchCode: '',
    recentSearches: [],
    topRecommendations: [],
    recentPerformance: [],
    windowGroups: {
      todayGreyMarket: [],
      todayListed: [],
      subscribing: [],
      listingSoon: [],
      hearingPassed: [],
      recentNewStocks: [],
    },
    marketSentiment: {
      text: '中性',
      className: 'sentiment-neutral',
    },
    heroConclusion: '今日暂无明确强信号，建议保持观察',
    showMethodPanel: false,
    methodItems: [
      { name: '旧股发售', desc: '判断是否存在老股东套现，识别资金流向。' },
      { name: '保荐人业绩', desc: '观察保荐人历史项目首日表现与稳定性。' },
      { name: '基石投资者', desc: '识别是否有高质量长期资金背书。' },
      { name: 'Pre-IPO禁售', desc: '评估早期投资者短期减持压力。' },
      { name: '行业赛道', desc: '根据行业景气度判断情绪加分或减分。' },
      { name: 'PE估值', desc: '对比同行估值，衡量定价是否偏贵。' },
    ],
  },

  onLoad() {
    this.setData({ recentSearches: loadSearchHistory().slice(0, 3) });
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

      const timelineRes = await fetchTimelineCurrent();
      const timelineSummary = (timelineRes && timelineRes.data) || res.timelineSummary || {};
      debugLog('[ipo/front/mp][fetch-success]', {
        responseRootKeys: Object.keys(timelineRes || {}),
        responseDataKeys: timelineRes && timelineRes.data && typeof timelineRes.data === 'object' ? Object.keys(timelineRes.data) : null,
        responseDataDataKeys: timelineRes && timelineRes.data && timelineRes.data.data && typeof timelineRes.data.data === 'object' ? Object.keys(timelineRes.data.data) : null,
        rootLayer: summarizeLayer(timelineRes || {}),
        dataLayer: summarizeLayer(timelineRes?.data || {}),
        dataDataLayer: summarizeLayer(timelineRes?.data?.data || {}),
        fieldNameCheck: {
          boardLotVsLotSize: {
            data: {
              boardLot: timelineRes?.data?.todayGreyMarket?.[0]?.boardLot,
              lotSize: timelineRes?.data?.todayGreyMarket?.[0]?.lotSize,
            },
          },
          entryFeeVsLotAmount: {
            data: {
              entryFee: timelineRes?.data?.todayGreyMarket?.[0]?.entryFee,
              lotAmount: timelineRes?.data?.todayGreyMarket?.[0]?.lotAmount,
            },
          },
          pathCheck: {
            responseData: timelineRes?.data ?? null,
            responseDataData: timelineRes?.data?.data ?? null,
          },
        },
      });
      const statusMap = buildStatusMap(timelineSummary);

      const topRecommendations = (Array.isArray(res.topList) ? res.topList : [])
        .map((item) => normalizeRecommendItem(item, statusMap))
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);

      const marketSentiment = mapSentiment(res.market || {});
      const heroConclusion = buildHeroConclusion(topRecommendations, marketSentiment.text);

      const nextWindowGroups = {
        todayGreyMarket: (timelineSummary.todayGreyMarket || []).map(normalizeTimelineItem).slice(0, 3),
        todayListed: (timelineSummary.todayListed || []).map(normalizeTimelineItem).slice(0, 3),
        subscribing: (timelineSummary.subscribing || []).map(normalizeTimelineItem).slice(0, 3),
        listingSoon: (timelineSummary.listingSoon || []).map(normalizeTimelineItem).slice(0, 3),
        hearingPassed: (timelineSummary.hearingPassed || []).map(normalizeTimelineItem).slice(0, 3),
        recentNewStocks: (timelineSummary.recentNewStocks || []).map(normalizeTimelineItem).slice(0, 3),
      };
      const windowGroupEntries = Object.keys(nextWindowGroups).map((key) => ({
        key,
        title: key,
        itemsLength: nextWindowGroups[key].length,
      }));
      debugLog('[ipo/front/mp][empty-state-check]', {
        scope: 'home-window-groups',
        checks: windowGroupEntries,
        reason: 'home卡片是否展示由各 group length 决定',
      });
      debugLog('[ipo/front/mp][setData-before]', {
        keys: ['loading', 'topRecommendations', 'recentPerformance', 'windowGroups', 'marketSentiment', 'heroConclusion'],
        windowGroupsLength: windowGroupEntries.length,
        groups: windowGroupEntries,
        firstGroupSample: nextWindowGroups.todayGreyMarket?.[0] || null,
      });
      this.setData({
        loading: false,
        topRecommendations,
        recentPerformance: (timelineSummary.recentNewStocks || timelineSummary.recentListed || [])
          .filter(isRecentListedPerformance)
          .sort(compareByListingDateDesc)
          .map(normalizeRecentListedPerformance)
          .slice(0, 3),
        windowGroups: nextWindowGroups,
        marketSentiment,
        heroConclusion,
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

  onTapRecommendCard(e) {
    const code = e.currentTarget.dataset.code;
    if (!code) return;
    this.goToScoreDetail(code);
  },

  onTapRecentSearch(e) {
    const code = e.currentTarget.dataset.code;
    if (!code) return;
    this.goToScoreDetail(code);
  },

  onTapWindowCard(e) {
    const code = e.currentTarget.dataset.code;
    if (!code) return;
    this.goToScoreDetail(code);
  },

  onTapTimelineMore(e) {
    const target = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.target;
    const url = target === 'recentPerformance'
      ? '/pages/timeline/index?mode=recentPerformance'
      : '/pages/timeline/index';
    wx.navigateTo({
      url,
      fail: () => wx.showToast({ title: '无法打开时间表', icon: 'none' }),
    });
  },

  onOpenMethodPanel() {
    this.setData({ showMethodPanel: true });
  },

  onCloseMethodPanel() {
    this.setData({ showMethodPanel: false });
  },

  onPanelTap() {},

  goToScoreDetail(code) {
    const nextHistory = pushSearchHistory(code).slice(0, 3);
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
