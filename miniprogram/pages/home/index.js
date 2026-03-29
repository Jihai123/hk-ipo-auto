const { fetchHome } = require('../../services/home');
const {
  sanitizeCodeInput,
  normalizeStockCode,
  loadSearchHistory,
  pushSearchHistory,
} = require('../../utils/search');

function toText(value) {
  return (value === null || value === undefined || value === '') ? '--' : String(value);
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
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

function normalizeRecommendItem(item = {}) {
  const score = toNumber(item.score);
  const levelMeta = getLevelMeta(score);
  const ratingLabelText = item.ratingLabel || item.legacyRating || '中性观察';
  return {
    code: item.code || '',
    codeText: item.code || '--',
    nameText: item.name || item.code || '--',
    score,
    scoreText: toText(item.score),
    listingDateText: toText(item.listingDate),
    ratingLabelText,
    ratingToneClass: getRatingToneClass(ratingLabelText),
    shortReasonText: getShortReasonText(item),
    levelText: levelMeta.text,
    levelClass: levelMeta.className,
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

Page({
  data: {
    loading: true,
    error: '',
    searchCode: '',
    recentSearches: [],
    topRecommendations: [],
    windowGroups: {
      subscribing: [],
      listingSoon: [],
      recentListed: [],
    },
    marketSentiment: {
      text: '中性',
      className: 'sentiment-neutral',
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

      const topRecommendations = (Array.isArray(res.topList) ? res.topList : [])
        .map(normalizeRecommendItem)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);

      const timelineSummary = res.timelineSummary || {};

      this.setData({
        loading: false,
        topRecommendations,
        windowGroups: {
          subscribing: (timelineSummary.subscribing || []).map(normalizeTimelineItem).slice(0, 3),
          listingSoon: (timelineSummary.listingSoon || []).map(normalizeTimelineItem).slice(0, 3),
          recentListed: (timelineSummary.recentListed || []).map(normalizeTimelineItem).slice(0, 3),
        },
        marketSentiment: mapSentiment(res.market || {}),
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
