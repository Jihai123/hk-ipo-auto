const { request } = require('./api.js');

function safeJoin(arr, sep) {
  if (!Array.isArray(arr)) return '';
  return arr.filter(function (x) { return !!x; }).join(sep);
}

function normalizeWebsiteDimension(key, raw) {
  const item = raw || {};
  const ev = item.evidence;
  let source = '';
  let keywords = '';
  let snippet = '';

  if (ev && typeof ev === 'object') {
    if (Array.isArray(ev.sources) && ev.sources.length > 0) {
      source = safeJoin(ev.sources.map(function (s) { return s && s.source; }), '；');
      keywords = safeJoin(ev.sources.map(function (s) { return s && s.keyword; }), '、');
      snippet = safeJoin(ev.sources.map(function (s) { return s && s.context; }), '；');
    }

    source = source || ev.source || ev.section || '';
    keywords = keywords || ev.keyword || (Array.isArray(ev.matchedKeywords) ? ev.matchedKeywords.join('、') : '') || '';
    snippet = snippet || ev.context || ev.preIPOContext || (Array.isArray(ev.matchedContexts) ? ev.matchedContexts[0] : '') || '';
  }

  return {
    key: key,
    score: Number(item.score) || 0,
    summary: item.reason || '',
    detail: item.details || '',
    reason: item.reason || '',
    details: item.details || '',
    evidence: ev ? {
      source: source,
      keywords: keywords,
      snippet: snippet,
      scoreRule: ev.scoreRule || '',
      raw: ev,
    } : null,
  };
}

function normalizeWebsiteScoreResponse(resp, code) {
  const payload = resp || {};
  const scores = payload.scores || {};
  const order = ['oldShares', 'sponsor', 'cornerstone', 'lockup', 'industry', 'pe', 'ipoSize'];

  const dimensions = order
    .filter(function (k) { return scores[k] && Number.isFinite(scores[k].score); })
    .map(function (k) { return normalizeWebsiteDimension(k, scores[k]); });

  return {
    success: true,
    code: payload.stockCode || code,
    name: (payload.prospectus && payload.prospectus.name) || code,
    totalScore: Number(payload.totalScore) || 0,
    ratingLabel: payload.rating || '',
    dimensions: dimensions,
    display: payload.display || {},
    legacyRating: payload.rating || '',
  };
}

function fetchScore(code) {
  const stockCode = encodeURIComponent(code);

  return request('/api/score/' + stockCode)
    .then(function (websiteResp) {
      if (websiteResp && websiteResp.success) {
        return normalizeWebsiteScoreResponse(websiteResp, code);
      }
      return request('/api/mp/score/' + stockCode);
    })
    .catch(function () {
      return request('/api/mp/score/' + stockCode);
    });
}

module.exports = {
  fetchScore,
};
