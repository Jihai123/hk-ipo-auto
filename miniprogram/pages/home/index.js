const { fetchHome } = require('../../services/home');
const {
  sanitizeCodeInput,
  normalizeStockCode,
  loadSearchHistory,
  pushSearchHistory,
} = require('../../utils/search');

function toText(value, fallback = '--') {
  return (value === null || value === undefined || value === '') ? fallback : String(value);
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function getRatingToneClass(ratingLabel = '') {
  const text = String(ratingLabel);
  if (/可打|积极|推荐|申购|正向|看好/.test(text)) return 'rating-positive';
  if (/回避|谨慎|负向|不宜/.test(text)) return 'rating-negative';
  return 'rating-neutral';
}

function getShortReasonText(item = {}) {
  const raw = String(item.shortReason || item.reason || '').trim();
  if (raw) return raw;
  const score = toNumber(item.score);
  return score >= 1 ? '暂无明显亮点' : '综合表现中性';
}

function getLevelMeta(score) {
  if (score >= 2) return { text: '强推荐', className: 'level-strong' };
  if (score >= 0) return { text: '可关注', className: 'level-watch' };
  return { text: '观望', className: 'level-wait' };
}

function getStatusMeta(status = '') {
  if (status === 'subscribing') return { text: '招股中', className: 'status-sub' };
  if (status === 'listingSoon') return { text: '待上市', className: 'status-soon' };
  if (status === 'recentListed') return { text: '已上市', className: 'status-listed' };
  return { text: '状态待更新', className: 'status-unknown' };
}

function normalizeRecommendItem(item = {}, statusMap = {}) {
  const score = toNumber(item.score);
  const levelMeta = getLevelMeta(score);
  const ratingLabelText = item.ratingLabel || item.legacyRating || '中性观察';
  const statusMeta = getStatusMeta(statusMap[item.code] || item.status || '');
  return {
    code: item.code || '',
    codeText: item.code || '--',
    nameText: item.name || item.code || '--',
    score,
    scoreText: toText(item.score, '0'),
    listingDateText: toText(item.listingDate),
    ratingLabelText,
    ratingToneClass: getRatingToneClass(ratingLabelText),
    shortReasonText: getShortReasonText(item),
    levelText: levelMeta.text,
    levelClass: levelMeta.className,
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

function normalizeRecentListedItem(item = {}) {
  const change = toNumber(item.cumulativeReturn, null);
  const firstDay = toNumber(item.firstDayChangePct, null);
  const perf = Number.isFinite(change) ? change : firstDay;
  const isUp = Number.isFinite(perf) && perf > 0;
  const isDown = Number.isFinite(perf) && perf < 0;

  return {
    code: item.code || '',
    codeText: item.code || '--',
    nameText: item.name || item.code || '--',
    listingDateText: toText(item.listingDate),
    perfText: Number.isFinite(perf) ? `${perf > 0 ? '+' : ''}${perf.toFixed(2)}%` : '--',
    perfArrow: isUp ? '▲' : isDown ? '▼' : '•',
    perfClass: isUp ? 'perf-up' : isDown ? 'perf-down' : 'perf-flat',
    metrics: [
      { label: '上市价', value: toText(item.offerPrice, '--') },
      { label: '认购倍数', value: toText(item.subscriptionMultiple, '--') },
      { label: '中签率', value: toText(item.allotmentRate, '--') },
    ].filter((m) => m.value !== '--').slice(0, 3),
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
  (timelineSummary.subscribing || []).forEach((item) => { if (item.code) map[item.code] = 'subscribing'; });
  (timelineSummary.listingSoon || []).forEach((item) => { if (item.code) map[item.code] = 'listingSoon'; });
  (timelineSummary.recentListed || []).forEach((item) => { if (item.code) map[item.code] = 'recentListed'; });
  return map;
}

function buildHeroConclusion(topRecommendations, sentimentText) {
  const highScoreCount = topRecommendations.filter((item) => item.score >= 2).length;
  if (highScoreCount > 0) return `今日有 ${highScoreCount} 只可重点关注`;
  if (sentimentText === '偏热') return '市场偏热，但高分标的不多';
  return '今日暂无高分标的，建议观望';
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
      subscribing: [],
      listingSoon: [],
      recentListed: [],
    },
    marketSentiment: {
      text: '中性',
      className: 'sentiment-neutral',
    },
    heroConclusion: '今日暂无高分标的，建议观望',
    hasHighScore: false,
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
      const statusMap = buildStatusMap(timelineSummary);

      const topRecommendations = (Array.isArray(res.topList) ? res.topList : [])
        .map((item) => normalizeRecommendItem(item, statusMap))
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);

      const marketSentiment = mapSentiment(res.market || {});
      const heroConclusion = buildHeroConclusion(topRecommendations, marketSentiment.text);
      const hasHighScore = topRecommendations.some((item) => item.score >= 2);

      this.setData({
        loading: false,
        topRecommendations,
        recentPerformance: (timelineSummary.recentListed || []).map(normalizeRecentListedItem).slice(0, 5),
        windowGroups: {
          subscribing: (timelineSummary.subscribing || []).map(normalizeTimelineItem).slice(0, 3),
          listingSoon: (timelineSummary.listingSoon || []).map(normalizeTimelineItem).slice(0, 3),
          recentListed: (timelineSummary.recentListed || []).map(normalizeTimelineItem).slice(0, 3),
        },
        marketSentiment,
        heroConclusion,
        hasHighScore,
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

  onTapWindowCard(e) {
    const code = e.currentTarget.dataset.code;
    if (!code) return;
    this.goToScoreDetail(code);
  },

  onTapTimelineMore() {
    wx.navigateTo({
      url: '/pages/timeline/index',
      fail: () => {
        wx.showToast({ title: '无法打开时间表', icon: 'none' });
      },
    });
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
