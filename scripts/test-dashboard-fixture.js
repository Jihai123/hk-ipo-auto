#!/usr/bin/env node
process.env.IPO_DATA_MODE = 'fixture';
const { buildDashboard } = require('../services/dashboardService');

(async () => {
  const data = await buildDashboard({ forceRefresh: true });
  console.log('mode: fixture');
  console.log('top3:', data.top3.length);
  console.log('leaderboard:', data.leaderboard.length);
  console.log('timeline keys:', Object.keys(data.timeline).join(','));
  console.log(data.leaderboard.length ? 'PASS' : 'FAIL');
  process.exit(data.leaderboard.length ? 0 : 2);
})();
