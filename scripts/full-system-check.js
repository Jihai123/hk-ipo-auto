#!/usr/bin/env node
/*
 * 全量系统检查：前端页面结构/样式/数据完整度 + 后端核心接口可用性
 * Usage:
 *   node scripts/full-system-check.js --code=03355 --port=3010
 *   BASE_URL=http://127.0.0.1:3010 node scripts/full-system-check.js
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');

const args = process.argv.slice(2);
const argMap = Object.fromEntries(args.filter((a) => a.startsWith('--') && a.includes('=')).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v];
}));

const SCORE_CODE = argMap.code || '03355';
const PORT = Number(argMap.port || process.env.PORT || 3010);
const BASE_URL = process.env.BASE_URL || `http://127.0.0.1:${PORT}`;
const AUTO_START = (argMap.auto_start || '1') !== '0';
const TIMEOUT = Number(argMap.timeout || 20000);
const REPORT_DIR = path.join(process.cwd(), 'artifacts');
const REPORT_PATH = path.join(REPORT_DIR, `full-system-check-${Date.now()}.json`);

let serverProc = null;

function now() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function httpGet(url, options = {}) {
  return axios.get(url, {
    timeout: TIMEOUT,
    validateStatus: () => true,
    ...options,
  });
}

function normalizeMissing(v) {
  return v === null || v === undefined || v === '' || v === '暂无数据' || Number.isNaN(v);
}

function checkRequiredFields(items = [], fields = []) {
  if (!Array.isArray(items) || !items.length) {
    return {
      count: 0,
      rows_with_missing: 0,
      completeness_avg: 0,
      missing_by_field: Object.fromEntries(fields.map((f) => [f, 0])),
    };
  }

  const missingByField = Object.fromEntries(fields.map((f) => [f, 0]));
  let rowsWithMissing = 0;
  let totalCompleteness = 0;

  for (const row of items) {
    let filled = 0;
    let rowMissing = false;
    for (const field of fields) {
      if (normalizeMissing(row[field])) {
        missingByField[field] += 1;
        rowMissing = true;
      } else {
        filled += 1;
      }
    }
    if (rowMissing) rowsWithMissing += 1;
    totalCompleteness += filled / fields.length;
  }

  return {
    count: items.length,
    rows_with_missing: rowsWithMissing,
    completeness_avg: Number(((totalCompleteness / items.length) * 100).toFixed(2)),
    missing_by_field: missingByField,
  };
}

async function waitServerAlive(maxRetries = 30) {
  for (let i = 0; i < maxRetries; i += 1) {
    try {
      const r = await httpGet(`${BASE_URL}/`, { timeout: 2000 });
      if (r.status < 500) return true;
    } catch (_) {
      // ignore
    }
    await sleep(1000);
  }
  return false;
}

function startServerIfNeeded() {
  if (!AUTO_START) return;
  serverProc = spawn('node', ['server.js'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logPath = '/tmp/hk-ipo-auto-full-check.log';
  const ws = fs.createWriteStream(logPath, { flags: 'a' });
  serverProc.stdout.pipe(ws);
  serverProc.stderr.pipe(ws);
}

function stopServerIfStarted() {
  if (serverProc) {
    try { process.kill(serverProc.pid, 'SIGTERM'); } catch (_) { /* ignore */ }
  }
}

function gradeReport(report) {
  const issues = [];
  const warnings = [];

  // backend hard checks
  for (const api of report.backend.apis) {
    if (!api.ok) issues.push(`API_FAIL:${api.path}`);
  }

  // frontend hard checks
  for (const c of report.frontend.structure_checks) {
    if (!c.ok) issues.push(`FRONT_STRUCTURE:${c.name}`);
  }

  for (const c of report.frontend.style_checks) {
    if (!c.ok) issues.push(`FRONT_STYLE:${c.name}`);
  }

  // data checks
  if (report.data_quality.top3.count === 0) issues.push('TOP3_EMPTY');
  if (report.data_quality.leaderboard.count === 0) issues.push('LEADERBOARD_EMPTY');
  if (report.data_quality.top3.completeness_avg < 60) warnings.push(`TOP3_LOW_COMPLETENESS:${report.data_quality.top3.completeness_avg}`);
  if (report.data_quality.leaderboard.completeness_avg < 55) warnings.push(`LEADERBOARD_LOW_COMPLETENESS:${report.data_quality.leaderboard.completeness_avg}`);
  if (report.data_quality.name_null_count > 0) issues.push(`NAME_NULL:${report.data_quality.name_null_count}`);
  if (report.data_quality.pe_exposed) issues.push('PE_EXPOSED_TO_FRONTEND');

  const status = issues.length ? 'FAIL' : (warnings.length ? 'PASS_WITH_WARNINGS' : 'PASS');
  return { status, issues, warnings };
}

async function main() {
  const report = {
    meta: {
      started_at: now(),
      base_url: BASE_URL,
      port: PORT,
      score_code: SCORE_CODE,
      auto_start: AUTO_START,
      timeout_ms: TIMEOUT,
      checker_version: 'full-check-v1',
    },
    backend: {
      apis: [],
    },
    frontend: {
      structure_checks: [],
      style_checks: [],
      notes: [],
    },
    data_quality: {},
  };

  startServerIfNeeded();

  const alive = await waitServerAlive();
  if (!alive) {
    report.summary = { status: 'FAIL', issues: ['SERVER_NOT_REACHABLE'], warnings: [] };
    finalize(report);
    return;
  }

  // 1) backend api probes
  const apiTargets = [
    `/api/dashboard?sort=score`,
    `/api/score/${SCORE_CODE}`,
    '/api/ipo/top?limit=3',
    '/api/ipo/current',
    '/api/market/stats',
  ];

  const apiPayload = {};
  for (const p of apiTargets) {
    try {
      const r = await httpGet(`${BASE_URL}${p}`);
      const isJson = String(r.headers['content-type'] || '').includes('application/json');
      const body = isJson ? r.data : null;
      const ok = r.status < 500 && isJson && body && (body.success !== false);
      report.backend.apis.push({
        path: p,
        status: r.status,
        ok,
        success_field: body ? body.success : null,
        error: body?.error || null,
      });
      apiPayload[p] = body;
    } catch (error) {
      report.backend.apis.push({ path: p, status: 0, ok: false, success_field: null, error: error.message });
    }
  }

  // 2) frontend page checks
  try {
    const page = await httpGet(`${BASE_URL}/hk/`);
    const html = String(page.data || '');
    const $ = cheerio.load(html);

    const structureChecks = [
      { name: 'title_exists', ok: $('title').text().trim().length > 0 },
      { name: 'hero_heading', ok: $('h1').first().text().includes('评分') },
      { name: 'score_form', ok: $('#scoreForm').length > 0 },
      { name: 'top3_container', ok: $('#top3').length > 0 },
      { name: 'leaderboard_container', ok: $('#leaderboard').length > 0 },
      { name: 'timeline_container', ok: $('#timeline').length > 0 },
      { name: 'market_container', ok: $('#market').length > 0 },
      { name: 'validation_container', ok: $('#validation').length > 0 },
    ];

    const styleText = $('style').map((_, el) => $(el).text()).get().join('\n');
    const styleChecks = [
      { name: 'has_card_style', ok: styleText.includes('.card') },
      { name: 'has_row_style', ok: styleText.includes('.row') },
      { name: 'has_btn_style', ok: styleText.includes('.btn') },
      { name: 'has_responsive_style', ok: styleText.includes('@media') },
      { name: 'pe_metric_hidden', ok: !/pe_score|pe_reason|pe_details|市盈率|PE：|估值PE/i.test(html) },
    ];

    report.frontend.structure_checks = structureChecks;
    report.frontend.style_checks = styleChecks;

    // script sanity
    const scriptText = $('script').map((_, el) => $(el).text()).get().join('\n');
    const expects = ['loadDashboard', 'loadDashboardFallback', 'safe(', 'pct(', '/api/dashboard'];
    report.frontend.notes.push({
      script_key_functions_present: Object.fromEntries(expects.map((k) => [k, scriptText.includes(k)])),
    });
  } catch (error) {
    report.frontend.structure_checks.push({ name: 'frontend_fetch', ok: false, error: error.message });
  }

  // 3) data quality checks
  const dashboard = apiPayload['/api/dashboard?sort=score'] || {};
  const top3 = Array.isArray(dashboard.top3) ? dashboard.top3 : [];
  const leaderboard = Array.isArray(dashboard.leaderboard) ? dashboard.leaderboard : [];

  const top3Fields = ['code', 'name', 'score', 'rating', 'status', 'lot_cost', 'listing_date'];
  const boardFields = ['code', 'name', 'score', 'rating', 'status', 'listing_date', 'offer_price', 'lot_size', 'lot_cost'];

  const top3Comp = checkRequiredFields(top3, top3Fields);
  const boardComp = checkRequiredFields(leaderboard, boardFields);

  const nameNullCount = leaderboard.filter((x) => normalizeMissing(x.name)).length;
  const peExposed = leaderboard.some((x) => ['pe', 'pe_score', 'pe_reason', 'pe_details', 'pe_explain'].some((k) => Object.prototype.hasOwnProperty.call(x, k)));

  const statusCounts = leaderboard.reduce((acc, row) => {
    const key = row.status || 'unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  report.data_quality = {
    top3: top3Comp,
    leaderboard: boardComp,
    name_null_count: nameNullCount,
    pe_exposed: peExposed,
    status_counts: statusCounts,
  };

  report.summary = gradeReport(report);
  finalize(report);
}

function finalize(report) {
  report.meta.finished_at = now();
  if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf-8');

  const { status, issues, warnings } = report.summary;
  console.log('\n================ 全量检查报告 ================');
  console.log(`状态: ${status}`);
  console.log(`报告文件: ${REPORT_PATH}`);
  console.log('后端接口:');
  report.backend.apis.forEach((x) => {
    console.log(`  - ${x.path}: status=${x.status}, ok=${x.ok}, success=${x.success_field}, error=${x.error || ''}`);
  });
  console.log(`前端结构检查通过: ${report.frontend.structure_checks.filter((x) => x.ok).length}/${report.frontend.structure_checks.length}`);
  console.log(`前端样式检查通过: ${report.frontend.style_checks.filter((x) => x.ok).length}/${report.frontend.style_checks.length}`);
  console.log(`Top3 完整度: ${report.data_quality.top3.completeness_avg}% (${report.data_quality.top3.count} 条)`);
  console.log(`榜单完整度: ${report.data_quality.leaderboard.completeness_avg}% (${report.data_quality.leaderboard.count} 条)`);
  console.log(`name 为空数量: ${report.data_quality.name_null_count}`);
  console.log(`PE 前端暴露: ${report.data_quality.pe_exposed}`);
  if (issues.length) console.log(`Issues: ${issues.join(', ')}`);
  if (warnings.length) console.log(`Warnings: ${warnings.join(', ')}`);

  stopServerIfStarted();
  process.exit(status === 'FAIL' ? 2 : 0);
}

main().catch((error) => {
  console.error('[full-system-check] fatal:', error.message);
  stopServerIfStarted();
  process.exit(2);
});
