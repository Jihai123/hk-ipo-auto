#!/usr/bin/env node
process.env.IPO_DATA_MODE = 'fixture';
const { fetchIPOBatch } = require('../services/etnetSource');

(async () => {
  const result = await fetchIPOBatch({ limit: 10 });
  console.log('mode:', result.mode);
  console.log('items:', result.items.length);
  console.log('warnings:', result.warnings.length);
  console.log(result.items.length > 0 ? 'PASS' : 'FAIL');
  process.exit(result.items.length > 0 ? 0 : 2);
})();
