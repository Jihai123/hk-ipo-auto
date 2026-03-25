#!/usr/bin/env node
/*
 * 全量系统检查（增强版）
 * 目标：以“真实可用性”为标准，而不是“接口200”
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
const TIMEOUT = Number(argMap.timeout || 30000);
const REPORT_DIR = path.join(process.cwd(), 'artifacts');
const RUN_ID = Date.now();
const RUN_DIR = path.join(REPORT_DIR, `full-system-check-${RUN_ID}`);
const JSON_REPORT_PATH = path.join(RUN_DIR, 'report.json');
const MD_REPORT_PATH = path.join(RUN_DIR, 'report.md');

const CRITICAL_ERROR_PATTERNS = [
  '评分失败：接口不存在',
  '接口不存在',
  '加载失败',
  '获取失败',
  '请求异常',
  'undefined',
  'null',
  'NaN',
];
const PLACEHOLDER_PATTERNS = ['暂无数据', 'skeleton', '加载中', 'loading'];

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

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function addIssue(report, issue) {
  report.issues.push({
    id: `ISSUE-${String(report.issues.length + 1).padStart(3, '0')}`,
    ...issue,
  });
}

function summarizeSeverity(issues) {
  const stat = { critical: 0, major: 0, minor: 0 };
  for (const i of issues) stat[i.level] += 1;
  return stat;
}

function extractApiPathsFromFrontend(html) {
  const paths = new Set();
  const fetchMatches = html.matchAll(/fetch\((['"`])([^'"`]+)\1/g);
  for (const m of fetchMatches) {
    const raw = m[2];
    if (raw.startsWith('/api/')) paths.add(raw.split('?')[0]);
  }
  return [...paths];
}

function extractApiPathsFromServer(serverCode) {
  const paths = new Set();
  const routeRegex = /app\.(?:get|post|put|delete|patch)\((['"`])([^'"`]+)\1/g;
  for (const m of serverCode.matchAll(routeRegex)) {
    if (m[2].startsWith('/api/')) paths.add(m[2]);
  }
  return [...paths];
}

function pathMatchesRoute(apiPath, routePath) {
  const rx = new RegExp(`^${routePath.replace(/:[^/]+/g, '[^/]+')}$`);
  return rx.test(apiPath);
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

function startServerIfNeeded() {
  if (!AUTO_START) return;
  serverProc = spawn('node', ['server.js'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logPath = path.join(RUN_DIR, 'server.log');
  const ws = fs.createWriteStream(logPath, { flags: 'a' });
  serverProc.stdout.pipe(ws);
  serverProc.stderr.pipe(ws);
}

function stopServerIfStarted() {
  if (serverProc) {
    try { process.kill(serverProc.pid, 'SIGTERM'); } catch (_) { /* ignore */ }
  }
}

function determineFinalStatus(report) {
  const sev = summarizeSeverity(report.issues);
  if (sev.critical > 0) return 'FAIL';
  if (sev.major > 0) return 'WARN';
  return 'PASS';
}

function buildEvidenceSnippet(obj) {
  try {
    return JSON.stringify(obj, null, 2).slice(0, 600);
  } catch (_) {
    return String(obj);
  }
}

async function runBrowserDiagnostics(report) {
  let browserType = null;
  let launcher = null;

  try {
    // puppeteer-core 对 Node 16 兼容更好，优先使用
    // eslint-disable-next-line global-require
    launcher = require('puppeteer-core');
    browserType = 'puppeteer-core';
  } catch (_) {
    try {
      // eslint-disable-next-line global-require
      launcher = require('puppeteer');
      browserType = 'puppeteer';
    } catch (err) {
      addIssue(report, {
        level: 'critical',
        location: 'scripts/full-system-check.js',
        module: '前端真实渲染层',
        phenomenon: '未安装可用浏览器自动化依赖（puppeteer/puppeteer-core），无法执行真实浏览器诊断。',
        suspected_root_cause: '依赖缺失，工具退化为静态检查。',
        evidence: err.message,
        suggestion: '执行 npm i -D puppeteer-core，并通过 CHROME_PATH 指定本地 Chromium 路径。',
      });
      return;
    }
  }

  const artifacts = {
    screenshot_before: path.join(RUN_DIR, 'home-before-score.png'),
    screenshot_after: path.join(RUN_DIR, 'home-after-score.png'),
    dom_before: path.join(RUN_DIR, 'dom-before-score.html'),
    dom_after: path.join(RUN_DIR, 'dom-after-score.html'),
    network: path.join(RUN_DIR, 'network-log.json'),
    console: path.join(RUN_DIR, 'console-log.json'),
  };
  report.artifacts.browser = artifacts;

  let browser;
  try {
    const launchOptions = {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    };
    if (process.env.CHROME_PATH) launchOptions.executablePath = process.env.CHROME_PATH;
    browser = await launcher.launch(launchOptions);
  } catch (err) {
    addIssue(report, {
      level: 'critical',
      location: `${browserType}.launch`,
      module: '前端真实渲染层',
      phenomenon: '浏览器启动失败，无法执行真实页面可用性检查。',
      suspected_root_cause: '浏览器二进制未安装、路径未配置（CHROME_PATH）或环境限制。',
      evidence: err.message,
      suggestion: '安装 Chromium 并设置 CHROME_PATH，或在 CI 镜像预装浏览器。',
    });
    return;
  }

  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1200 });

  const consoleLogs = [];
  const requestLogs = [];
  const failedRequests = [];
  const pageErrors = [];

  page.on('console', (msg) => {
    consoleLogs.push({ type: msg.type(), text: msg.text() });
  });
  page.on('pageerror', (err) => {
    pageErrors.push({ message: err.message, stack: err.stack });
  });
  page.on('request', (req) => {
    requestLogs.push({ url: req.url(), method: req.method(), type: req.resourceType() });
  });
  page.on('response', (res) => {
    const url = res.url();
    if (url.includes('/api/')) {
      requestLogs.push({ url, status: res.status(), ok: res.ok(), from: 'response' });
    }
    if (res.status() >= 400) {
      failedRequests.push({ url, status: res.status(), statusText: res.statusText() });
    }
  });
  page.on('requestfailed', (req) => {
    failedRequests.push({ url: req.url(), error: req.failure()?.errorText || 'requestfailed' });
  });

  await page.goto(`${BASE_URL}/hk/`, { waitUntil: 'networkidle0', timeout: TIMEOUT });
  await page.waitForTimeout(1800);

  await page.screenshot({ path: artifacts.screenshot_before, fullPage: true });
  fs.writeFileSync(artifacts.dom_before, await page.content(), 'utf-8');

  const moduleSummary = await page.evaluate(() => {
    const get = (sel) => document.querySelector(sel);
    const txt = (sel) => (get(sel)?.innerText || '').trim();
    const html = (sel) => (get(sel)?.innerHTML || '');
    const detailsText = (document.querySelector('details')?.innerText || '').trim();
    const scoreText = txt('#scoreResult');

    return {
      title: document.title,
      top3Text: txt('#top3'),
      top3HTML: html('#top3'),
      leaderboardText: txt('#leaderboard'),
      leaderboardHTML: html('#leaderboard'),
      timelineText: txt('#timeline'),
      marketText: txt('#market'),
      validationText: txt('#validation'),
      scoreText,
      ruleText: detailsText,
      top3RowCount: document.querySelectorAll('#top3 .row').length,
      leaderboardRowCount: document.querySelectorAll('#leaderboard .row').length,
      hasSkeleton: document.querySelectorAll('.skeleton').length > 0,
    };
  });

  const rawText = [
    moduleSummary.top3Text,
    moduleSummary.leaderboardText,
    moduleSummary.timelineText,
    moduleSummary.marketText,
    moduleSummary.validationText,
    moduleSummary.scoreText,
  ].join('\n');

  report.modules.frontend_render.module_content = {
    top3_rows: moduleSummary.top3RowCount,
    leaderboard_rows: moduleSummary.leaderboardRowCount,
    timeline_text_length: moduleSummary.timelineText.length,
    market_text_length: moduleSummary.marketText.length,
    validation_text_length: moduleSummary.validationText.length,
    rule_text_length: moduleSummary.ruleText.length,
    has_skeleton_after_load: moduleSummary.hasSkeleton,
  };

  if (moduleSummary.hasSkeleton) {
    addIssue(report, {
      level: 'major',
      location: '页面 /hk/',
      module: '前端真实渲染层',
      phenomenon: '页面加载完成后仍存在 skeleton 状态。',
      suspected_root_cause: '异步渲染未收敛，或请求失败后未回填真实内容。',
      evidence: 'skeleton elements remain in DOM',
      suggestion: '为各模块补充 finally 状态收敛逻辑，确保成功/失败都移除 skeleton。',
    });
  }

  for (const p of CRITICAL_ERROR_PATTERNS) {
    if (rawText.includes(p)) {
      addIssue(report, {
        level: 'critical',
        location: '页面 /hk/ 文案',
        module: '页面可用性判定',
        phenomenon: `页面出现严重错误文案：${p}`,
        suspected_root_cause: '前端请求路径/解析逻辑与后端不匹配，或请求失败未被正确处理。',
        evidence: `matchedText=${p}`,
        suggestion: '核对 fetch 路径、后端路由、返回字段；失败时展示可恢复引导而非致命错误。',
      });
    }
  }

  const shellOnlyModules = [
    ['#timeline', moduleSummary.timelineText],
    ['#market', moduleSummary.marketText],
    ['#validation', moduleSummary.validationText],
  ].filter(([, txt]) => !txt || PLACEHOLDER_PATTERNS.some((kw) => txt.includes(kw)));

  for (const [selector, txt] of shellOnlyModules) {
    addIssue(report, {
      level: 'major',
      location: `页面模块 ${selector}`,
      module: '数据完整度',
      phenomenon: '模块缺少真实业务内容，呈现为空壳或占位。',
      suspected_root_cause: 'dashboard 返回字段空，或前端渲染字段映射错误。',
      evidence: `text=${txt || '<empty>'}`,
      suggestion: '检查 dashboard.timeline / market_temperature / validation_summary 的数据源与映射。',
    });
  }

  if (moduleSummary.top3RowCount === 0 || moduleSummary.top3Text.includes('暂无数据')) {
    addIssue(report, {
      level: 'critical',
      location: '页面模块 #top3',
      module: '数据完整度',
      phenomenon: '真实高分新股 TOP3 未渲染有效数据。',
      suspected_root_cause: 'dashboard/top fallback 数据为空，或 row 渲染数据字段缺失。',
      evidence: `top3Rows=${moduleSummary.top3RowCount}, text=${moduleSummary.top3Text.slice(0, 120)}`,
      suggestion: '验证 /api/dashboard 与 /api/ipo/top 返回内容，并在前端区分“真无数据”与“渲染失败”。',
    });
  }

  if (moduleSummary.leaderboardRowCount === 0 || moduleSummary.leaderboardText.includes('暂无数据')) {
    addIssue(report, {
      level: 'critical',
      location: '页面模块 #leaderboard',
      module: '数据完整度',
      phenomenon: '当前新股评分榜未渲染有效数据。',
      suspected_root_cause: 'dashboard 与 fallback 同时失效，或字段解析失败。',
      evidence: `leaderboardRows=${moduleSummary.leaderboardRowCount}, text=${moduleSummary.leaderboardText.slice(0, 120)}`,
      suggestion: '补充列表数据断言并在 loadDashboardFallback 失败时展示明确原因。',
    });
  }

  await page.type('#codeInput', SCORE_CODE, { delay: 20 });
  await page.click('#scoreForm button[type="submit"]');
  await page.waitForTimeout(2500);

  const scoreResult = await page.evaluate(() => {
    const txt = (document.querySelector('#scoreResult')?.innerText || '').trim();
    let parsed = null;
    try { parsed = JSON.parse(txt); } catch (_) { /* ignore */ }
    return { text: txt, parsed };
  });

  await page.screenshot({ path: artifacts.screenshot_after, fullPage: true });
  fs.writeFileSync(artifacts.dom_after, await page.content(), 'utf-8');

  report.modules.scoring_e2e = {
    input_code: SCORE_CODE,
    raw_text: scoreResult.text,
    parsed: scoreResult.parsed,
  };

  const scoreFailed = !scoreResult.text || scoreResult.text.includes('评分失败');
  if (scoreFailed) {
    addIssue(report, {
      level: 'critical',
      location: '#scoreForm -> #scoreResult',
      module: '核心评分链路',
      phenomenon: `立即评分失败: ${scoreResult.text || '空结果'}`,
      suspected_root_cause: '前端接口路径错误、后端接口不可用、或返回解析失败。',
      evidence: scoreResult.text || '<empty>',
      suggestion: '抓取点击后网络请求并对齐 /api/score/:code 返回 schema（success/totalScore/rating 等）。',
    });
  } else {
    const parsed = scoreResult.parsed;
    const missingFields = [];
    if (!parsed || typeof parsed !== 'object') {
      missingFields.push('JSON_PARSE_FAILED');
    } else {
      if (normalizeMissing(parsed.totalScore) && normalizeMissing(parsed.total_score)) missingFields.push('totalScore');
      if (normalizeMissing(parsed.rating)) missingFields.push('rating');
      if (!parsed.ipoInfo || typeof parsed.ipoInfo !== 'object') missingFields.push('ipoInfo');
    }

    if (missingFields.length) {
      addIssue(report, {
        level: 'major',
        location: '#scoreResult',
        module: '核心评分链路',
        phenomenon: '评分结果返回但核心字段不完整。',
        suspected_root_cause: '前后端字段命名不一致（camelCase/snake_case）或前端序列化信息过少。',
        evidence: `missing=${missingFields.join(', ')}, result=${scoreResult.text.slice(0, 200)}`,
        suggestion: '统一评分返回 schema，并在前端按字段渲染总分、维度分、解释文本。',
      });
    }
  }

  fs.writeFileSync(artifacts.network, JSON.stringify({ requestLogs, failedRequests }, null, 2), 'utf-8');
  fs.writeFileSync(artifacts.console, JSON.stringify({ consoleLogs, pageErrors }, null, 2), 'utf-8');

  report.modules.frontend_render.browser_telemetry = {
    engine: browserType,
    console_error_count: consoleLogs.filter((x) => x.type === 'error').length,
    page_error_count: pageErrors.length,
    failed_request_count: failedRequests.length,
    api_4xx_5xx_count: failedRequests.filter((x) => (x.status || 0) >= 400).length,
  };

  for (const e of consoleLogs.filter((x) => ['error', 'warning'].includes(x.type))) {
    if (CRITICAL_ERROR_PATTERNS.some((p) => e.text.includes(p))) {
      addIssue(report, {
        level: 'critical',
        location: '浏览器控制台',
        module: '前端真实渲染层',
        phenomenon: '控制台出现与可用性相关的致命报错。',
        suspected_root_cause: '接口调用失败或运行时异常未处理。',
        evidence: e.text,
        suggestion: '增加错误分级日志并在 QA 阶段将该类错误直接判定失败。',
      });
    }
  }

  for (const req of failedRequests.filter((x) => String(x.url).includes('/api/'))) {
    addIssue(report, {
      level: 'major',
      location: req.url,
      module: '前后端联动层',
      phenomenon: '浏览器中 API 请求失败。',
      suspected_root_cause: '路径不匹配、后端异常或跨域/代理问题。',
      evidence: buildEvidenceSnippet(req),
      suggestion: '对失败请求建立白名单外即失败策略，并记录请求触发源。',
    });
  }

  await browser.close();
}

function buildMarkdown(report) {
  const sev = summarizeSeverity(report.issues);
  const lines = [];
  lines.push('# 全量系统可用性诊断报告');
  lines.push('');
  lines.push(`- 结论: **${report.summary.status}**`);
  lines.push(`- 开始时间: ${report.meta.started_at}`);
  lines.push(`- 结束时间: ${report.meta.finished_at}`);
  lines.push(`- 基准地址: ${report.meta.base_url}`);
  lines.push(`- 评分用例: ${report.meta.score_code}`);
  lines.push(`- 问题统计: critical=${sev.critical}, major=${sev.major}, minor=${sev.minor}`);
  lines.push('');
  lines.push('## 分模块结果');
  for (const [k, v] of Object.entries(report.module_status)) {
    lines.push(`- **${k}**: ${v}`);
  }
  lines.push('');
  lines.push('## 问题明细');
  if (!report.issues.length) {
    lines.push('- 无问题，页面可用性与数据完整性均满足标准。');
  } else {
    for (const i of report.issues) {
      lines.push(`### ${i.id} [${i.level}] ${i.module}`);
      lines.push(`- 位置: ${i.location}`);
      lines.push(`- 现象: ${i.phenomenon}`);
      lines.push(`- 推测根因: ${i.suspected_root_cause}`);
      lines.push(`- 证据: ${i.evidence}`);
      lines.push(`- 建议: ${i.suggestion}`);
      lines.push('');
    }
  }
  lines.push('## Artifacts');
  for (const [k, v] of Object.entries(report.artifacts.files)) {
    lines.push(`- ${k}: ${v}`);
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
      checker_version: 'full-check-v2-usability-first',
    },
    module_status: {
      '后端接口层': 'PENDING',
      '前端静态结构层': 'PENDING',
      '前端真实渲染层': 'PENDING',
      '前后端联动层': 'PENDING',
      '核心评分链路': 'PENDING',
      '数据完整度': 'PENDING',
      '页面可用性判定': 'PENDING',
    },
    modules: {
      backend: { apis: [] },
      frontend_static: {},
      frontend_render: {},
      integration: {},
      scoring_e2e: {},
      data_quality: {},
    },
    issues: [],
    artifacts: {
      files: {
        json_report: JSON_REPORT_PATH,
        markdown_report: MD_REPORT_PATH,
      },
    },
    summary: {
      status: 'PENDING',
      basis: [],
    },
  };

  startServerIfNeeded();

  const alive = await waitServerAlive();
  if (!alive) {
    addIssue(report, {
      level: 'critical',
      location: BASE_URL,
      module: '后端接口层',
      phenomenon: '服务不可达。',
      suspected_root_cause: '服务未启动或端口冲突。',
      evidence: `BASE_URL=${BASE_URL}`,
      suggestion: '检查 node server.js 启动日志与端口占用。',
    });
  } else {
    // 后端接口检查 + schema
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
        apiPayload[p] = body;

        const item = {
          path: p,
          status: r.status,
          ok: r.status < 400 && isJson,
          content_type: r.headers['content-type'],
          success_field: body && Object.prototype.hasOwnProperty.call(body, 'success') ? body.success : null,
          sample_keys: body && typeof body === 'object' ? Object.keys(body).slice(0, 12) : [],
          error: body?.error || null,
        };
        report.modules.backend.apis.push(item);

        if (!item.ok) {
          addIssue(report, {
            level: 'major',
            location: p,
            module: '后端接口层',
            phenomenon: `接口返回异常 status=${r.status} contentType=${item.content_type}`,
            suspected_root_cause: '接口不可用或返回格式错误。',
            evidence: buildEvidenceSnippet(item),
            suggestion: '保证 API 返回 JSON 且状态码符合预期。',
          });
        }
      } catch (error) {
        addIssue(report, {
          level: 'critical',
          location: p,
          module: '后端接口层',
          phenomenon: '接口请求失败。',
          suspected_root_cause: '网络异常或服务崩溃。',
          evidence: error.message,
          suggestion: '查看 server.log 并重试。',
        });
      }
    }

    // 静态结构 + 路径一致性
    const htmlResp = await httpGet(`${BASE_URL}/hk/`);
    const html = String(htmlResp.data || '');
    const $ = cheerio.load(html);
    const staticChecks = {
      page_title: $('title').text().trim(),
      has_score_form: $('#scoreForm').length > 0,
      has_score_result: $('#scoreResult').length > 0,
      has_top3: $('#top3').length > 0,
      has_leaderboard: $('#leaderboard').length > 0,
      has_timeline: $('#timeline').length > 0,
      has_market: $('#market').length > 0,
      has_validation: $('#validation').length > 0,
      has_rules_details: $('details').length > 0,
    };
    report.modules.frontend_static = staticChecks;

    for (const [k, ok] of Object.entries(staticChecks)) {
      if (k === 'page_title') continue;
      if (!ok) {
        addIssue(report, {
          level: 'major',
          location: '/hk/ 静态结构',
          module: '前端静态结构层',
          phenomenon: `关键元素缺失: ${k}`,
          suspected_root_cause: '页面模板不完整或构建产物不一致。',
          evidence: `${k}=false`,
          suggestion: '补齐关键容器并增加静态 smoke test。',
        });
      }
    }

    const frontendApiPaths = extractApiPathsFromFrontend(html);
    const serverCode = fs.readFileSync(path.join(process.cwd(), 'server.js'), 'utf-8');
    const serverApiRoutes = extractApiPathsFromServer(serverCode);

    const unmatchedFrontendCalls = frontendApiPaths.filter((f) => {
      if (f.includes('${')) return false;
      return !serverApiRoutes.some((s) => pathMatchesRoute(f, s));
    });

    report.modules.integration = {
      frontend_api_paths: frontendApiPaths,
      backend_api_routes_count: serverApiRoutes.length,
      unmatched_frontend_calls: unmatchedFrontendCalls,
    };

    if (unmatchedFrontendCalls.length) {
      addIssue(report, {
        level: 'critical',
        location: '前端 fetch 路径',
        module: '前后端联动层',
        phenomenon: '前端存在未匹配后端路由的 API 调用。',
        suspected_root_cause: '路径变更后未同步，导致“接口不存在”。',
        evidence: unmatchedFrontendCalls.join(', '),
        suggestion: '统一 API 常量并在 CI 中做路径一致性校验。',
      });
    }

    const dashboard = apiPayload['/api/dashboard?sort=score'] || {};
    const top3 = Array.isArray(dashboard.top3) ? dashboard.top3 : [];
    const leaderboard = Array.isArray(dashboard.leaderboard) ? dashboard.leaderboard : [];

    const validTop3 = top3.filter((x) => !normalizeMissing(x.code) && !normalizeMissing(x.name) && !normalizeMissing(x.score));
    const validBoard = leaderboard.filter((x) => !normalizeMissing(x.code) && !normalizeMissing(x.name) && !normalizeMissing(x.score));

    const hasMarketData = dashboard.market_temperature && Object.values(dashboard.market_temperature).some((v) => !normalizeMissing(v));
    const hasTimelineData = dashboard.timeline && Object.values(dashboard.timeline).some((v) => Array.isArray(v) ? v.length > 0 : !normalizeMissing(v));
    const hasValidationData = dashboard.validation_summary && Object.values(dashboard.validation_summary).some((v) => !normalizeMissing(v));

    report.modules.data_quality = {
      top3_count: top3.length,
      top3_valid_count: validTop3.length,
      leaderboard_count: leaderboard.length,
      leaderboard_valid_count: validBoard.length,
      has_market_data: !!hasMarketData,
      has_timeline_data: !!hasTimelineData,
      has_validation_data: !!hasValidationData,
    };

    if (validTop3.length === 0) {
      addIssue(report, {
        level: 'critical',
        location: '/api/dashboard top3',
        module: '数据完整度',
        phenomenon: 'TOP3 缺少真实 name/code/score 数据。',
        suspected_root_cause: '数据源为空或字段映射错误。',
        evidence: buildEvidenceSnippet(top3.slice(0, 3)),
        suggestion: '检查 dashboardService 的 normalize 与排序逻辑。',
      });
    }

    if (validBoard.length < 3) {
      addIssue(report, {
        level: 'major',
        location: '/api/dashboard leaderboard',
        module: '数据完整度',
        phenomenon: '榜单真实记录过少，可能无法支撑页面展示。',
        suspected_root_cause: '列表聚合字段缺失或过滤条件过严。',
        evidence: `validBoard=${validBoard.length}, total=${leaderboard.length}`,
        suggestion: '检查当前 IPO 列表、评分入库、排序字段有效性。',
      });
    }

    if (!hasMarketData || !hasTimelineData || !hasValidationData) {
      addIssue(report, {
        level: 'major',
        location: '/api/dashboard 聚合字段',
        module: '数据完整度',
        phenomenon: '市场温度/时间表/模型验证摘要存在空壳风险。',
        suspected_root_cause: 'dashboard 聚合数据计算失败或返回空对象。',
        evidence: buildEvidenceSnippet(report.modules.data_quality),
        suggestion: '在 dashboard API 增加字段完整性断言和默认值策略。',
      });
    }

    await runBrowserDiagnostics(report);
  }

  const severity = summarizeSeverity(report.issues);
  report.module_status['后端接口层'] = severity.critical > 0 ? 'FAIL' : 'PASS';
  report.module_status['前端静态结构层'] = report.issues.some((x) => x.module === '前端静态结构层') ? 'WARN/FAIL' : 'PASS';
  report.module_status['前端真实渲染层'] = report.issues.some((x) => x.module === '前端真实渲染层') ? 'WARN/FAIL' : 'PASS';
  report.module_status['前后端联动层'] = report.issues.some((x) => x.module === '前后端联动层') ? 'WARN/FAIL' : 'PASS';
  report.module_status['核心评分链路'] = report.issues.some((x) => x.module === '核心评分链路') ? 'WARN/FAIL' : 'PASS';
  report.module_status['数据完整度'] = report.issues.some((x) => x.module === '数据完整度') ? 'WARN/FAIL' : 'PASS';
  report.module_status['页面可用性判定'] = determineFinalStatus(report);

  report.summary.status = determineFinalStatus(report);
  report.summary.basis = [
    `critical=${severity.critical}`,
    `major=${severity.major}`,
    `minor=${severity.minor}`,
    'PASS 必须满足：无 critical 且核心评分链路可用且页面主要模块非空壳',
  ];
  report.meta.finished_at = now();

  fs.writeFileSync(JSON_REPORT_PATH, JSON.stringify(report, null, 2), 'utf-8');
  fs.writeFileSync(MD_REPORT_PATH, buildMarkdown(report), 'utf-8');

  console.log('\n================ 全量可用性诊断报告 ================');
  console.log(`状态: ${report.summary.status}`);
  console.log(`JSON: ${JSON_REPORT_PATH}`);
  console.log(`Markdown: ${MD_REPORT_PATH}`);
  console.log(`问题总数: ${report.issues.length} (critical=${severity.critical}, major=${severity.major}, minor=${severity.minor})`);
  console.log('分模块结果:');
  for (const [k, v] of Object.entries(report.module_status)) {
    console.log(`  - ${k}: ${v}`);
  }

  if (report.issues.length) {
    console.log('\n问题摘要:');
    for (const i of report.issues) {
      console.log(`  - [${i.level}] ${i.module} @ ${i.location}: ${i.phenomenon}`);
    }
  }

  stopServerIfStarted();
  process.exit(report.summary.status === 'FAIL' ? 2 : 0);
}

main().catch((error) => {
  console.error('[full-system-check] fatal:', error.stack || error.message);
  stopServerIfStarted();
  process.exit(2);
});
