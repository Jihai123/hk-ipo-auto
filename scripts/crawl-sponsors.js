/**
 * 港股IPO保荐人数据爬虫 v3
 * 数据来源：AAStocks (aastocks.com)
 * 运行: node scripts/crawl-sponsors.js
 *
 * v3更新：
 * - 从sponsor.aspx页面爬取"最近两年数据"表格（支持翻页）
 * - 汇总计算每个保荐人的统计数据
 * - 同时保留十大保荐人排名数据
 */

const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');
const fs = require('fs');

// 尝试加载数据库
let Database;
try {
  Database = require('better-sqlite3');
} catch (e) {
  console.log('⚠️  better-sqlite3 未安装，将只输出到JSON文件');
}

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'ipo.db');
const JSON_PATH = path.join(DATA_DIR, 'sponsors.json');

// sponsor.aspx 页面包含两个表格：十大排名 + 最近两年数据
const SPONSOR_URL = 'http://www.aastocks.com/tc/stocks/market/ipo/sponsor.aspx';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
  'Referer': 'http://www.aastocks.com/tc/stocks/market/ipo/sponsor.aspx',
};

function parsePercent(str) {
  if (!str) return null;
  const cleaned = str.replace(/[+%,\s]/g, '').trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 爬取sponsor.aspx页面的两个表格
 * @param {number} page - 页码（用于最近两年数据表格的分页）
 */
async function crawlSponsorPage(page = 1) {
  const url = page === 1 ? SPONSOR_URL : `${SPONSOR_URL}?page=${page}`;

  try {
    const response = await axios.get(url, {
      headers: HEADERS,
      timeout: 30000,
    });

    const $ = cheerio.load(response.data);

    const topSponsors = [];     // 十大排名
    const ipoRecords = [];      // 最近两年数据
    let tableIndex = 0;

    // 遍历所有表格
    $('table').each((idx, table) => {
      const headerRow = $(table).find('tr').first();
      const headerText = headerRow.text();

      // 表格1: 十大排名（只在第一页处理）
      if (page === 1 && headerText.includes('保薦人') && headerText.includes('參與數目') && !headerText.includes('上市日期')) {
        $(table).find('tr').each((rowIndex, row) => {
          if (rowIndex === 0) return; // 跳过表头

          const cells = $(row).find('td');
          if (cells.length >= 6) {
            const sponsorName = $(cells[0]).text().trim();
            const countText = $(cells[1]).text().trim();
            const count = parseInt(countText, 10);

            if (!isNaN(count) && count > 0 && sponsorName && !sponsorName.includes('保薦人')) {
              const upCount = parseInt($(cells[2]).text().trim(), 10) || 0;
              const downCount = parseInt($(cells[3]).text().trim(), 10) || 0;
              const avgFirstDay = parsePercent($(cells[4]).text());
              const avgCumulative = parsePercent($(cells[5]).text());

              if (avgFirstDay !== null && !topSponsors.some(s => s.name === sponsorName)) {
                const winRate = Math.round((upCount / count) * 10000) / 100;
                topSponsors.push({
                  name: sponsorName,
                  count,
                  upCount,
                  downCount,
                  avgFirstDay,
                  avgCumulative,
                  winRate,
                });
              }
            }
          }
        });
      }

      // 表格2: 最近两年数据（有分页）
      // 特征：包含"上市日期"列
      if (headerText.includes('上市日期') || headerText.includes('公司名稱') || headerText.includes('首日表現')) {
        $(table).find('tr').each((rowIndex, row) => {
          if (rowIndex === 0) return; // 跳过表头

          const cells = $(row).find('td');
          // 结构: 上市日期 | 公司名稱/代號 | 保薦人 | 行業 | 暗盤表現 | 首日表現 | 累積表現
          if (cells.length >= 6) {
            const dateText = $(cells[0]).text().trim();
            const companyInfo = $(cells[1]).text().trim();
            const sponsorText = $(cells[2]).text().trim();
            const industry = $(cells[3]).text().trim();
            const firstDayPerf = parsePercent($(cells[5]).text());

            // 验证是数据行（日期格式检验）
            if (dateText.match(/\d{4}\/\d{2}\/\d{2}/) && sponsorText && firstDayPerf !== null) {
              // 提取股票代码 - 支持多种格式：01768.HK、(01768)、01768
              const codeMatch = companyInfo.match(/(\d{4,5})\.HK/i) ||
                               companyInfo.match(/\((\d{4,5})\)/) ||
                               companyInfo.match(/(\d{5})$/);
              const stockCode = codeMatch ? codeMatch[1] : '';
              const companyName = companyInfo.replace(/\d{4,5}\.HK/i, '').replace(/\(\d+\)/, '').trim();

              // 处理多个保荐人（可能用逗号、/、换行、或"有限公司"后面直接接下一个）
              // 先按常见分隔符分割
              let sponsorNames = sponsorText
                .replace(/有限公司([A-Z\u4e00-\u9fa5])/g, '有限公司,$1') // 在"有限公司"后面加逗号
                .split(/[,\/、\n\r]+/)
                .map(s => s.trim())
                .filter(s => s && s.length > 2);

              ipoRecords.push({
                date: dateText,
                stockCode,
                companyName,
                sponsors: sponsorNames,
                industry,
                firstDayPerf,
              });
            }
          }
        });
      }
    });

    // 检查是否有下一页
    const hasNextPage = $('a').filter((i, el) => $(el).text().includes('下一頁')).length > 0;

    return { topSponsors, ipoRecords, hasNextPage };

  } catch (error) {
    console.error(`   ❌ 爬取第${page}页失败:`, error.message);
    return { topSponsors: [], ipoRecords: [], hasNextPage: false };
  }
}

/**
 * 从IPO记录汇总保荐人统计
 */
function aggregateSponsorStats(ipoRecords) {
  const sponsorMap = new Map();

  for (const record of ipoRecords) {
    for (const sponsorName of record.sponsors) {
      if (!sponsorName) continue;

      if (!sponsorMap.has(sponsorName)) {
        sponsorMap.set(sponsorName, {
          name: sponsorName,
          count: 0,
          upCount: 0,
          downCount: 0,
          flatCount: 0,
          totalReturn: 0,
          records: [],
        });
      }

      const stat = sponsorMap.get(sponsorName);
      stat.count++;
      stat.totalReturn += record.firstDayPerf;
      stat.records.push({
        code: record.stockCode,
        name: record.companyName,
        perf: record.firstDayPerf,
        date: record.date,
      });

      if (record.firstDayPerf > 0) {
        stat.upCount++;
      } else if (record.firstDayPerf < 0) {
        stat.downCount++;
      } else {
        stat.flatCount++;
      }
    }
  }

  // 计算平均涨幅和胜率
  const sponsors = [];
  for (const stat of sponsorMap.values()) {
    if (stat.count >= 1) {
      sponsors.push({
        name: stat.name,
        count: stat.count,
        upCount: stat.upCount,
        downCount: stat.downCount,
        flatCount: stat.flatCount,
        avgFirstDay: Math.round((stat.totalReturn / stat.count) * 100) / 100,
        winRate: Math.round((stat.upCount / stat.count) * 10000) / 100,
        // 最佳和最差案例
        bestCase: stat.records.sort((a, b) => b.perf - a.perf)[0],
        worstCase: stat.records.sort((a, b) => a.perf - b.perf)[0],
      });
    }
  }

  return sponsors.sort((a, b) => b.count - a.count);
}

// crawlSponsorStats函数已被crawlSponsorStatsWithRecords替代

/**
 * 保存数据
 * @param {Array} sponsors - 保荐人统计数据
 * @param {Array} ipoRecords - IPO记录（包含股票代码→保荐人映射）
 */
function saveData(sponsors, ipoRecords = []) {
  console.log('\n💾 正在保存数据...');

  // 确保目录存在
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  // 1. 保存保荐人统计数据到JSON
  const jsonData = {
    updatedAt: new Date().toISOString(),
    source: 'aastocks',
    sponsors: sponsors,
  };
  fs.writeFileSync(JSON_PATH, JSON.stringify(jsonData, null, 2), 'utf-8');
  console.log(`   ✓ 已保存到 ${JSON_PATH}`);

  // 2. 保存股票代码→保荐人映射（用于PDF解析失败时的备用查找）
  if (ipoRecords.length > 0) {
    const ipoSponsorMap = {};
    for (const record of ipoRecords) {
      if (record.stockCode && record.sponsors && record.sponsors.length > 0) {
        // 标准化股票代码（补齐5位）
        const normalizedCode = record.stockCode.padStart(5, '0');
        ipoSponsorMap[normalizedCode] = {
          sponsors: record.sponsors,
          companyName: record.companyName,
          date: record.date,
          industry: record.industry,
          firstDayPerf: record.firstDayPerf,
        };
      }
    }
    const ipoMapPath = path.join(DATA_DIR, 'ipo-sponsors.json');
    fs.writeFileSync(ipoMapPath, JSON.stringify({
      updatedAt: new Date().toISOString(),
      source: 'aastocks',
      count: Object.keys(ipoSponsorMap).length,
      mapping: ipoSponsorMap,
    }, null, 2), 'utf-8');
    console.log(`   ✓ 已保存 ${Object.keys(ipoSponsorMap).length} 个股票代码→保荐人映射到 ${ipoMapPath}`);
  }

  // 2. 如果有数据库，也保存到数据库
  if (Database && fs.existsSync(DB_PATH)) {
    try {
      const db = new Database(DB_PATH);

      const insertStmt = db.prepare(`
        INSERT INTO sponsor_stats (
          sponsor_name, total_count, up_count, down_count, flat_count,
          avg_first_day_return, avg_cumulative_return, win_rate,
          data_source, last_updated
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'aastocks', datetime('now'))
        ON CONFLICT(sponsor_name) DO UPDATE SET
          total_count = excluded.total_count,
          up_count = excluded.up_count,
          down_count = excluded.down_count,
          avg_first_day_return = excluded.avg_first_day_return,
          avg_cumulative_return = excluded.avg_cumulative_return,
          win_rate = excluded.win_rate,
          last_updated = datetime('now')
      `);

      db.exec('BEGIN TRANSACTION');
      for (const s of sponsors) {
        insertStmt.run(s.name, s.count, s.upCount, s.downCount,
                       s.count - s.upCount - s.downCount,
                       s.avgFirstDay, s.avgCumulative || null, s.winRate);
      }
      db.exec('COMMIT');
      db.close();

      console.log(`   ✓ 已保存到数据库`);
    } catch (e) {
      console.error('   ⚠️  数据库保存失败:', e.message);
    }
  }
}

/**
 * 显示TOP保荐人
 */
function showTop(sponsors) {
  console.log('\n🏆 TOP 15 保荐人 (按参与数量):');

  const sorted = [...sponsors].sort((a, b) => b.count - a.count);
  sorted.slice(0, 15).forEach((s, i) => {
    const sign = s.avgFirstDay >= 0 ? '+' : '';
    console.log(`   ${(i+1).toString().padStart(2)}. ${s.name.substring(0, 25).padEnd(25)} ${s.count}单 ${sign}${s.avgFirstDay.toFixed(2)}% 胜率${s.winRate}%`);
  });

  console.log('\n🔥 TOP 10 保荐人 (按平均涨幅, ≥5单):');
  const byReturn = [...sponsors].filter(s => s.count >= 5).sort((a, b) => b.avgFirstDay - a.avgFirstDay);
  byReturn.slice(0, 10).forEach((s, i) => {
    const sign = s.avgFirstDay >= 0 ? '+' : '';
    console.log(`   ${(i+1).toString().padStart(2)}. ${s.name.substring(0, 25).padEnd(25)} ${s.count}单 ${sign}${s.avgFirstDay.toFixed(2)}% 胜率${s.winRate}%`);
  });
}

async function main() {
  console.log('═'.repeat(60));
  console.log('🚀 港股IPO保荐人数据爬虫 v3.1');
  console.log('═'.repeat(60));
  console.log('数据来源: AAStocks (aastocks.com)');
  console.log('策略: 爬取十大排名 + 最近两年IPO数据（多页）并汇总');
  console.log('新增: 保存股票代码→保荐人映射表');
  console.log('═'.repeat(60));

  const { sponsors, ipoRecords } = await crawlSponsorStatsWithRecords();

  if (sponsors.length > 0) {
    saveData(sponsors, ipoRecords);
    showTop(sponsors);
  } else {
    console.log('\n❌ 未获取到任何保荐人数据');
  }

  console.log('\n✨ 完成！');
}

/**
 * 主爬取函数（返回sponsors和ipoRecords）
 */
async function crawlSponsorStatsWithRecords() {
  console.log('\n📊 开始爬取 sponsor.aspx 页面...');
  console.log(`   URL: ${SPONSOR_URL}\n`);

  let allTopSponsors = [];
  let allIPORecords = [];
  let page = 1;
  const maxPages = 15;

  while (page <= maxPages) {
    process.stdout.write(`   第 ${page} 页...`);
    const { topSponsors, ipoRecords, hasNextPage } = await crawlSponsorPage(page);

    // 第一页获取十大排名
    if (page === 1 && topSponsors.length > 0) {
      allTopSponsors = topSponsors;
      console.log(` ✓ 获取 ${topSponsors.length} 个TOP保荐人`);
    }

    if (ipoRecords.length > 0) {
      allIPORecords.push(...ipoRecords);
      if (page > 1 || topSponsors.length === 0) {
        console.log(` ✓ ${ipoRecords.length} 条IPO记录`);
      } else {
        console.log(` + ${ipoRecords.length} 条IPO记录`);
      }
    } else if (page > 1) {
      console.log(' 无数据');
      break;
    }

    if (!hasNextPage) {
      console.log('   已到最后一页');
      break;
    }

    page++;
    await sleep(800); // 礼貌延迟
  }

  console.log(`\n   📈 共爬取 ${allIPORecords.length} 条IPO记录`);

  // 汇总保荐人数据
  const aggregatedSponsors = aggregateSponsorStats(allIPORecords);
  console.log(`   📊 从IPO记录汇总出 ${aggregatedSponsors.length} 个保荐人`);

  // 合并数据：优先使用十大排名数据（更准确），用汇总数据补充
  const sponsorMap = new Map();

  // 先添加十大排名数据
  for (const sponsor of allTopSponsors) {
    sponsorMap.set(sponsor.name, sponsor);
  }

  // 用汇总数据补充
  for (const sponsor of aggregatedSponsors) {
    if (!sponsorMap.has(sponsor.name)) {
      sponsorMap.set(sponsor.name, sponsor);
    }
  }

  const finalSponsors = Array.from(sponsorMap.values())
    .sort((a, b) => b.count - a.count);

  console.log(`\n   ✅ 合并后共 ${finalSponsors.length} 个保荐人数据`);

  return { sponsors: finalSponsors, ipoRecords: allIPORecords };
}

main().catch(console.error);
