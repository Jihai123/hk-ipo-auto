#!/usr/bin/env node
const { fetchIPODetailRecord, normalizeCode } = require('../services/etnetSource');

const CORE_FIELDS = ['code', 'name', 'listing_date', 'offer_price', 'lot_size', 'lot_cost'];
const EXTENDED_FIELDS = ['status', 'subscription_multiple', 'success_rate', 'first_day_close'];

function hasValue(v) {
  return !(v === null || v === undefined || v === '');
}

function pct(done, total) {
  if (!total) return '0/0 (0%)';
  return `${done}/${total} (${Math.round((done / total) * 100)}%)`;
}

function classifyResult({ httpStatus, dataSource, coreMissing, extMissing, record }) {
  const coreComplete = coreMissing.length === 0;
  const extPresent = EXTENDED_FIELDS.length - extMissing.length;
  const extMostlyComplete = extPresent >= 3;
  const hasSomeData = Object.values(record).filter(hasValue).length >= 2;

  const isHttp200 = httpStatus === 200;
  const isLiveSource = dataSource === 'live_http';
  const isDegradedSource = ['cache', 'fallback', 'fixture'].includes(dataSource);

  if (isHttp200 && isLiveSource && coreComplete && extMostlyComplete) {
    return { level: 'PASS', exitCode: 0 };
  }

  if (hasSomeData && (!isHttp200 || isDegradedSource || !coreComplete || !extMostlyComplete)) {
    return { level: 'PARTIAL', exitCode: 1 };
  }

  return { level: 'FAIL', exitCode: 2 };
}

const args = process.argv.slice(2);
const codeArg = args.find((a) => a.startsWith('--code='));
const verbose = args.includes('--verbose');
const noCache = args.includes('--no-cache');
const code = normalizeCode(codeArg ? codeArg.split('=')[1] : '');

if (!code) {
  console.error('Usage: node scripts/test-etnet-live.js --code=03355 [--verbose] [--no-cache]');
  process.exit(1);
}

(async () => {
  try {
    const requestUrl = `https://www.etnet.com.hk/www/sc/stocks/ci_ipo_detail.php?code=${code}`;
    const { record, raw } = await fetchIPODetailRecord(code, { verbose, noCache });

    const httpStatus = raw?._fetchStatus?.httpStatus ?? (raw?._fetchStatus?.status === 'success' ? 200 : null);
    const dataSource = raw?._dataSource || (process.env.IPO_DATA_MODE === 'fixture' ? 'fixture' : 'fallback');

    const coreMissing = CORE_FIELDS.filter((k) => !hasValue(record[k]));
    const extMissing = EXTENDED_FIELDS.filter((k) => !hasValue(record[k]));
    const allMissing = [...new Set([...coreMissing, ...extMissing])];

    const result = classifyResult({
      httpStatus,
      dataSource,
      coreMissing,
      extMissing,
      record,
    });

    console.log(`Request URL: ${requestUrl}`);
    console.log(`HTTP status: ${httpStatus ?? 'unknown/non-http'}`);
    console.log(`Data source: ${dataSource}`);
    console.log(`Core fields completeness: ${pct(CORE_FIELDS.length - coreMissing.length, CORE_FIELDS.length)}`);
    console.log(`Extended fields completeness: ${pct(EXTENDED_FIELDS.length - extMissing.length, EXTENDED_FIELDS.length)}`);
    console.log(`Missing fields: ${allMissing.length ? allMissing.join(', ') : 'none'}`);
    console.log(`Final result: ${result.level}`);

    if (verbose) {
      console.log('Parsed record:', record);
      console.log('Raw meta:', {
        fetchStatus: raw?._fetchStatus || null,
        dataSource: raw?._dataSource || null,
        cacheHit: raw?._cacheHit || false,
        noCache,
      });
    }

    process.exit(result.exitCode);
  } catch (error) {
    console.error('Final result: FAIL');
    console.error(`Error: ${error.message}`);
    process.exit(2);
  }
})();
