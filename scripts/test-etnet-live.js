#!/usr/bin/env node
const { fetchIPODetailRecord, normalizeCode } = require('../services/etnetSource');

const args = process.argv.slice(2);
const codeArg = args.find((a) => a.startsWith('--code='));
const verbose = args.includes('--verbose');
const code = normalizeCode(codeArg ? codeArg.split('=')[1] : '');

if (!code) {
  console.error('Usage: node scripts/test-etnet-live.js --code=03355 [--verbose]');
  process.exit(1);
}

(async () => {
  try {
    const url = `https://www.etnet.com.hk/www/sc/stocks/ci_ipo_detail.php?code=${code}`;
    console.log(`Request URL: ${url}`);
    const { record, raw } = await fetchIPODetailRecord(code, { verbose });
    const fields = ['code','name','status','listing_date','offer_price','lot_size','lot_cost','subscription_multiple','success_rate','first_day_close'];
    const missing = fields.filter((k) => record[k] === null || record[k] === undefined || record[k] === '');
    console.log(`HTTP 状态: ${raw?._fetchStatus?.status === 'success' ? '200(解析成功)' : 'non-200/抓取失败'}`);
    console.log('解析字段:', record);
    console.log('缺失字段:', missing.length ? missing.join(', ') : '无');
    console.log(missing.length <= 5 ? 'PASS' : 'FAIL');
    process.exit(missing.length <= 5 ? 0 : 2);
  } catch (error) {
    console.error('FAIL', error.message);
    process.exit(2);
  }
})();
