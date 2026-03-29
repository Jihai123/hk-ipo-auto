const { request } = require('./api');

function normalizeWebsiteDimension(key, raw = {}) {
  const ev = raw.evidence;
  let source = '';
  let keywords = '';
  let snippet = '';

  if (ev && typeof ev === 'object') {
    if (Array.isArray(ev.sources) && ev.sources.length > 0) {
      source = ev.sources.map((s) => s.source).filter(Boolean).join('；');
      keywords = ev.sources.map((s) => s.keyword).filter(Boolean).join('、');
      snippet = ev.sources.map((s) => s.context).filter(Boolean).join('；');
    }

    source = source || ev.source || ev.section || '';
    keywords = keywords || ev.keyword || (Array.isArray(ev.matchedKeywords) ? ev.matchedKeywords.join('、') : '') || '';
    snippet = snippet || ev.context || ev.preIPOContext || (Array.isArray(ev.matchedContexts) ? ev.matchedContexts[0] : '') || '';
  }

  return {
    key,
    score: Number(raw.score) || 0,
    summary: raw.reason || '',
    detail: raw.details || '',
    reason: raw.reason || '',
    details: raw.details || '',
    evidence: ev ? {
      source,
      keywords,
      snippet,
      scoreRule: ev.scoreRule || '',
      raw: ev,
    } : null,
  };
}

function normalizeWebsiteScoreResponse(resp = {}, code) {
  const scores = resp.scores || {};
  const order = ['oldShares', 'sponsor', 'cornerstone', 'lockup', 'industry', 'pe', 'ipoSize'];

  const dimensions = order
    .filter((k) => scores[k] && Number.isFinite(scores[k].score))
    .map((k) => normalizeWebsiteDimension(k, scores[k]));

  return {
    success: true,
    code: resp.stockCode || code,
    name: resp.prospectus?.name || code,
    totalScore: Number(resp.totalScore) || 0,
    ratingLabel: resp.rating || '',
    dimensions,
    display: resp.display || {},
    legacyRating: resp.rating || '',
  };
}

async function fetchScore(code) {
  try {
    const websiteResp = await request(`/api/score/${encodeURIComponent(code)}`);
    if (websiteResp && websiteResp.success) {
      return normalizeWebsiteScoreResponse(websiteResp, code);
    }
  } catch (_) {
    // fallback below
  }

  return request(`/api/mp/score/${encodeURIComponent(code)}`);
}

module.exports = {
  fetchScore,
};
