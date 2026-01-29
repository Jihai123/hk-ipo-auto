/**
 * 港股IPO保荐人数据爬虫 v3
 * 数据来源：AAStocks (aastocks.com)
 * 运行: node scripts/crawl-sponsors.js
 *
 * v3更新：
 * - 支持翻页爬取所有IPO记录
 * - 汇总计算每个保荐人的统计数据
 * - 获取更全面的保荐人信息
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

// AAStocks IPO列表页面（支持分页）
const IPO_LIST_URL = 'https://www.aastocks.com/tc/stocks/market/ipo/ipoperf.aspx';
// 十大保荐人排名页面
const SPONSOR_RANK_URL = 'https://www.aastocks.com/tc/stocks/market/ipo/sponsor.aspx';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
  'Referer': 'https://www.aastocks.com/tc/stocks/market/ipo/sponsor.aspx',
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
 * 爬取十大保荐人排名（快速获取TOP10）
 */
async function crawlTopSponsors() {
  console.log('\n📊 正在爬取十大保荐人排名...');
  console.log(`   URL: ${SPONSOR_RANK_URL}\n`);

  try {
    const response = await axios.get(SPONSOR_RANK_URL, {
      headers: HEADERS,
      timeout: 30000,
    });

    const $ = cheerio.load(response.data);
    const sponsors = [];

    // 查找排名表格（表头包含"保薦人"）
    $('table').each((tableIndex, table) => {
      const headerRow = $(table).find('tr').first();
      const headerText = headerRow.text();

      // 识别保荐人排名表格
      if (headerText.includes('保薦人') && headerText.includes('參與數目')) {
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

              if (avgFirstDay !== null && !sponsors.some(s => s.name === sponsorName)) {
                const winRate = Math.round((upCount / count) * 10000) / 100;
                sponsors.push({
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
    });

    console.log(`   ✓ 获取 ${sponsors.length} 个TOP保荐人`);
    return sponsors;

  } catch (error) {
    console.error('   ❌ 爬取排名失败:', error.message);
    return [];
  }
}

/**
 * 爬取单页IPO记录
 */
async function crawlIPOPage(page = 1) {
  const url = `${IPO_LIST_URL}?page=${page}`;

  try {
    const response = await axios.get(url, {
      headers: HEADERS,
      timeout: 30000,
    });

    const $ = cheerio.load(response.data);
    const records = [];

    // 解析IPO记录表格
    $('table tr').each((rowIndex, row) => {
      const cells = $(row).find('td');

      // 典型结构: 上市日期 | 公司名稱/代號 | 保薦人 | 行業 | 暗盤表現 | 首日表現 | 累積表現
      if (cells.length >= 6) {
        const dateText = $(cells[0]).text().trim();
        const companyInfo = $(cells[1]).text().trim();
        const sponsorText = $(cells[2]).text().trim();
        const industry = $(cells[3]).text().trim();
        const firstDayPerf = parsePercent($(cells[5]).text());

        // 验证是数据行（日期格式检验）
        if (dateText.match(/\d{4}\/\d{2}\/\d{2}/) && sponsorText && firstDayPerf !== null) {
          // 提取股票代码
          const codeMatch = companyInfo.match(/\((\d+)\)/);
          const stockCode = codeMatch ? codeMatch[1] : '';
          const companyName = companyInfo.replace(/\(\d+\)/, '').trim();

          // 处理多个保荐人（用逗号或/分隔）
          const sponsorNames = sponsorText.split(/[,\/、]/).map(s => s.trim()).filter(s => s);

          records.push({
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

    // 检查是否有下一页
    const hasNextPage = $('a').filter((i, el) => $(el).text().includes('下一頁')).length > 0;

    return { records, hasNextPage };

  } catch (error) {
    console.error(`   ❌ 爬取第${page}页失败:`, error.message);
    return { records: [], hasNextPage: false };
  }
}

/**
 * 爬取所有IPO记录并汇总保荐人数据
 */
async function crawlAllIPORecords(maxPages = 20) {
  console.log('\n📋 正在爬取IPO记录（多页）...');

  const allRecords = [];
  let page = 1;

  while (page <= maxPages) {
    process.stdout.write(`   第 ${page} 页...`);
    const { records, hasNextPage } = await crawlIPOPage(page);

    if (records.length > 0) {
      allRecords.push(...records);
      console.log(` ✓ ${records.length} 条记录`);
    } else {
      console.log(' 无数据');
      break;
    }

    if (!hasNextPage) {
      console.log('   已到最后一页');
      break;
    }

    page++;
    await sleep(500); // 礼貌延迟
  }

  console.log(`\n   📈 共爬取 ${allRecords.length} 条IPO记录`);
  return allRecords;
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

/**
 * 主爬取函数 - 综合两种方式
 */
async function crawlSponsorStats() {
  console.log('\n📊 保荐人数据爬取策略：');
  console.log('   1. 先获取十大保荐人排名（快速）');
  console.log('   2. 再爬取IPO记录汇总（全面）\n');

  // 方式1：获取十大保荐人排名
  const topSponsors = await crawlTopSponsors();

  // 方式2：爬取IPO记录并汇总
  const ipoRecords = await crawlAllIPORecords(15); // 爬取15页
  const aggregatedSponsors = aggregateSponsorStats(ipoRecords);

  // 合并数据：优先使用汇总数据，用排名数据补充
  const sponsorMap = new Map();

  // 先添加汇总数据
  for (const sponsor of aggregatedSponsors) {
    sponsorMap.set(sponsor.name, sponsor);
  }

  // 用排名数据补充（如果汇总数据中没有）
  for (const sponsor of topSponsors) {
    if (!sponsorMap.has(sponsor.name)) {
      sponsorMap.set(sponsor.name, sponsor);
    }
  }

  const finalSponsors = Array.from(sponsorMap.values())
    .sort((a, b) => b.count - a.count);

  // 输出TOP保荐人
  console.log('\n   📈 数据汇总:');
  finalSponsors.slice(0, 15).forEach((s, i) => {
    const sign = s.avgFirstDay >= 0 ? '+' : '';
    console.log(`   ${(i+1).toString().padStart(2)}. ${s.name.substring(0, 24).padEnd(24)} ${s.count}单, ${sign}${s.avgFirstDay.toFixed(2)}%, 胜率${s.winRate}%`);
  });

  console.log(`\n   📊 共获取 ${finalSponsors.length} 个保荐人数据`);

  return finalSponsors;
}

/**
 * 保存数据
 */
function saveData(sponsors) {
  console.log('\n💾 正在保存数据...');
  
  // 确保目录存在
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  
  // 1. 保存到JSON（无论如何都保存）
  const jsonData = {
    updatedAt: new Date().toISOString(),
    source: 'aastocks',
    sponsors: sponsors,
  };
  fs.writeFileSync(JSON_PATH, JSON.stringify(jsonData, null, 2), 'utf-8');
  console.log(`   ✓ 已保存到 ${JSON_PATH}`);
  
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
                       s.avgFirstDay, s.avgCumulative, s.winRate);
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
function showTop10(sponsors) {
  console.log('\n🏆 TOP 10 保荐人 (按参与数量):');
  
  const sorted = [...sponsors].sort((a, b) => b.count - a.count);
  sorted.slice(0, 10).forEach((s, i) => {
    const sign = s.avgFirstDay >= 0 ? '+' : '';
    console.log(`   ${(i+1).toString().padStart(2)}. ${s.name.substring(0, 25).padEnd(25)} ${s.count}单 ${sign}${s.avgFirstDay.toFixed(2)}% 胜率${s.winRate}%`);
  });
  
  console.log('\n🔥 TOP 10 保荐人 (按平均涨幅):');
  const byReturn = [...sponsors].filter(s => s.count >= 5).sort((a, b) => b.avgFirstDay - a.avgFirstDay);
  byReturn.slice(0, 10).forEach((s, i) => {
    const sign = s.avgFirstDay >= 0 ? '+' : '';
    console.log(`   ${(i+1).toString().padStart(2)}. ${s.name.substring(0, 25).padEnd(25)} ${s.count}单 ${sign}${s.avgFirstDay.toFixed(2)}% 胜率${s.winRate}%`);
  });
}

async function main() {
  console.log('═'.repeat(60));
  console.log('🚀 港股IPO保荐人数据爬虫 v2');
  console.log('═'.repeat(60));
  console.log('数据来源: AAStocks (aastocks.com)');
  console.log('═'.repeat(60));
  
  const sponsors = await crawlSponsorStats();
  
  if (sponsors.length > 0) {
    saveData(sponsors);
    showTop10(sponsors);
  }
  
  console.log('\n✨ 完成！');
}

main().catch(console.error);