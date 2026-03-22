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

function summarizeCases(cases) {
  const total = cases.length || 1;
  const withPE = cases.filter(item => Number.isFinite(item.finalPE));
  const mappingLevels = {};
  const peerStatuses = {};
  const scoreDist = {};
  const confidenceDist = {};
  const rejectSummaryTotals = {};

  for (const item of cases) {
    const matchLevel = item.industryMappingMatchLevel || 'unknown';
    mappingLevels[matchLevel] = (mappingLevels[matchLevel] || 0) + 1;

    const peerStatus = item.peerPEStatus?.status || 'unknown';
    peerStatuses[peerStatus] = (peerStatuses[peerStatus] || 0) + 1;

    const scoreKey = String(item.scorePE);
    scoreDist[scoreKey] = (scoreDist[scoreKey] || 0) + 1;

    const confidenceKey = confidenceBucket(item.confidence);
    confidenceDist[confidenceKey] = (confidenceDist[confidenceKey] || 0) + 1;

    for (const [key, value] of Object.entries(item.rejectSummary || {})) {
      rejectSummaryTotals[key] = (rejectSummaryTotals[key] || 0) + value;
    }
  }

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
        industry: peerPEStatus.industry || evidence.peerPEIndustry || null,
        natureCode: peerPEStatus.natureCode || evidence.peerPENatureCode || null,
        netProfitHKD: Number.isFinite(evidence.netProfitHKD) ? evidence.netProfitHKD : null,
        peerMedianPE: Number.isFinite(evidence.peerMedianPE) ? evidence.peerMedianPE : null,
        finalPE,
        scorePE: typeof pe.score === 'number' ? pe.score : null,
        confidence: pe.confidence || 'none',
        confidenceScore: Number.isFinite(evidence.confidenceScore) ? evidence.confidenceScore : null,
        status: pe.status || null,
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
  const report = {
    generatedAt: new Date().toISOString(),
    sampleCodes: codes,
    summary,
    anomalies,
    cases,
  };

  const outputPath = path.join(OUTPUT_DIR, 'pe-regression-report.json');
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(`\n[done] report => ${outputPath}`);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch(err => {
  console.error(err.stack || err.message);
  process.exit(1);
});
