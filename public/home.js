(function () {
  async function fetchWithPathFallback(path, init) {
    const primary = path.replace(/^\//, '');
    const fallback = `/${primary}`;
    let response = await fetch(primary, init);
    if (response.status !== 404 || fallback === primary) return response;
    return fetch(fallback, init);
  }

  function escapeHtml(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  const STATUS_LABEL_MAP = {
    subscribing: '招股中',
    listingSoon: '待上市',
    recentListed: '近期上市',
  };

  function getStatusLabel(status, fallbackStatus) {
    const normalized = status || fallbackStatus;
    return STATUS_LABEL_MAP[normalized] || '--';
  }

  function summarizeItem(item) {
    if (!item) return null;
    return {
      code: item.code || '--',
      name: item.name || '--',
      status: item.status || '--',
      listingDate: item.listingDate || '--',
      offerEndDate: item.offerEndDate || '--',
      offerPrice: item.offerPrice ?? '--',
      offerPriceRange: item.offerPriceRange ?? '--',
      lotSize: item.lotSize ?? '--',
      lotAmount: item.lotAmount ?? '--',
      subscriptionMultiple: item.subscriptionMultiple ?? '--',
      allotmentRate: item.allotmentRate ?? '--',
      firstDayChangePct: item.firstDayChangePct ?? '--',
    };
  }

  function getTopList(data) {
    if (Array.isArray(data?.data)) return data.data;
    if (Array.isArray(data?.ipos)) {
      return data.ipos.map((item) => ({
        code: item.code,
        name: item.name,
        totalScore: item.totalScore ?? item.score,
        rating: item.rating,
        scoreDetails: item.scoreDetails || item.scores || null,
        status: item.status,
        listingDate: item.listingDate,
      }));
    }
    return [];
  }

  function buildScoreDimensions(scoreDetails) {
    if (!scoreDetails || typeof scoreDetails !== 'object') return [];
    const defs = [
      { key: 'oldShares', label: '旧股发售', min: -2, max: 0 },
      { key: 'sponsor', label: '保荐人', min: -2, max: 2 },
      { key: 'cornerstone', label: '基石投资', min: 0, max: 2 },
      { key: 'lockup', label: '基石禁售期', min: -2, max: 0 },
      { key: 'industry', label: '行业赛道', min: -2, max: 2 },
    ];

    return defs
      .filter((def) => scoreDetails[def.key] && Number.isFinite(scoreDetails[def.key].score))
      .map((def) => {
        const raw = Number(scoreDetails[def.key].score);
        const clamped = Math.max(def.min, Math.min(def.max, raw));
        const pct = ((clamped - def.min) / (def.max - def.min)) * 100;
        const tone = raw > 0 ? 'positive' : raw < 0 ? 'negative' : 'neutral';
        const signed = raw > 0 ? `+${raw}` : `${raw}`;
        return { ...def, score: raw, scoreText: signed, width: pct, tone };
      });
  }

  function getCurrentData(data) {
    if (data?.data) return data.data;
    return {
      subscribing: data?.subscribing || [],
      listingSoon: data?.coming || [],
      recentListed: data?.listed || [],
    };
  }

  function renderTopList(list) {
    const container = document.getElementById('topIPOList');
    if (!container) return;

    if (!list.length) {
      container.innerHTML = '<div class="home-empty-state">暂无可展示评分榜数据</div>';
      return;
    }

    container.innerHTML = list.map((ipo, index) => {
      const score = Number(ipo.totalScore ?? 0);
      const scoreColor = score > 0 ? 'var(--color-success)' : score < 0 ? 'var(--color-danger)' : 'var(--color-text-muted)';
      const scoreTone = score > 0 ? 'positive' : score < 0 ? 'negative' : 'neutral';
      const status = getStatusLabel(ipo.status);
      const listingDate = ipo.listingDate || '-';
      const ratingTag = ipo.rating || (score >= 2 ? '推荐申购' : score >= 0 ? '谨慎申购' : '不建议');
      const ratingClass = score >= 2 ? 'is-recommend' : score >= 0 ? 'is-cautious' : 'is-avoid';
      const dims = buildScoreDimensions(ipo.scoreDetails);
      return `
        <div class="home-top-item home-signal-card home-score-${scoreTone}" onclick="quickSearch('${escapeHtml(ipo.code)}')">
          <div class="home-score-side-bar"></div>
          <div class="home-top-main home-signal-main">
            <div class="home-top-rank">#${index + 1}</div>
            <div class="home-top-meta home-signal-meta">
              <div class="home-stock-title home-stock-title-strong">
                <span class="home-stock-name">${escapeHtml(ipo.name)}</span>
                <span class="home-stock-code">（${escapeHtml(ipo.code)}）</span>
              </div>
              <div class="home-row-sub home-signal-sub">${escapeHtml(status)} · 上市日 ${escapeHtml(listingDate)}</div>
              <div class="home-signal-conclusion">
                <span class="home-rating-badge ${ratingClass}">${escapeHtml(ratingTag)}</span>
              </div>
              <div class="home-mini-metrics">
                ${dims.length ? dims.map((dim) => `
                  <div class="home-mini-metric">
                    <div class="home-mini-label">${dim.label} <span>${dim.scoreText}分</span></div>
                    <div class="home-mini-track">
                      <div class="home-mini-fill home-mini-${dim.tone}" style="width:${dim.width}%"></div>
                    </div>
                  </div>
                `).join('') : '<div class="home-mini-empty">暂无维度评分明细</div>'}
              </div>
            </div>
          </div>
          <div class="home-score-box">
            <div class="home-score-label">综合评分</div>
            <div class="home-score-value" style="color:${scoreColor};">${score}</div>
          </div>
        </div>
      `;
    }).join('');
  }

  function getChangeDisplay(raw) {
    const value = Number.parseFloat(String(raw ?? '').replace('%', ''));
    if (!Number.isFinite(value)) {
      return { text: '--', color: 'var(--color-market-flat)', className: 'is-flat', arrow: '' };
    }
    if (value > 0) {
      return { text: `+${value.toFixed(2)}%`, color: 'var(--color-success)', className: 'is-up', arrow: '▲' };
    }
    if (value < 0) {
      return { text: `${value.toFixed(2)}%`, color: 'var(--color-danger)', className: 'is-down', arrow: '▼' };
    }
    return { text: '0.00%', color: 'var(--color-market-flat)', className: 'is-flat', arrow: '' };
  }

  function getOfferDeadlineMeta(rawDate) {
    const dateText = rawDate || '--';
    const parsed = new Date(`${dateText}T00:00:00+08:00`);
    if (Number.isNaN(parsed.getTime())) {
      return { text: dateText, urgent: false, hint: '' };
    }
    const now = new Date();
    const diffMs = parsed.getTime() - now.getTime();
    const diffDays = Math.ceil(diffMs / (24 * 60 * 60 * 1000));
    if (diffDays <= 1) return { text: dateText, urgent: true, hint: '即将截止' };
    return { text: dateText, urgent: false, hint: '' };
  }

  function timelineCard(title, items, mode) {
    const timelineItems = (items || []).slice(0, 8);
    console.log(`[home.js] timelineCard mode=${mode}, preview=${JSON.stringify(timelineItems.slice(0, 2).map(summarizeItem))}`);

    const rows = timelineItems.map((ipo) => {
      const fallback = '--';
      const listing = ipo.listingDate || fallback;
      const offerEndDate = ipo.offerEndDate || fallback;
      const offerPrice = ipo.offerPriceRange ? `${ipo.offerPriceRange}` : (ipo.offerPrice ?? fallback);
      const lotSize = ipo.lotSize ?? fallback;
      const lotAmount = ipo.lotAmount ?? fallback;
      const subscriptionMultiple = ipo.subscriptionMultiple ?? fallback;
      const allotmentRate = ipo.allotmentRate ?? fallback;
      const change = getChangeDisplay(ipo.firstDayChangePct);
      const status = escapeHtml(getStatusLabel(ipo.status, mode));

      if (mode === 'recentListed') {
        return `
          <div class="home-ipo-row home-result-row">
            <div class="home-result-main">
              <div class="home-stock-title home-stock-title-strong">
                <span class="home-stock-name">${escapeHtml(ipo.name || fallback)}</span>
                <span class="home-stock-code">（${escapeHtml(ipo.code || fallback)}）</span>
              </div>
              <div class="home-row-sub">近期上市 · 上市日 ${escapeHtml(listing)}</div>
              <div class="home-listing-price">上市价 <span class="home-num">${escapeHtml(String(ipo.offerPrice ?? fallback))}</span></div>
              <div class="home-recent-metrics">
                <div class="home-recent-metric"><span>认购倍数</span><strong class="home-num">${escapeHtml(String(subscriptionMultiple))}</strong></div>
                <div class="home-recent-metric"><span>中签率</span><strong class="home-num">${escapeHtml(String(allotmentRate))}%</strong></div>
                <div class="home-recent-metric"><span>累积回报</span><strong class="home-num">${escapeHtml(change.text)}</strong></div>
              </div>
            </div>
            <div class="home-result-change ${change.className}" style="color:${change.color};">
              <div class="home-result-label">累积升跌</div>
              <div class="home-result-value">${escapeHtml(change.arrow)} ${escapeHtml(change.text)}</div>
            </div>
          </div>
        `;
      }

      if (mode === 'subscribing') {
        const offerMeta = getOfferDeadlineMeta(offerEndDate);
        return `
          <div class="home-ipo-row home-time-card">
            <div class="home-stock-title home-stock-title-strong">
              <span class="home-stock-name">${escapeHtml(ipo.name || fallback)}</span>
              <span class="home-stock-code">（${escapeHtml(ipo.code || fallback)}）</span>
            </div>
            <div class="home-row-sub">${status} · 上市日 ${escapeHtml(listing)}</div>
            <div class="home-deadline-badge ${offerMeta.urgent ? 'is-urgent' : ''}">
              <span class="home-deadline-label">${offerMeta.hint ? `${offerMeta.hint} · ` : ''}截止认购</span>
              <span class="home-deadline-date home-num">${escapeHtml(String(offerMeta.text))}</span>
            </div>
            <div class="home-field-grid">
              <div class="home-field-item">
                <div class="home-field-label">发行价</div>
                <div class="home-field-value home-num">${escapeHtml(String(offerPrice))}</div>
              </div>
              <div class="home-field-item">
                <div class="home-field-label">每手</div>
                <div class="home-field-value home-num">${escapeHtml(String(lotSize))}</div>
              </div>
              <div class="home-field-item">
                <div class="home-field-label">入场费</div>
                <div class="home-field-value home-num">${escapeHtml(String(lotAmount))}</div>
              </div>
            </div>
          </div>
        `;
      }

      return `
        <div class="home-ipo-row">
          <div class="home-stock-title">
            <span class="home-stock-name">${escapeHtml(ipo.name || fallback)}</span>
            <span class="home-stock-code">（${escapeHtml(ipo.code || fallback)}）</span>
          </div>
          <div class="home-row-sub">${status} · 上市日 ${escapeHtml(listing)}</div>
          <div class="home-row-metric">发行价 <span class="home-num">${escapeHtml(String(offerPrice))}</span></div>
          <div class="home-row-metric">每手 <span class="home-num">${escapeHtml(String(lotSize))}</span> · 入场费 <span class="home-emphasis home-num">${escapeHtml(String(lotAmount))}</span></div>
        </div>
      `;
    }).join('');

    const count = timelineItems.length;
    const emptyText = mode === 'listingSoon'
      ? '<div class="home-empty-state-box"><div class="home-empty-icon">🕒</div><div class="home-empty-title">暂无待上市新股</div></div>'
      : '<div style="padding:12px 0;color:var(--color-text-muted);font-size:13px;">暂无数据</div>';

    return `
      <div class="home-timeline-card">
        <h3 class="home-timeline-title">${title} <span class="home-title-badge">${count}</span></h3>
        ${rows || emptyText}
      </div>
    `;
  }

  function renderTimeline(data) {
    const container = document.getElementById('ipoTimeline');
    if (!container) return;
    console.log(`[home.js] renderTimeline groups: subscribingFirst=${JSON.stringify(summarizeItem(data?.subscribing?.[0]))}, listingSoonFirst=${JSON.stringify(summarizeItem(data?.listingSoon?.[0]))}, recentListedFirst=${JSON.stringify(summarizeItem(data?.recentListed?.[0]))}`);

    container.innerHTML = [
      timelineCard('招股中', data.subscribing, 'subscribing'),
      timelineCard('待上市', data.listingSoon, 'listingSoon'),
      timelineCard('近期上市', data.recentListed, 'recentListed'),
    ].join('');
  }

  async function loadTopList() {
    const container = document.getElementById('topIPOList');
    if (container) {
      container.innerHTML = '<div class="home-empty-state">评分榜加载中...</div>';
    }

    try {
      const response = await fetchWithPathFallback('api/ipo/top?limit=8');
      const json = await response.json();
      renderTopList(getTopList(json));
    } catch (err) {
      if (container) {
        container.innerHTML = '<div class="home-empty-state" style="color:var(--color-danger);">评分榜加载失败</div>';
      }
    }
  }

  async function loadTimeline() {
    const container = document.getElementById('ipoTimeline');
    if (container) {
      container.innerHTML = '<div class="home-empty-state home-empty-span">新股时间表加载中...</div>';
    }

    try {
      const response = await fetchWithPathFallback('api/ipo/current');
      const json = await response.json();
      const currentData = getCurrentData(json);
      console.log(`[home.js] /api/ipo/current loaded: counts=${JSON.stringify({
        subscribingCount: currentData?.subscribing?.length || 0,
        listingSoonCount: currentData?.listingSoon?.length || 0,
        recentListedCount: currentData?.recentListed?.length || 0,
      })}, sample=${JSON.stringify({
        subscribingFirst: summarizeItem(currentData?.subscribing?.[0]),
        recentListedFirst: summarizeItem(currentData?.recentListed?.[0]),
      })}`);
      renderTimeline(currentData);
    } catch (err) {
      if (container) {
        container.innerHTML = '<div class="home-empty-state home-empty-span" style="color:var(--color-danger);">新股时间表加载失败</div>';
      }
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    loadTopList();
    loadTimeline();
  });
})();
