#!/usr/bin/env node
const { buildDashboard } = require('../services/dashboardService');

(async () => {
  try {
    const data = await buildDashboard({ sortBy: 'score', forceRefresh: true });
    const hasBad = JSON.stringify(data).includes('undefined') || JSON.stringify(data).includes(':null');
    console.log('top3 数量:', data.top3.length);
    console.log('榜单数量:', data.leaderboard.length);
    console.log('timeline 数量:', Object.values(data.timeline).reduce((a, v) => a + v.length, 0));
    console.log('市场温度指标:', data.market_temperature);
    console.log('是否出现 undefined/null:', hasBad ? 'YES' : 'NO');
    console.log(!hasBad && data.top3.length > 0 ? 'PASS' : 'FAIL');
    process.exit(!hasBad && data.top3.length > 0 ? 0 : 2);
  } catch (error) {
    console.error('FAIL', error.message);
    process.exit(2);
  }
})();
