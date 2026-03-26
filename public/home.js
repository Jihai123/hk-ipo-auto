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
        status: item.status,
        listingDate: item.listingDate,
      }));
    }
    return [];
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
      const scoreColor = score >= 4 ? 'var(--color-success)' : score >= 2 ? 'var(--color-warning)' : score >= 0 ? 'var(--color-text-secondary)' : 'var(--color-danger)';
      const status = getStatusLabel(ipo.status);
      const listingDate = ipo.listingDate || '-';
      return `
        <div class="home-top-item" onclick="quickSearch('${escapeHtml(ipo.code)}')">
          <div class="home-top-main">
            <div class="home-top-rank">#${index + 1}</div>
            <div class="home-top-meta">
              <div class="home-stock-title">
                <span class="home-stock-name">${escapeHtml(ipo.name)}</span>
                <span class="home-stock-code">（${escapeHtml(ipo.code)}）</span>
              </div>
              <div class="home-row-sub">${escapeHtml(status)} · 上市日 ${escapeHtml(listingDate)}</div>
              <div class="home-top-rating" style="color:${scoreColor};">${escapeHtml(ipo.rating || '待评级')}</div>
            </div>
          </div>
          <div class="home-score-value" style="color:${scoreColor};">${score}</div>
        </div>
      `;
    }).join('');
  }

  function getChangeDisplay(raw) {
    const value = Number.parseFloat(String(raw ?? '').replace('%', ''));
    if (!Number.isFinite(value)) {
      return { text: '--', color: 'var(--color-text-muted)', className: 'is-flat' };
    }
    if (value > 0) {
      return { text: `+${value}%`, color: 'var(--color-success)', className: 'is-up' };
    }
    if (value < 0) {
      return { text: `${value}%`, color: 'var(--color-danger)', className: 'is-down' };
    }
    return { text: '0.00%', color: 'var(--color-text-secondary)', className: 'is-flat' };
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
          <div class="home-ipo-row home-row-recent">
            <div class="home-row-head">
              <div class="home-stock-title">
                <span class="home-stock-name">${escapeHtml(ipo.name || fallback)}</span>
                <span class="home-stock-code">（${escapeHtml(ipo.code || fallback)}）</span>
              </div>
              <div class="home-change-pill ${change.className}" style="color:${change.color};">${escapeHtml(change.text)}</div>
            </div>
            <div class="home-row-sub">${status} · 上市日 ${escapeHtml(listing)}</div>
            <div class="home-row-metric">上市价 <span>${escapeHtml(String(ipo.offerPrice ?? fallback))}</span></div>
            <div class="home-row-metric">认购 <span>${escapeHtml(String(subscriptionMultiple))} 倍</span> · 中签率 <span>${escapeHtml(String(allotmentRate))}%</span></div>
            <div class="home-row-focus">累积升跌 <span style="color:${change.color};">${escapeHtml(change.text)}</span></div>
          </div>
        `;
      }

      if (mode === 'subscribing') {
        return `
          <div class="home-ipo-row">
            <div class="home-stock-title">
              <span class="home-stock-name">${escapeHtml(ipo.name || fallback)}</span>
              <span class="home-stock-code">（${escapeHtml(ipo.code || fallback)}）</span>
            </div>
            <div class="home-row-sub">${status} · 上市日 ${escapeHtml(listing)}</div>
            <div class="home-offer-end">截止认购 <span>${escapeHtml(String(offerEndDate))}</span></div>
            <div class="home-row-metric">发行价 <span>${escapeHtml(String(offerPrice))}</span> · 每手 <span>${escapeHtml(String(lotSize))}</span> · 入场费 <span class="home-emphasis">${escapeHtml(String(lotAmount))}</span></div>
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
          <div class="home-row-metric">发行价 <span>${escapeHtml(String(offerPrice))}</span></div>
          <div class="home-row-metric">每手 <span>${escapeHtml(String(lotSize))}</span> · 入场费 <span class="home-emphasis">${escapeHtml(String(lotAmount))}</span></div>
        </div>
      `;
    }).join('');

    return `
      <div class="home-timeline-card">
        <h3 class="home-timeline-title">${title}</h3>
        ${rows || '<div style="padding:12px 0;color:var(--color-text-muted);font-size:13px;">暂无数据</div>'}
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
