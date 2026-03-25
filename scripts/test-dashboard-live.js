#!/usr/bin/env node
const { buildDashboard } = require('../services/dashboardService');

(async () => {
  try {
    const data = await buildDashboard({ sortBy: 'score', forceRefresh: true });
    const top3 = data.top3 || [];
    const board = data.leaderboard || [];

    const countByStatus = board.reduce((acc, item) => {
      const k = item.status || 'unknown';
      acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {});

    const top3Completeness = top3.map((item) => {
      const fields = ['code', 'name', 'score', 'rating', 'status', 'lot_cost', 'listing_date'];
      const filled = fields.filter((f) => item[f] !== '暂无数据' && item[f] !== null && item[f] !== undefined && item[f] !== '').length;
      return { code: item.code, completeness: `${filled}/${fields.length}` };
    });

    const hasNullName = board.some((i) => i.name === null || i.name === undefined || i.name === '暂无数据');
    const leakedPE = board.some((i) => ['pe', 'pe_score', 'pe_reason', 'pe_details'].some((k) => Object.prototype.hasOwnProperty.call(i, k)));

    console.log('来自招股中/今日上市/暗盘/新股信息的条数:', {
      subscribing: countByStatus.subscribing || 0,
      listed_today: countByStatus.listed_today || 0,
      grey_market: countByStatus.grey_market || 0,
      listed: countByStatus.listed || 0,
    });
    console.log('top3 字段完整度:', top3Completeness);
    console.log('是否存在 name=null:', hasNullName ? 'YES' : 'NO');
    console.log('是否仍向前端暴露 PE 展示字段:', leakedPE ? 'YES' : 'NO');

    const pass = top3.length > 0 && !leakedPE;
    console.log(pass ? 'PASS' : 'FAIL');
    process.exit(pass ? 0 : 2);
  } catch (error) {
    console.error('FAIL', error.message);
    process.exit(2);
  }
})();
