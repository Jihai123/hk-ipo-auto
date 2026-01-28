/**
 * 港股IPO保荐人数据爬虫 v2
 * 数据来源：AAStocks (aastocks.com)
 * 运行: node scripts/crawl-sponsors.js
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

const SPONSOR_URL = 'https://www.aastocks.com/tc/stocks/market/ipo/sponsor.aspx';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
};

function parsePercent(str) {
  if (!str) return null;
  const cleaned = str.replace(/[+%,\s]/g, '').trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

/**
 * 爬取保荐人统计数据
 */
async function crawlSponsorStats() {
  console.log('\n📊 正在爬取保荐人数据...');
  console.log(`   URL: ${SPONSOR_URL}\n`);
  
  try {
    const response = await axios.get(SPONSOR_URL, {
      headers: HEADERS,
      timeout: 30000,
    });
    
    const $ = cheerio.load(response.data);
    const sponsors = [];
    
    // 表格结构: 保薦人 | 參與數目 | 首日上升數目 | 首日下跌數目 | 平均首日表現 | 平均累積表現 | ...
    $('table tr').each((rowIndex, row) => {
      const cells = $(row).find('td');
      
      if (cells.length >= 6) {
        const sponsorName = $(cells[0]).text().trim();
        const countText = $(cells[1]).text().trim();
        const count = parseInt(countText, 10);
        
        // 验证是数据行
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
            
            const sign = avgFirstDay >= 0 ? '+' : '';
            console.log(`   ✓ ${sponsorName.substring(0, 28).padEnd(28)} ${count}单, ${sign}${avgFirstDay.toFixed(2)}%, 胜率${winRate}%`);
          }
        }
      }
    });
    
    console.log(`\n   📈 共爬取 ${sponsors.length} 个保荐人`);
    return sponsors;
    
  } catch (error) {
    console.error('   ❌ 爬取失败:', error.message);
    return [];
  }
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