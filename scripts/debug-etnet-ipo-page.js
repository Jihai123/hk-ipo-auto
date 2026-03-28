#!/usr/bin/env node

/**
 * ETNet IPO 页面结构调试脚本（独立，不接业务逻辑）
 * 目标页面: https://www.etnet.com.hk/www/sc/stocks/ci_ipo.php
 *
 * 输出：
 * 1) 控制台调试信息
 * 2) tmp/etnet-ipo-debug.html
 * 3) tmp/etnet-ipo-debug.json
 */

const fs = require('fs/promises');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');

const cfg = require('../crawlers/etnet/config');

const TARGET_URL = `${cfg.baseURL}${cfg.urls.ipoList}`;
const TMP_DIR = path.resolve(__dirname, '../tmp');
const HTML_OUTPUT = path.join(TMP_DIR, 'etnet-ipo-debug.html');
const JSON_OUTPUT = path.join(TMP_DIR, 'etnet-ipo-debug.json');

const TITLE_KEYWORDS = ['招股中', '即将上市', '即將上市', '新股信息', '新股資訊', '新股消息', '上市时间表', '上市時間表', '昨上市', '今日上市', '暗盘', '暗盤'];
const BROKER_KEYWORDS = ['耀才', '辉立', '輝立', '富途'];
const CARD_TITLE_KEYWORDS = ['昨上市', '今日上市', '暗盘', '暗盤'];

function cleanText(raw = '') {
  return String(raw).replace(/\s+/g, ' ').trim();
}

function shortText(raw = '', max = 160) {
  const text = cleanText(raw);
  if (!text) return '';
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

function getDomPath($, el) {
  const parts = [];
  let current = el;
  for (let i = 0; i < 6 && current && current.type === 'tag'; i += 1) {
    const node = current;
    const id = $(node).attr('id');
    const cls = ($(node).attr('class') || '').split(/\s+/).filter(Boolean).slice(0, 2).join('.');
    const tag = node.name;
    let part = tag;
    if (id) part += `#${id}`;
    if (cls) part += `.${cls}`;
    parts.unshift(part);
    current = node.parent;
  }
  return parts.join(' > ');
}

function extractTableHeaders($, tableEl) {
  const table = $(tableEl);
  const firstRow = table.find('tr').first();
  if (!firstRow.length) return [];
  return firstRow
    .find('th,td')
    .map((_, cell) => cleanText($(cell).text()))
    .get()
    .filter(Boolean);
}

function extractTableRowTexts($, tableEl, limit = 3) {
  const rows = $(tableEl).find('tr').slice(1, 1 + limit);
  return rows
    .map((_, row) => {
      const cols = $(row)
        .find('td,th')
        .map((__, cell) => cleanText($(cell).text()))
        .get()
        .filter(Boolean);
      return cols.join(' | ');
    })
    .get()
    .filter(Boolean);
}

function detectTableSignals(headers = []) {
  const merged = headers.join(' | ');
  const text = merged.replace(/\s+/g, '');
  const signals = [];

  if (/招股中|招股價|招股截止|截止認購|截止认购/.test(text)) signals.push('subscribing_like');
  if (/即將上市|即将上市|上市日期|入場費|入场费/.test(text)) signals.push('listing_soon_like');
  if (/新股消息|新股資訊|新股信息|認購倍數|认购倍数|一手中籤率|一手中签率/.test(text)) signals.push('news_like');

  return { merged, signals };
}

function parsePreviewRow(raw = '') {
  const line = cleanText(raw);
  const code = (line.match(/\b(\d{5})\b/) || [])[1] || null;

  let listingDate = null;
  const d1 = line.match(/(\d{4}[./\-年]\d{1,2}[./\-月]\d{1,2})/);
  const d2 = line.match(/(\d{1,2}[./\-]\d{1,2}[./\-]\d{4})/);
  if (d1) listingDate = d1[1];
  else if (d2) listingDate = d2[1];

  const priceRangeMatch = line.match(/(\d+(?:\.\d+)?\s*[-~至]\s*\d+(?:\.\d+)?)/);
  const singlePriceMatch = line.match(/(?:招股價|上市價|发售价|發售價|價格|价格)?\s*(\d{1,4}(?:\.\d+)?)/);

  const nameCandidate = cleanText(
    line
      .replace(/\b\d{5}\b/g, ' ')
      .replace(/\d{4}[./\-年]\d{1,2}[./\-月]\d{1,2}/g, ' ')
      .replace(/\d{1,2}[./\-]\d{1,2}[./\-]\d{4}/g, ' ')
      .replace(/[\d.,%$HKD港元人民币人民幣\-~至]+/g, ' ')
  )
    .split('|')
    .map(x => cleanText(x))
    .find(x => x && x.length >= 2) || null;

  return {
    code,
    name: nameCandidate,
    listingDate,
    offerPrice: priceRangeMatch ? null : (singlePriceMatch ? singlePriceMatch[1] : null),
    priceRange: priceRangeMatch ? cleanText(priceRangeMatch[1]) : null,
    raw: shortText(line, 220),
  };
}

function locateTitleBlocks($) {
  const matched = [];
  $('h1,h2,h3,h4,h5,strong,b,th,td,div,span,a,p').each((_, el) => {
    const text = cleanText($(el).text());
    if (!text || text.length > 50) return;
    if (!TITLE_KEYWORDS.some(k => text.includes(k))) return;

    const parentText = shortText($(el).parent().text(), 220);
    const candidateTables = [];

    let cursor = $(el);
    for (let i = 0; i < 4; i += 1) {
      const table = cursor.nextAll('table').first();
      if (table && table.length) {
        candidateTables.push({
          headers: extractTableHeaders($, table),
          rowsPreview: extractTableRowTexts($, table, 2),
        });
      }
      cursor = cursor.parent();
      if (!cursor || !cursor.length) break;
    }

    matched.push({
      keywordHits: TITLE_KEYWORDS.filter(k => text.includes(k)),
      titleText: text,
      tagName: (el.name || '').toLowerCase(),
      domPath: getDomPath($, el),
      nearbyTextSummary: parentText,
      nextTableCandidates: candidateTables.slice(0, 3),
    });
  });

  return matched;
}

function inspectAllTables($) {
  const tables = [];

  $('table').each((idx, tableEl) => {
    const headers = extractTableHeaders($, tableEl);
    const rowPreview = extractTableRowTexts($, tableEl, 3);
    const signal = detectTableSignals(headers);

    tables.push({
      tableIndex: idx,
      domPath: getDomPath($, tableEl),
      headerText: headers,
      headerMerged: signal.merged,
      classificationSignals: signal.signals,
      first3RowsText: rowPreview,
      parsePreviewTop3: rowPreview.slice(0, 3).map(parsePreviewRow),
    });
  });

  return tables;
}

function probeTopCardContainers($) {
  const candidates = [];

  $('div,section,article,li,td,tr').each((idx, el) => {
    const text = cleanText($(el).text());
    if (!text || text.length < 24 || text.length > 320) return;

    const codes = (text.match(/\b\d{5}\b/g) || []).filter((v, i, arr) => arr.indexOf(v) === i);
    const hasBroker = BROKER_KEYWORDS.some(k => text.includes(k));
    const hasCardTitleKeyword = CARD_TITLE_KEYWORDS.some(k => text.includes(k));

    if (!codes.length && !hasBroker && !hasCardTitleKeyword) return;

    const nameCandidate = cleanText(
      text
        .replace(/\b\d{5}\b/g, ' ')
        .replace(/[\d\s.,%()+\-]+/g, ' ')
    )
      .split(/\||\//)
      .map(x => cleanText(x))
      .find(x => x && x.length >= 2) || null;

    candidates.push({
      idx,
      tagName: (el.name || '').toLowerCase(),
      domPath: getDomPath($, el),
      textSummary: shortText(text, 240),
      codes,
      nameCandidate,
      hasBrokerKeyword: hasBroker,
      brokerKeywordsHit: BROKER_KEYWORDS.filter(k => text.includes(k)),
      hasTopCardTitleKeyword: hasCardTitleKeyword,
      topCardTitleKeywordHits: CARD_TITLE_KEYWORDS.filter(k => text.includes(k)),
    });
  });

  return candidates
    .sort((a, b) => {
      const scoreA = (a.hasBrokerKeyword ? 2 : 0) + (a.hasTopCardTitleKeyword ? 2 : 0) + Math.min(a.codes.length, 2);
      const scoreB = (b.hasBrokerKeyword ? 2 : 0) + (b.hasTopCardTitleKeyword ? 2 : 0) + Math.min(b.codes.length, 2);
      return scoreB - scoreA;
    })
    .slice(0, 25);
}

function printSection(title, payload) {
  console.log(`\n========== ${title} ==========`);
  console.dir(payload, { depth: 5, colors: true, maxArrayLength: 60 });
}

async function fetchPageHtml() {
  const attempts = [];
  const maxTries = Math.max(2, cfg.maxRetries || 3);

  for (let attempt = 1; attempt <= maxTries; attempt += 1) {
    try {
      const res = await axios.get(TARGET_URL, {
        headers: cfg.headers,
        timeout: cfg.timeout,
        validateStatus: () => true,
      });

      attempts.push({
        attempt,
        status: res.status,
        statusText: res.statusText,
        contentType: res.headers?.['content-type'] || null,
        contentLength: res.headers?.['content-length'] || null,
      });

      if (res.status >= 200 && res.status < 300) {
        return {
          ok: true,
          html: typeof res.data === 'string' ? res.data : String(res.data || ''),
          attempts,
        };
      }

      if (res.status === 403) {
        console.warn(`[debug-etnet] attempt ${attempt}: HTTP 403, 保留上下文后继续重试`);
      } else {
        console.warn(`[debug-etnet] attempt ${attempt}: HTTP ${res.status}`);
      }
    } catch (err) {
      attempts.push({
        attempt,
        error: err.message,
        code: err.code || null,
      });
      console.warn(`[debug-etnet] attempt ${attempt}: 请求异常 ${err.message}`);
    }

    await new Promise(r => setTimeout(r, Math.max(1000, cfg.requestDelay || 1000)));
  }

  return { ok: false, html: '', attempts };
}

async function main() {
  await fs.mkdir(TMP_DIR, { recursive: true });

  const fetched = await fetchPageHtml();
  const output = {
    targetUrl: TARGET_URL,
    fetchedAt: new Date().toISOString(),
    fetch: {
      ok: fetched.ok,
      attempts: fetched.attempts,
    },
    titleBlocks: [],
    tables: [],
    topCardContainers: [],
    notes: [],
  };

  if (fetched.ok && fetched.html) {
    await fs.writeFile(HTML_OUTPUT, fetched.html, 'utf8');
    const $ = cheerio.load(fetched.html);

    output.titleBlocks = locateTitleBlocks($);
    output.tables = inspectAllTables($);
    output.topCardContainers = probeTopCardContainers($);

    printSection('A. 页面标题区块探测', output.titleBlocks);
    printSection('B + C. 表格探测 + 解析预览', output.tables);
    printSection('D. 顶部卡片区探测', output.topCardContainers);

    output.notes.push('已抓取到 HTML，并完成标题/表格/顶部卡片容器探测。');
    output.notes.push(`重点先看 tables[].classificationSignals 与 parsePreviewTop3。`);
  } else {
    output.notes.push('未抓取到可解析 HTML，已记录请求上下文（含 HTTP 状态和错误）。');
    output.notes.push('可在可访问 ETNet 的环境重新运行脚本。');
    console.error('[debug-etnet] 抓取失败，详见 tmp/etnet-ipo-debug.json 的 fetch.attempts。');
  }

  await fs.writeFile(JSON_OUTPUT, JSON.stringify(output, null, 2), 'utf8');

  console.log(`\n[debug-etnet] JSON 输出: ${JSON_OUTPUT}`);
  if (fetched.ok) {
    console.log(`[debug-etnet] HTML 输出: ${HTML_OUTPUT}`);
  }
}

main().catch((err) => {
  console.error('[debug-etnet] fatal:', err);
  process.exitCode = 1;
});
