#!/usr/bin/env node
/*
 * 全量系统检查（v3）
 * Node 作为总入口，Python Selenium 负责真实浏览器诊断。
 */

const { spawn, spawnSync } = require('child_process');
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
const TIMEOUT = Number(argMap.timeout || 30000);

const REPORT_DIR = path.join(process.cwd(), 'artifacts');
const RUN_ID = Date.now();
const RUN_DIR = path.join(REPORT_DIR, `full-system-check-${RUN_ID}`);
const JSON_REPORT_PATH = path.join(RUN_DIR, 'report.json');
const MD_REPORT_PATH = path.join(RUN_DIR, 'report.md');
const PY_BROWSER_OUT = path.join(RUN_DIR, 'browser-check.json');

let serverProc = null;

function now() {
  return new Date().toISOString();
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function httpGet(url, options = {}) {
  return axios.get(url, { timeout: TIMEOUT, validateStatus: () => true, ...options });
}

function normalizeMissing(v) {
  return v === null || v === undefined || v === '' || v === '暂无数据' || Number.isNaN(v);
}

function addIssue(report, issue) {
  report.issues.push({ id: `ISSUE-${String(report.issues.length + 1).padStart(3, '0')}`, ...issue });
}

function summarizeSeverity(issues) {
  const stat = { critical: 0, major: 0, minor: 0 };
  for (const i of issues) stat[i.level] += 1;
  return stat;
}

function startServerIfNeeded() {
  if (!AUTO_START) return;
  serverProc = spawn('node', ['server.js'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const ws = fs.createWriteStream(path.join(RUN_DIR, 'server.log'), { flags: 'a' });
  serverProc.stdout.pipe(ws);
  serverProc.stderr.pipe(ws);
}

function stopServerIfStarted() {
  if (serverProc) {
    try { process.kill(serverProc.pid, 'SIGTERM'); } catch (_) { /* ignore */ }
  }
}

async function waitServerAlive(maxRetries = 40) {
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

function extractApiPathsFromFrontend(html) {
  const paths = new Set();
  for (const m of html.matchAll(/fetch\((['"`])([^'"`]+)\1/g)) {
    if (m[2].startsWith('/api/')) paths.add(m[2].split('?')[0]);
  }
  return [...paths];
}

function extractApiPathsFromServer(serverCode) {
  const paths = new Set();
  for (const m of serverCode.matchAll(/app\.(?:get|post|put|delete|patch)\((['"`])([^'"`]+)\1/g)) {
    if (m[2].startsWith('/api/')) paths.add(m[2]);
  }
  return [...paths];
}

function pathMatchesRoute(apiPath, routePath) {
  const rx = new RegExp(`^${routePath.replace(/:[^/]+/g, '[^/]+')}$`);
  return rx.test(apiPath);
}

function runPythonBrowserCheck(report) {
  const cmd = ['scripts/browser-check.py', `--url=${BASE_URL}`, `--code=${SCORE_CODE}`, `--out=${PY_BROWSER_OUT}`, `--artifacts=${RUN_DIR}`];
  const r = spawnSync('python3', cmd, { cwd: process.cwd(), encoding: 'utf-8', timeout: TIMEOUT * 4 });

  report.modules.browser_env.command = `python3 ${cmd.join(' ')}`;
  report.modules.browser_env.exit_code = r.status;
  report.modules.browser_env.stdout = (r.stdout || '').slice(0, 2000);
  report.modules.browser_env.stderr = (r.stderr || '').slice(0, 2000);

  if (r.error) {
    addIssue(report, {
      level: 'critical',
      module: '浏览器诊断环境',
      location: 'python3 scripts/browser-check.py',
      phenomenon: '无法执行 Python 浏览器诊断脚本。',
      suspected_root_cause: 'python3 运行失败或超时。',
      evidence: r.error.message,
      suggestion: '确认 python3 可执行，且 scripts/browser-check.py 可读可执行。',
    });
    return null;
  }

  if (!fs.existsSync(PY_BROWSER_OUT)) {
    addIssue(report, {
      level: 'critical',
      module: '浏览器诊断环境',
      location: PY_BROWSER_OUT,
      phenomenon: '浏览器诊断结果文件未生成。',
      suspected_root_cause: 'Python 脚本异常退出或写文件失败。',
      evidence: `exit=${r.status}; stderr=${(r.stderr || '').slice(0, 300)}`,
      suggestion: '检查 browser-check.py 错误输出，确保 --out 路径可写。',
    });
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(PY_BROWSER_OUT, 'utf-8'));
  } catch (err) {
    addIssue(report, {
      level: 'critical',
      module: '浏览器诊断环境',
      location: PY_BROWSER_OUT,
      phenomenon: '浏览器诊断结果 JSON 解析失败。',
      suspected_root_cause: 'Python 输出不是合法 JSON。',
      evidence: err.message,
      suggestion: '校验 browser-check.py 输出结构。',
    });
    return null;
  }
}

function moduleStatusFromIssues(moduleName, issues) {
  const relevant = issues.filter((x) => x.module === moduleName);
  if (!relevant.length) return 'PASS';
  if (relevant.some((x) => x.level === 'critical')) return 'FAIL';
  return 'WARN';
}

function determineOverall(report, browserExecuted) {
  const sev = summarizeSeverity(report.issues);
  if (!browserExecuted) return 'FAIL';
  if (sev.critical > 0) return 'FAIL';
  if (sev.major > 0) return 'WARN';
  return 'PASS';
}

function buildMarkdown(report) {
  const sev = summarizeSeverity(report.issues);
  const lines = [
    '# 全量系统可用性诊断报告',
    '',
    `- 结论: **${report.summary.status}**`,
    `- 基准地址: ${report.meta.base_url}`,
    `- 时间: ${report.meta.started_at} ~ ${report.meta.finished_at}`,
    `- 问题统计: critical=${sev.critical}, major=${sev.major}, minor=${sev.minor}`,
    '',
    '## 分模块结果',
  ];

  for (const [k, v] of Object.entries(report.module_status)) lines.push(`- **${k}**: ${v}`);

  lines.push('', '## 问题明细');
  if (!report.issues.length) {
    lines.push('- 无问题。');
  } else {
    for (const i of report.issues) {
      lines.push(`### ${i.id} [${i.level}] ${i.module}`);
      lines.push(`- 位置: ${i.location}`);
      lines.push(`- 现象: ${i.phenomenon}`);
      lines.push(`- 推测根因: ${i.suspected_root_cause}`);
      lines.push(`- 证据: ${i.evidence}`);
      lines.push(`- 建议修复方向: ${i.suggestion}`);
      lines.push('');
    }
  }

  lines.push('## Artifacts');
  for (const [k, v] of Object.entries(report.artifacts.files)) lines.push(`- ${k}: ${v}`);
  if (report.artifacts.browser) {
    for (const [k, v] of Object.entries(report.artifacts.browser)) lines.push(`- ${k}: ${v}`);
  }

  return `${lines.join('\n')}\n`;
}

async function main() {
  ensureDir(RUN_DIR);

  const report = {
    meta: {
      started_at: now(),
      finished_at: null,
      base_url: BASE_URL,
      port: PORT,
      score_code: SCORE_CODE,
      auto_start: AUTO_START,
      timeout_ms: TIMEOUT,
      checker_version: 'full-check-v3-node+selenium',
    },
    module_status: {
      '后端接口层': 'PENDING',
      '前端静态结构层': 'PENDING',
      '前端真实渲染层': 'PENDING',
      '前后端联动层': 'PENDING',
      '核心评分链路': 'PENDING',
      '数据完整度': 'PENDING',
      '浏览器诊断环境': 'PENDING',
      '页面可用性判定': 'PENDING',
    },
    modules: {
      backend: { apis: [] },
      frontend_static: {},
      integration: {},
      data_quality: {},
      browser_env: {},
      browser_check: null,
    },
    issues: [],
    artifacts: {
      files: {
        json_report: JSON_REPORT_PATH,
        markdown_report: MD_REPORT_PATH,
        browser_json: PY_BROWSER_OUT,
      },
      browser: null,
    },
    summary: { status: 'PENDING', basis: [] },
  };

  startServerIfNeeded();
  const alive = await waitServerAlive();

  if (!alive) {
    addIssue(report, {
      level: 'critical', module: '后端接口层', location: BASE_URL,
      phenomenon: '服务不可达。', suspected_root_cause: '服务未启动或端口冲突。',
      evidence: `BASE_URL=${BASE_URL}`, suggestion: '检查 server.js 启动日志与端口占用。',
    });
  } else {
    const apiTargets = ['/api/dashboard?sort=score', `/api/score/${SCORE_CODE}`, '/api/ipo/top?limit=3', '/api/ipo/current', '/api/market/stats'];
    const apiPayload = {};
    for (const p of apiTargets) {
      try {
        const r = await httpGet(`${BASE_URL}${p}`);
        const isJson = String(r.headers['content-type'] || '').includes('application/json');
        const body = isJson ? r.data : null;
        apiPayload[p] = body;
        const ok = r.status < 400 && isJson;
        report.modules.backend.apis.push({ path: p, status: r.status, ok, success_field: body?.success ?? null, error: body?.error ?? null });
        if (!ok) {
          addIssue(report, {
            level: 'major', module: '后端接口层', location: p,
            phenomenon: '接口返回异常。', suspected_root_cause: '状态码异常或非 JSON。',
            evidence: `status=${r.status}, type=${r.headers['content-type']}`, suggestion: '校正接口返回。',
          });
        }
      } catch (err) {
        addIssue(report, {
          level: 'critical', module: '后端接口层', location: p,
          phenomenon: '接口请求失败。', suspected_root_cause: '服务异常。', evidence: err.message,
          suggestion: '检查后端日志。',
        });
      }
    }

    const htmlResp = await httpGet(`${BASE_URL}/hk/`);
    const html = String(htmlResp.data || '');
    const $ = cheerio.load(html);
    report.modules.frontend_static = {
      has_score_form: $('#scoreForm').length > 0,
      has_top3: $('#top3').length > 0,
      has_leaderboard: $('#leaderboard').length > 0,
      has_timeline: $('#timeline').length > 0,
      has_market: $('#market').length > 0,
      has_validation: $('#validation').length > 0,
    };

    for (const [k, v] of Object.entries(report.modules.frontend_static)) {
      if (!v) {
        addIssue(report, {
          level: 'major', module: '前端静态结构层', location: '/hk/',
          phenomenon: `关键容器缺失: ${k}`,
          suspected_root_cause: '模板结构缺失。', evidence: `${k}=false`, suggestion: '补齐页面结构。',
        });
      }
    }

    const frontendApiPaths = extractApiPathsFromFrontend(html);
    const serverRoutes = extractApiPathsFromServer(fs.readFileSync(path.join(process.cwd(), 'server.js'), 'utf-8'));
    const unmatched = frontendApiPaths.filter((f) => !f.includes('${') && !serverRoutes.some((s) => pathMatchesRoute(f, s)));
    report.modules.integration = { frontend_api_paths: frontendApiPaths, unmatched_frontend_calls: unmatched };
    if (unmatched.length) {
      addIssue(report, {
        level: 'critical', module: '前后端联动层', location: '前端 fetch 路径',
        phenomenon: '前端调用路径与后端不一致。', suspected_root_cause: '接口路径漂移。',
        evidence: unmatched.join(', '), suggestion: '统一 API 常量并做 CI 校验。',
      });
    }

    const dashboard = apiPayload['/api/dashboard?sort=score'] || {};
    const top3 = Array.isArray(dashboard.top3) ? dashboard.top3 : [];
    const leaderboard = Array.isArray(dashboard.leaderboard) ? dashboard.leaderboard : [];
    const top3Valid = top3.filter((x) => !normalizeMissing(x.code) && !normalizeMissing(x.name) && !normalizeMissing(x.score));
    const boardValid = leaderboard.filter((x) => !normalizeMissing(x.code) && !normalizeMissing(x.name) && !normalizeMissing(x.score));

    report.modules.data_quality = {
      top3_count: top3.length,
      top3_valid_count: top3Valid.length,
      leaderboard_count: leaderboard.length,
      leaderboard_valid_count: boardValid.length,
      has_timeline_data: !!dashboard.timeline,
      has_market_data: !!dashboard.market_temperature,
      has_validation_data: !!dashboard.validation_summary,
    };

    if (top3Valid.length === 0) {
      addIssue(report, {
        level: 'critical', module: '数据完整度', location: '/api/dashboard.top3',
        phenomenon: 'TOP3 无有效业务数据。', suspected_root_cause: '数据源为空或映射失败。',
        evidence: JSON.stringify(top3.slice(0, 2)), suggestion: '检查 dashboard 数据聚合。',
      });
    }
    if (boardValid.length === 0) {
      addIssue(report, {
        level: 'critical', module: '数据完整度', location: '/api/dashboard.leaderboard',
        phenomenon: '评分榜无有效业务数据。', suspected_root_cause: '数据源为空或映射失败。',
        evidence: JSON.stringify(leaderboard.slice(0, 2)), suggestion: '检查 dashboard 数据聚合。',
      });
    }

    const browserResult = runPythonBrowserCheck(report);
    report.modules.browser_check = browserResult;

    if (browserResult && browserResult.artifacts) {
      report.artifacts.browser = browserResult.artifacts;
    }

    if (browserResult && Array.isArray(browserResult.issues)) {
      for (const issue of browserResult.issues) addIssue(report, issue);
    }
  }

  const browserExecuted = !!(report.modules.browser_check && report.modules.browser_check.executed);

  report.module_status['后端接口层'] = moduleStatusFromIssues('后端接口层', report.issues);
  report.module_status['前端静态结构层'] = moduleStatusFromIssues('前端静态结构层', report.issues);
  report.module_status['前后端联动层'] = moduleStatusFromIssues('前后端联动层', report.issues);
  report.module_status['核心评分链路'] = moduleStatusFromIssues('核心评分链路', report.issues);
  report.module_status['数据完整度'] = moduleStatusFromIssues('数据完整度', report.issues);
  report.module_status['浏览器诊断环境'] = moduleStatusFromIssues('浏览器诊断环境', report.issues);

  const frontRenderIssues = report.issues.filter((x) => ['前端真实渲染层', '浏览器诊断环境'].includes(x.module));
  if (!frontRenderIssues.length) report.module_status['前端真实渲染层'] = 'PASS';
  else if (frontRenderIssues.some((x) => x.level === 'critical')) report.module_status['前端真实渲染层'] = 'FAIL';
  else report.module_status['前端真实渲染层'] = 'WARN';

  report.summary.status = determineOverall(report, browserExecuted);
  report.module_status['页面可用性判定'] = report.summary.status;

  const sev = summarizeSeverity(report.issues);
  report.summary.basis = [
    `critical=${sev.critical}`,
    `major=${sev.major}`,
    `minor=${sev.minor}`,
    `browser_executed=${browserExecuted}`,
    '真实浏览器未执行时，不允许 PASS。',
  ];

  report.meta.finished_at = now();
  fs.writeFileSync(JSON_REPORT_PATH, JSON.stringify(report, null, 2), 'utf-8');
  fs.writeFileSync(MD_REPORT_PATH, buildMarkdown(report), 'utf-8');

  console.log('\n================ 全量可用性诊断报告 ================');
  console.log(`状态: ${report.summary.status}`);
  console.log(`JSON: ${JSON_REPORT_PATH}`);
  console.log(`Markdown: ${MD_REPORT_PATH}`);
  console.log(`浏览器诊断执行: ${browserExecuted}`);
  console.log('分模块结果:');
  Object.entries(report.module_status).forEach(([k, v]) => console.log(`  - ${k}: ${v}`));

  stopServerIfStarted();
  process.exit(report.summary.status === 'FAIL' ? 2 : 0);
}

main().catch((err) => {
  console.error('[full-system-check] fatal:', err.stack || err.message);
  stopServerIfStarted();
  process.exit(2);
});
