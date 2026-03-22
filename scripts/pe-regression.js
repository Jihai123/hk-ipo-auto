#!/usr/bin/env node
/**
 * PE 端到端回归脚本
 * - 复用现有 /api/score 接口，批量跑指定 IPO case
 * - 汇总净利润提取、行业映射、同行 PE 抓取、最终 PE 分布与 confidence 分布
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const PROJ_ROOT = path.join(__dirname, '..');
const CACHE_DIR = path.join(PROJ_ROOT, 'cache');
const HISTORY_JSON = path.join(PROJ_ROOT, 'data', 'ipo-history.json');
const OUTPUT_DIR = path.join(PROJ_ROOT, 'artifacts');

function uniq(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function collectCodes() {
  const cacheCodes = fs.existsSync(CACHE_DIR)
    ? fs.readdirSync(CACHE_DIR)
      .filter(name => /^\d{5}\.txt$/.test(name))
      .map(name => name.replace('.txt', ''))
    : [];

  let historyCodes = [];
  if (fs.existsSync(HISTORY_JSON)) {
    const history = JSON.parse(fs.readFileSync(HISTORY_JSON, 'utf8'));
    historyCodes = (history.recentIPOs || []).map(item => String(item.code || '').replace(/\D/g, '').padStart(5, '0'));
  }

  return uniq([...cacheCodes, ...historyCodes]);
}

function requestJson(url, timeoutMs = 300000) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https://') ? https : http;
    const req = lib.get(url, res => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { buf += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`HTTP ${res.statusCode}: ${buf.slice(0, 300)}`));
        }
        try {
          resolve(JSON.parse(buf));
        } catch (err) {
          reject(new Error(`JSON parse error: ${err.message}`));
        }
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`timeout after ${timeoutMs}ms`)));
    req.on('error', reject);
  });
}

function confidenceBucket(v) {
  return v || 'none';
}

function buildHistogram(values, buckets) {
  const stats = {};
  for (const bucket of buckets) stats[bucket] = 0;
  for (const value of values) stats[value in stats ? value : 'other'] = (stats[value in stats ? value : 'other'] || 0) + 1;
  return stats;
}


function normalizeLoose(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[()（）\[\]【】{}]/g, ' ')
    .replace(/[\s\-_/、,，.．·]+/g, '')
    .replace(/股份有限公司|有限公司|控股|集團|集团|行業|行业/g, '')
    .trim();
}

function toStatusBucket(item) {
  const status = item.status || 'unknown';
  if (status === 'request_failed') return 'error';
  if (['success', 'insufficient_data', 'not_applicable', 'n/a', 'unknown', 'error'].includes(status)) return status;
  if (item.apiError) return 'error';
  if (item.success === false) return 'error';
  return status;
}

function getMissingFieldKey(item) {
  const missing = [];
  if (!Number.isFinite(item.offerPriceMid)) missing.push('missingOfferPrice');
  if (!Number.isFinite(item.totalShares)) missing.push('missingTotalShares');
  if (!Number.isFinite(item.netProfitHKD)) missing.push('missingNetProfit');
  if (!Number.isFinite(item.peerMedianPE)) missing.push('missingPeerMedianPE');

  if (missing.length > 1) return 'multipleMissing';
  return missing[0] || 'none';
}

function buildMissingFieldBreakdown(cases) {
  const breakdown = {
    missingOfferPrice: 0,
    missingTotalShares: 0,
    missingNetProfit: 0,
    missingPeerMedianPE: 0,
    multipleMissing: 0,
    none: 0,
  };

  for (const item of cases) {
    if (toStatusBucket(item) !== 'insufficient_data') continue;
    const key = getMissingFieldKey(item);
    breakdown[key] = (breakdown[key] || 0) + 1;
  }

  return breakdown;
}

function classifyFailureMode(item) {
  const status = toStatusBucket(item);
  if (status === 'n/a' || status === 'not_applicable') return 'excluded_not_applicable';
  if (status === 'error') return 'request_error';
  if (status === 'success') return 'success';
  if (status === 'insufficient_data') {
    const missKey = getMissingFieldKey(item);
    if (missKey === 'missingPeerMedianPE') return 'peer_mapping_or_peer_pe_missing';
    return 'input_data_missing';
  }
  if (status === 'unknown') {
    if (!Number.isFinite(item.peerMedianPE)) return 'peer_mapping_or_peer_pe_missing';
    return 'manual_review_required';
  }
  return 'other';
}

function summarizeCases(cases) {
  const total = cases.length || 1;
  const withPE = cases.filter(item => Number.isFinite(item.finalPE));
  const mappingLevels = {};
  const peerStatuses = {};
  const scoreDist = {};
  const confidenceDist = {};
  const rejectSummaryTotals = {};
  const statusDist = {
    success: 0,
    insufficient_data: 0,
    not_applicable: 0,
    'n/a': 0,
    unknown: 0,
    error: 0,
  };
  const failureModeBreakdown = {};

  for (const item of cases) {
    const matchLevel = item.industryMappingMatchLevel || 'unknown';
    mappingLevels[matchLevel] = (mappingLevels[matchLevel] || 0) + 1;

    const peerStatus = item.peerPEStatus?.status || 'unknown';
    peerStatuses[peerStatus] = (peerStatuses[peerStatus] || 0) + 1;

    const scoreKey = String(item.scorePE);
    scoreDist[scoreKey] = (scoreDist[scoreKey] || 0) + 1;

    const confidenceKey = confidenceBucket(item.confidence);
    confidenceDist[confidenceKey] = (confidenceDist[confidenceKey] || 0) + 1;

    const statusKey = toStatusBucket(item);
    statusDist[statusKey] = (statusDist[statusKey] || 0) + 1;

    const failureMode = classifyFailureMode(item);
    failureModeBreakdown[failureMode] = (failureModeBreakdown[failureMode] || 0) + 1;

    for (const [key, value] of Object.entries(item.rejectSummary || {})) {
      rejectSummaryTotals[key] = (rejectSummaryTotals[key] || 0) + value;
    }
  }

  const applicableCases = cases.filter(item => !['not_applicable', 'n/a'].includes(toStatusBucket(item)));
  const trueFailureCases = applicableCases.filter(item => !['success'].includes(toStatusBucket(item)));
  const algorithmFailureCases = applicableCases.filter(item => ['insufficient_data', 'unknown', 'error'].includes(toStatusBucket(item)));
  const missingFieldBreakdown = buildMissingFieldBreakdown(cases);

  return {
    sampleSize: cases.length,
    netProfitExtractionFailureRate: cases.filter(item => !Number.isFinite(item.netProfitHKD)).length / total,
    mappingFailedRate: cases.filter(item => !item.natureCode).length / total,
    parseErrorRate: cases.filter(item => item.peerPEStatus?.status === 'parse_error').length / total,
    insufficientSamplesRate: cases.filter(item => item.peerPEStatus?.status === 'insufficient_samples').length / total,
    networkErrorRate: cases.filter(item => item.peerPEStatus?.status === 'network_error').length / total,
    unknownOrZeroRate: cases.filter(item => item.status === 'unknown' || item.scorePE === 0).length / total,
    peAbove200Count: withPE.filter(item => item.finalPE > 200).length,
    peBelow1Count: withPE.filter(item => item.finalPE < 1).length,
    confidenceDistribution: confidenceDist,
    scoreDistribution: scoreDist,
    peerStatusDistribution: peerStatuses,
    industryMappingDistribution: mappingLevels,
    rejectSummaryTotals,
    statusDistribution: statusDist,
    missingFieldBreakdown,
    applicableCaseCount: applicableCases.length,
    excludedCaseCount: cases.length - applicableCases.length,
    trueFailureCount: trueFailureCases.length,
    trueFailureRate: applicableCases.length ? trueFailureCases.length / applicableCases.length : 0,
    algorithmFailureCount: algorithmFailureCases.length,
    algorithmFailureRate: applicableCases.length ? algorithmFailureCases.length / applicableCases.length : 0,
    failureModeBreakdown,
  };
}

function pickAnomalies(cases) {
  return cases.filter(item => {
    const weakEvidenceHighConfidence =
      item.confidence === 'high'
      && (!item.peerPEStatus || item.peerPEStatus.status !== 'success' || !Number.isFinite(item.finalPE));
    const strongEvidenceLowConfidence =
      item.confidence === 'low'
      && item.peerPEStatus?.status === 'success'
      && item.profitWinnerDiagnostics?.semanticPurityScore >= 145
      && Number.isFinite(item.finalPE);
    return (Number.isFinite(item.finalPE) && (item.finalPE > 200 || item.finalPE < 1))
      || weakEvidenceHighConfidence
      || strongEvidenceLowConfidence;
  }).slice(0, 12);
}

function analyzeIndustryMappingFailure(item) {
  const industryMapping = item.peerPEStatus?.details?.industryMapping || {};
  const industry = item.industry || industryMapping.originalIndustry || null;
  const normalizedIndustry = industryMapping.normalizedIndustry || null;
  const topSimilarCandidates = (industryMapping.topSimilarCandidates || []).map(candidate => ({
    rawIndustry: candidate.rawIndustry || null,
    normalizedIndustry: candidate.normalizedIndustry || null,
    natureCode: candidate.natureCode || null,
    score: Number.isFinite(candidate.score) ? candidate.score : null,
  }));
  const triedMatchLevels = industryMapping.triedMatchLevels || [];

  const looseIndustry = normalizeLoose(industry);
  const looseNormalized = normalizeLoose(normalizedIndustry);
  const top = topSimilarCandidates[0] || null;
  const looseTopRaw = normalizeLoose(top?.rawIndustry);
  const looseTopNormalized = normalizeLoose(top?.normalizedIndustry);

  const normalizeSignals = [looseNormalized, looseTopRaw, looseTopNormalized].filter(Boolean);
  const canFixByNormalize = !!(
    normalizedIndustry
    && industry
    && normalizeLoose(industry) !== normalizeLoose(normalizedIndustry)
    && normalizeSignals.some(sig => sig && (sig === looseIndustry || sig === looseNormalized))
  );

  const canFixByAlias = !!(
    top
    && !canFixByNormalize
    && ((looseIndustry && (looseTopRaw.includes(looseIndustry) || looseIndustry.includes(looseTopRaw)))
      || (looseNormalized && (looseTopNormalized.includes(looseNormalized) || looseNormalized.includes(looseTopNormalized))))
  );

  const shouldRemainFailed = !canFixByAlias && !canFixByNormalize;
  let recommendation = '保留失败，优先人工确认行业字段或补充其他映射依据';
  if (canFixByNormalize) {
    recommendation = '优先补 normalize 规则，处理括号/空格/后缀等标准化问题';
  } else if (canFixByAlias) {
    recommendation = '优先补 alias，同义行业名与现有标准行业已较接近';
  }

  return {
    stockCode: item.stockCode,
    industry,
    normalizedIndustry,
    topSimilarCandidates,
    triedMatchLevels,
    canFixByAlias,
    canFixByNormalize,
    shouldRemainFailed,
    recommendation,
  };
}

async function main() {
  const serverUrl = process.argv[2] || 'http://127.0.0.1:3010';
  const codes = collectCodes();

  if (codes.length < 20) {
    throw new Error(`样本不足，仅发现 ${codes.length} 个 case`);
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const cases = [];
  for (const [idx, code] of codes.entries()) {
    const url = `${serverUrl.replace(/\/$/, '')}/api/score/${code}`;
    process.stdout.write(`[${idx + 1}/${codes.length}] ${code} ... `);
    try {
      const payload = await requestJson(url);
      const pe = payload?.scores?.pe || {};
      const evidence = pe.evidence || {};
      const peerPEStatus = evidence.peerPEStatus || {};
      const matchLevel = peerPEStatus?.details?.industryMapping?.matchLevel || null;
      const finalPE = Number.isFinite(evidence.computedPE) ? evidence.computedPE : null;
      const item = {
        stockCode: code,
        success: !!payload.success,
        apiError: payload.error || null,
        industry: peerPEStatus.industry || evidence.peerPEIndustry || evidence.etnetFieldsRaw?.industry || null,
        natureCode: peerPEStatus.natureCode || evidence.peerPENatureCode || null,
        offerPriceMid: Number.isFinite(evidence.offerPriceMid) ? evidence.offerPriceMid : null,
        totalShares: Number.isFinite(evidence.totalShares) ? evidence.totalShares : null,
        netProfitHKD: Number.isFinite(evidence.netProfitHKD) ? evidence.netProfitHKD : null,
        peerMedianPE: Number.isFinite(evidence.peerMedianPE) ? evidence.peerMedianPE : null,
        finalPE,
        scorePE: typeof pe.score === 'number' ? pe.score : null,
        confidence: pe.confidence || 'none',
        confidenceScore: Number.isFinite(evidence.confidenceScore) ? evidence.confidenceScore : null,
        status: pe.status || (payload.success ? 'n/a' : null),
        peerPEStatus,
        rejectSummary: evidence.rejectSummary || {},
        winnerRunnerUp: evidence.winnerRunnerUp || null,
        profitWinnerDiagnostics: evidence.profitWinnerDiagnostics || null,
        industryMappingMatchLevel: matchLevel,
      };
      cases.push(item);
      process.stdout.write(`ok (${item.status || 'n/a'})\n`);
    } catch (err) {
      cases.push({
        stockCode: code,
        success: false,
        apiError: err.message,
        industry: null,
        natureCode: null,
        offerPriceMid: null,
        totalShares: null,
        netProfitHKD: null,
        peerMedianPE: null,
        finalPE: null,
        scorePE: null,
        confidence: 'none',
        confidenceScore: null,
        status: 'request_failed',
        peerPEStatus: { status: 'request_failed', reason: err.message },
        rejectSummary: {},
        winnerRunnerUp: null,
        profitWinnerDiagnostics: null,
        industryMappingMatchLevel: null,
      });
      process.stdout.write(`failed (${err.message})\n`);
    }
  }

  const summary = summarizeCases(cases);
  const anomalies = pickAnomalies(cases);
  const industryMappingFailedCases = cases
    .filter(item => item.peerPEStatus?.status === 'industry_mapping_failed')
    .map(analyzeIndustryMappingFailure);
  const report = {
    generatedAt: new Date().toISOString(),
    sampleCodes: codes,
    summary,
    anomalies,
    industryMappingFailedCases,
    cases,
  };

  const outputPath = path.join(OUTPUT_DIR, 'pe-regression-report.json');
  const mappingOutputPath = path.join(OUTPUT_DIR, 'pe-industry-mapping-failed.json');
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(mappingOutputPath, JSON.stringify({
    generatedAt: report.generatedAt,
    sampleSize: cases.length,
    count: industryMappingFailedCases.length,
    cases: industryMappingFailedCases,
  }, null, 2), 'utf8');
  console.log(`\n[done] report => ${outputPath}`);
  console.log(`[done] industry mapping failures => ${mappingOutputPath}`);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch(err => {
  console.error(err.stack || err.message);
  process.exit(1);
});
