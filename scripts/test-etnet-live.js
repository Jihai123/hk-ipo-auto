#!/usr/bin/env node
const { fetchIPOBatch, normalizeCode } = require('../services/etnetSource');

const args = process.argv.slice(2);
const codeArg = args.find((a) => a.startsWith('--code='));
const verbose = args.includes('--verbose');
const targetCode = normalizeCode(codeArg ? codeArg.split('=')[1] : '');

function pick(arr, code) {
  if (!code) return arr[0] || null;
  return arr.find((x) => x.code === code) || null;
}

(async () => {
  try {
    const data = await fetchIPOBatch({ limit: 30, verbose });
    const rec = pick(data.items || [], targetCode);

    console.log('Source section coverage:', data.section_counts || {});
    console.log('List source:', data.list_meta?.url || 'N/A');
    console.log('Detail source:', rec?._source?.detail_source || 'N/A');
    console.log('Fallback source:', rec?._source?.fallback_source || 'N/A');

    if (!rec) {
      console.log('Final result: FAIL (no record found)');
      process.exit(2);
    }

    const fsMap = rec._source?.field_sources || {};
    console.log('Field source map:');
    Object.entries(fsMap).forEach(([k, v]) => console.log(`  - ${k}: ${v}`));

    console.log('Name 来源证据:', rec._source?.name_evidence || fsMap.name || 'unknown');
    console.log('Status 来源证据:', rec._source?.status_evidence || fsMap.status || 'unknown');

    console.log('Record preview:', {
      code: rec.code,
      name: rec.name,
      status: rec.status,
      listing_date: rec.listing_date,
      offer_price: rec.offer_price,
      lot_size: rec.lot_size,
      lot_cost: rec.lot_cost,
      subscription_multiple: rec.subscription_multiple,
      success_rate: rec.success_rate,
      current_price: rec.current_price,
      source_sections: rec._source?.source_sections || [],
      data_completeness: rec.data_completeness,
      source_coverage: rec.source_coverage,
    });

    const pass = !!rec.name && !!rec.status;
    console.log(`Final result: ${pass ? 'PASS' : 'PARTIAL'}`);
    process.exit(pass ? 0 : 1);
  } catch (error) {
    console.error('Final result: FAIL');
    console.error(`Error: ${error.message}`);
    process.exit(2);
  }
})();
