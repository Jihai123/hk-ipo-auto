(function () {
  function escapeHtml(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
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
      container.innerHTML = '<div style="text-align:center;padding:36px;color:var(--color-text-muted);background:#fff;border:1px solid var(--color-border);border-radius:12px;">暂无可展示评分榜数据</div>';
      return;
    }

    container.innerHTML = list.map((ipo, index) => {
      const score = Number(ipo.totalScore ?? 0);
      const scoreColor = score >= 4 ? 'var(--color-success)' : score >= 2 ? 'var(--color-warning)' : score >= 0 ? 'var(--color-text-secondary)' : 'var(--color-danger)';
      const status = ipo.status || '-';
      const listingDate = ipo.listingDate || '-';
      return `
        <div style="background:#fff;border-radius:12px;padding:16px;border:1px solid var(--color-border);display:flex;justify-content:space-between;gap:12px;align-items:center;cursor:pointer;" onclick="quickSearch('${escapeHtml(ipo.code)}')">
          <div style="display:flex;align-items:center;gap:12px;min-width:0;">
            <div style="font-size:20px;font-weight:800;color:#cbd5e1;width:28px;">#${index + 1}</div>
            <div>
              <div style="font-weight:700;color:var(--color-text-primary);">${escapeHtml(ipo.name)} <span style="font-family:monospace;color:var(--color-text-secondary);">(${escapeHtml(ipo.code)})</span></div>
              <div style="font-size:12px;color:var(--color-text-secondary);">${escapeHtml(status)} · 上市日 ${escapeHtml(listingDate)}</div>
              <div style="font-size:12px;color:${scoreColor};font-weight:600;">${escapeHtml(ipo.rating || '待评级')}</div>
            </div>
          </div>
          <div style="font-size:30px;font-weight:800;color:${scoreColor};font-variant-numeric:tabular-nums;">${score}</div>
        </div>
      `;
    }).join('');
  }

  function timelineCard(title, items, mode) {
    const rows = (items || []).slice(0, 8).map((ipo) => {
      const listing = ipo.listingDate || '-';
      const price = ipo.offerPriceRange ? `${ipo.offerPriceRange}` : (ipo.offerPrice ?? '-');
      const lotAmount = ipo.lotAmount ?? '-';
      const basic = `${escapeHtml(ipo.code || '-')} · ${escapeHtml(ipo.name || '-')}`;
      const status = escapeHtml(ipo.status || mode);

      if (mode === 'recentListed') {
        return `
          <div style="padding:10px 0;border-bottom:1px dashed var(--color-border);">
            <div style="font-weight:600;color:var(--color-text-primary);">${basic}</div>
            <div style="font-size:12px;color:var(--color-text-secondary);">${status} · 上市日 ${escapeHtml(listing)}</div>
          </div>
        `;
      }

      return `
        <div style="padding:10px 0;border-bottom:1px dashed var(--color-border);">
          <div style="font-weight:600;color:var(--color-text-primary);">${basic}</div>
          <div style="font-size:12px;color:var(--color-text-secondary);">${status} · 上市日 ${escapeHtml(listing)}</div>
          <div style="font-size:12px;color:var(--color-text-muted);">招股价 ${escapeHtml(String(price))} · 入场费 ${escapeHtml(String(lotAmount))}</div>
        </div>
      `;
    }).join('');

    return `
      <div style="background:#fff;border:1px solid var(--color-border);border-radius:12px;padding:16px;">
        <h3 style="font-size:18px;font-weight:700;margin-bottom:8px;color:var(--color-text-primary);">${title}</h3>
        ${rows || '<div style="padding:12px 0;color:var(--color-text-muted);font-size:13px;">暂无数据</div>'}
      </div>
    `;
  }

  function renderTimeline(data) {
    const container = document.getElementById('ipoTimeline');
    if (!container) return;

    container.innerHTML = [
      timelineCard('招股中', data.subscribing, 'subscribing'),
      timelineCard('待上市', data.listingSoon, 'listingSoon'),
      timelineCard('近期上市', data.recentListed, 'recentListed'),
    ].join('');
  }

  async function loadTopList() {
    const container = document.getElementById('topIPOList');
    if (container) {
      container.innerHTML = '<div style="text-align:center;padding:32px;color:var(--color-text-muted);background:#fff;border:1px solid var(--color-border);border-radius:12px;">评分榜加载中...</div>';
    }

    try {
      const response = await fetch('/api/ipo/top?limit=8');
      const json = await response.json();
      renderTopList(getTopList(json));
    } catch (err) {
      if (container) {
        container.innerHTML = '<div style="text-align:center;padding:32px;color:var(--color-danger);background:#fff;border:1px solid var(--color-border);border-radius:12px;">评分榜加载失败</div>';
      }
    }
  }

  async function loadTimeline() {
    const container = document.getElementById('ipoTimeline');
    if (container) {
      container.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:32px;color:var(--color-text-muted);background:#fff;border:1px solid var(--color-border);border-radius:12px;">新股时间表加载中...</div>';
    }

    try {
      const response = await fetch('/api/ipo/current');
      const json = await response.json();
      renderTimeline(getCurrentData(json));
    } catch (err) {
      if (container) {
        container.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:32px;color:var(--color-danger);background:#fff;border:1px solid var(--color-border);border-radius:12px;">新股时间表加载失败</div>';
      }
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    loadTopList();
    loadTimeline();
  });
})();
