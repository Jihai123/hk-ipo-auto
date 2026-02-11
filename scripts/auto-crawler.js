/**
 * 港交所IPO真实爬虫 - 自动抓取当前在招股新股
 * 数据来源：港交所披露易 + IPO日历
 */

const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../data');
const IPO_LIST_JSON = path.join(DATA_DIR, 'ipo-list.json');

// 确保目录存在
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * 爬取港交所披露易 - 获取最近的招股书列表
 */
async function crawlHKEXProspectus() {
  console.log('[爬虫] 开始爬取港交所披露易招股书列表...');

  try {
    // 港交所披露易搜索页面 - 搜索"招股章程"
    const searchUrl = 'https://www1.hkexnews.hk/search/titlesearch.xhtml';

    const response = await axios.post(searchUrl, {
      searchType: '0',
      market: 'SEHK',
      searchMethod: '2',
      documentType: '-1',
      t1code: '40003', // 招股章程代码
      t2Gcode: '-2',
      t2code: '-2',
      rowRange: '100',
      lang: 'ZH',
      sortDir: '0',
      sortByOptions: 'DateTime',
      category: '0'
    }, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      timeout: 30000
    });

    const $ = cheerio.load(response.data);
    const ipos = [];

    // 解析搜索结果
    $('.doc-link').each((index, element) => {
      if (index >= 20) return; // 只取最近20个

      const $row = $(element).closest('tr');
      const title = $(element).text().trim();
      const stockCode = title.match(/\d{5}/)?.[0]; // 提取5位股票代码
      const companyName = title.split('-')[0]?.trim();

      if (stockCode && companyName) {
        ipos.push({
          code: stockCode,
          name: companyName,
          title: title
        });
      }
    });

    console.log(`[爬虫] 从披露易获取到 ${ipos.length} 个招股书`);
    return ipos;

  } catch (error) {
    console.error('[爬虫] 披露易爬取失败:', error.message);
    return [];
  }
}

/**
 * 从AAStocks获取IPO日历（备用数据源）
 */
async function crawlAAStocksIPO() {
  console.log('[爬虫] 备用：尝试从AAStocks获取IPO信息...');

  try {
    const url = 'http://www.aastocks.com/tc/stocks/market/ipo/listedipo.aspx';

    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 15000
    });

    const $ = cheerio.load(response.data);
    const ipos = [];

    // 解析表格数据
    $('#tblIPO tr').each((index, element) => {
      if (index === 0) return; // 跳过表头

      const $row = $(element);
      const code = $row.find('td').eq(0).text().trim();
      const name = $row.find('td').eq(1).text().trim();
      const subStart = $row.find('td').eq(3).text().trim();
      const subEnd = $row.find('td').eq(4).text().trim();
      const listDate = $row.find('td').eq(5).text().trim();

      if (code && name) {
        ipos.push({
          code: code.padStart(5, '0'),
          name: name,
          subscriptionStart: subStart,
          subscriptionEnd: subEnd,
          listingDate: listDate
        });
      }
    });

    console.log(`[爬虫] 从AAStocks获取到 ${ipos.length} 个IPO`);
    return ipos;

  } catch (error) {
    console.error('[爬虫] AAStocks爬取失败:', error.message);
    return [];
  }
}

/**
 * 判断IPO状态
 */
function determineStatus(subscriptionStart, subscriptionEnd, listingDate) {
  const now = new Date();
  const start = subscriptionStart ? new Date(subscriptionStart) : null;
  const end = subscriptionEnd ? new Date(subscriptionEnd) : null;
  const listing = listingDate ? new Date(listingDate) : null;

  if (listing && listing < now) {
    return 'listed'; // 已上市
  } else if (start && end && now >= start && now <= end) {
    return 'subscribing'; // 招股中
  } else if (start && now < start) {
    return 'coming'; // 即将招股
  } else {
    return 'subscribing'; // 默认为招股中
  }
}

/**
 * 主爬取函数
 */
async function crawlIPOList() {
  console.log('[爬虫] ===== 开始自动爬取港股IPO数据 =====\n');

  try {
    // 方法1：从港交所披露易爬取
    let ipos = await crawlHKEXProspectus();

    // 如果披露易失败，使用备用数据源
    if (ipos.length === 0) {
      console.log('[爬虫] 披露易无数据，尝试备用数据源...');
      ipos = await crawlAAStocksIPO();
    }

    // 如果都失败，使用最小化样本数据
    if (ipos.length === 0) {
      console.log('[爬虫] ⚠️  所有数据源失败，使用最小样本数据');
      ipos = [
        {
          code: '09988',
          name: '阿里巴巴-SW',
          status: 'listed',
          listingDate: new Date().toISOString().split('T')[0]
        }
      ];
    }

    // 补充IPO详细信息
    const enrichedIPOs = ipos.map(ipo => ({
      code: ipo.code,
      name: ipo.name,
      industry: '待分类',
      status: ipo.status || determineStatus(
        ipo.subscriptionStart,
        ipo.subscriptionEnd,
        ipo.listingDate
      ),
      subscriptionStart: ipo.subscriptionStart || null,
      subscriptionEnd: ipo.subscriptionEnd || null,
      listingDate: ipo.listingDate || null,
      offerPrice: ipo.offerPrice || null,
      currency: 'HKD',
      score: null,
      rating: null,
      lastUpdate: new Date().toISOString()
    }));

    // 去重（按股票代码）
    const uniqueIPOs = [];
    const seen = new Set();
    for (const ipo of enrichedIPOs) {
      if (!seen.has(ipo.code)) {
        seen.add(ipo.code);
        uniqueIPOs.push(ipo);
      }
    }

    // 保存到JSON
    const data = {
      updateTime: new Date().toISOString(),
      count: uniqueIPOs.length,
      source: ipos.length > 0 ? 'auto-crawled' : 'sample',
      ipos: uniqueIPOs
    };

    fs.writeFileSync(IPO_LIST_JSON, JSON.stringify(data, null, 2), 'utf-8');

    console.log(`\n[爬虫] ✅ 成功保存 ${data.count} 个IPO数据到 ${IPO_LIST_JSON}`);
    console.log(`[爬虫] 数据来源: ${data.source}`);
    console.log(`[爬虫] 更新时间: ${data.updateTime}\n`);

    return data;

  } catch (error) {
    console.error('[爬虫] 致命错误:', error);
    throw error;
  }
}

/**
 * 自动评分（调用现有API）
 */
async function autoScore(serverUrl = 'http://localhost:3010') {
  console.log('[评分] ===== 开始自动评分流程 =====\n');

  if (!fs.existsSync(IPO_LIST_JSON)) {
    console.log('[评分] ⚠️  IPO列表不存在，请先运行爬虫');
    return;
  }

  const data = JSON.parse(fs.readFileSync(IPO_LIST_JSON, 'utf-8'));
  let scored = 0;
  let failed = 0;

  for (const ipo of data.ipos) {
    // 跳过已评分或已上市的
    if (ipo.score !== null || ipo.status === 'listed') {
      console.log(`[评分] ⏭️  ${ipo.code} ${ipo.name} - 跳过（${ipo.score ? '已评分' : '已上市'}）`);
      continue;
    }

    try {
      console.log(`[评分] 🔄 ${ipo.code} ${ipo.name} - 评分中...`);

      const response = await axios.get(`${serverUrl}/api/score/${ipo.code}`, {
        timeout: 120000
      });

      if (response.data.success) {
        ipo.score = response.data.totalScore;
        ipo.rating = response.data.rating;
        ipo.scoreDetails = response.data.scores;
        scored++;
        console.log(`[评分] ✅ ${ipo.code} - ${ipo.score}分 (${ipo.rating})`);
      } else {
        failed++;
        console.log(`[评分] ❌ ${ipo.code} - 失败: ${response.data.error || '未知错误'}`);
      }

    } catch (error) {
      failed++;
      console.log(`[评分] ❌ ${ipo.code} - 异常: ${error.message}`);
    }

    // 避免请求过快
    await new Promise(resolve => setTimeout(resolve, 3000));
  }

  // 更新文件
  data.updateTime = new Date().toISOString();
  fs.writeFileSync(IPO_LIST_JSON, JSON.stringify(data, null, 2), 'utf-8');

  console.log(`\n[评分] ===== 评分完成 =====`);
  console.log(`[评分] ✅ 成功: ${scored} 个`);
  console.log(`[评分] ❌ 失败: ${failed} 个\n`);
}

// 主函数
async function main() {
  const args = process.argv.slice(2);
  const shouldScore = args.includes('--score');
  const onlyScore = args.includes('--only-score');

  try {
    if (!onlyScore) {
      // 1. 爬取IPO列表
      await crawlIPOList();
    }

    if (shouldScore || onlyScore) {
      // 2. 自动评分
      await new Promise(resolve => setTimeout(resolve, 2000)); // 等待2秒
      await autoScore();
    }

    console.log('[完成] ✅ 所有任务完成\n');

  } catch (error) {
    console.error('[错误]', error);
    process.exit(1);
  }
}

// 直接运行
if (require.main === module) {
  main();
}

module.exports = { crawlIPOList, autoScore };
