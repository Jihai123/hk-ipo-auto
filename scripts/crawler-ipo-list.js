/**
 * 港交所IPO列表爬虫
 * 功能：爬取当前在招股/即将上市的新股列表
 * 运行：node scripts/crawler-ipo-list.js
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
 * 爬取港交所IPO日历
 */
async function crawlIPOList() {
  console.log('[爬虫] 开始爬取港交所IPO数据...');

  try {
    // 港交所新股上市页面
    const url = 'https://www.hkex.com.hk/Market-Data/Statistics/Consolidated-Reports/HKEX-Fact-Book?sc_lang=zh-HK';

    // 这里使用模拟数据，实际项目中需要真实爬取
    // 真实场景需要解析港交所披露易的IPO日历页面
    const mockIPOData = [
      {
        code: '09660',
        name: '新氧',
        industry: '医疗健康',
        status: 'subscribing', // subscribing | coming | listed
        subscriptionStart: '2026-02-10',
        subscriptionEnd: '2026-02-15',
        pricing_date: '2026-02-16',
        allotment_result_date: '2026-02-17',
        refund_date: '2026-02-17',
        listingDate: '2026-02-18',
        lotSize: 200,
        offerPrice: '10-12',
        offer_price: 11,
        lot_amount: 2200,
        subscription_multiple: 28.5,
        allotment_rate: 18.2,
        currency: 'HKD',
        score: null, // 待评分
        lastUpdate: new Date().toISOString(),
        source_name: 'Mock IPO Feed'
      },
      {
        code: '02768',
        name: '佳源国际',
        industry: '金融服务',
        status: 'subscribing',
        subscriptionStart: '2026-02-08',
        subscriptionEnd: '2026-02-13',
        pricing_date: '2026-02-14',
        allotment_result_date: '2026-02-15',
        refund_date: '2026-02-15',
        listingDate: '2026-02-16',
        lotSize: 500,
        offerPrice: '8-10',
        offer_price: 9,
        lot_amount: 4500,
        subscription_multiple: 12.6,
        currency: 'HKD',
        score: null,
        lastUpdate: new Date().toISOString(),
        source_name: 'Mock IPO Feed'
      },
      {
        code: '01234',
        name: '科技创新集团',
        industry: '科技',
        status: 'coming',
        subscriptionStart: '2026-02-20',
        subscriptionEnd: '2026-02-25',
        pricing_date: '2026-02-26',
        allotment_result_date: '2026-02-27',
        refund_date: '2026-02-27',
        listingDate: '2026-02-28',
        lotSize: 100,
        offerPrice: '15-18',
        offer_price: 16.5,
        lot_amount: 1650,
        currency: 'HKD',
        score: null,
        lastUpdate: new Date().toISOString(),
        source_name: 'Mock IPO Feed'
      },
      {
        code: '05678',
        name: '生物医药',
        industry: '医疗健康',
        status: 'coming',
        subscriptionStart: '2026-02-22',
        subscriptionEnd: '2026-02-27',
        pricing_date: '2026-02-28',
        allotment_result_date: '2026-03-01',
        refund_date: '2026-03-01',
        listingDate: '2026-03-02',
        lotSize: 100,
        offerPrice: '20-25',
        offer_price: 22.5,
        lot_amount: 2250,
        currency: 'HKD',
        score: null,
        lastUpdate: new Date().toISOString(),
        source_name: 'Mock IPO Feed'
      },
      {
        code: '09876',
        name: '消费服务',
        industry: '消费',
        status: 'listed',
        listingDate: '2026-02-05',
        lotSize: 100,
        offerPrice: '10.00',
        offer_price: 10,
        current_price: 11.2,
        current_vs_offer_pct: 12,
        firstDayReturn: '+12.3%',
        first_day_change_pct: 12.3,
        lot_amount: 1000,
        first_day_lot_profit: 123,
        current_lot_profit: 120,
        subscription_multiple: 18.8,
        allotment_rate: 22.5,
        score: 68,
        lastUpdate: new Date().toISOString(),
        source_name: 'Mock IPO Feed'
      }
    ];

    // 保存到JSON文件
    const data = {
      updateTime: new Date().toISOString(),
      count: mockIPOData.length,
      ipos: mockIPOData
    };

    fs.writeFileSync(IPO_LIST_JSON, JSON.stringify(data, null, 2), 'utf-8');
    console.log(`[爬虫] 成功保存 ${data.count} 个IPO数据到 ${IPO_LIST_JSON}`);

    return data;
  } catch (error) {
    console.error('[爬虫] 爬取失败:', error.message);
    throw error;
  }
}

/**
 * 自动为IPO列表中的股票评分
 */
async function scoreIPOs(serverUrl = 'http://localhost:3010') {
  console.log('[评分] 开始为IPO列表评分...');

  if (!fs.existsSync(IPO_LIST_JSON)) {
    console.log('[评分] IPO列表文件不存在，跳过评分');
    return;
  }

  const data = JSON.parse(fs.readFileSync(IPO_LIST_JSON, 'utf-8'));
  let scored = 0;

  for (const ipo of data.ipos) {
    if (ipo.score !== null) {
      console.log(`[评分] ${ipo.code} ${ipo.name} 已有评分，跳过`);
      continue;
    }

    try {
      console.log(`[评分] 正在评分 ${ipo.code} ${ipo.name}...`);
      const response = await axios.get(`${serverUrl}/api/score/${ipo.code}`, {
        timeout: 120000 // 2分钟超时
      });

      if (response.data.success) {
        ipo.score = response.data.totalScore;
        ipo.rating = response.data.rating;
        ipo.scoreDetails = response.data.scores;
        scored++;
        console.log(`[评分] ${ipo.code} 评分完成: ${ipo.score}分 - ${ipo.rating}`);
      }
    } catch (error) {
      console.log(`[评分] ${ipo.code} 评分失败: ${error.message}`);
    }

    // 避免请求过快
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  // 保存更新后的数据
  data.updateTime = new Date().toISOString();
  fs.writeFileSync(IPO_LIST_JSON, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`[评分] 完成，共评分 ${scored} 个IPO`);
}

// 主函数
async function main() {
  try {
    // 1. 爬取IPO列表
    await crawlIPOList();

    // 2. 自动评分
    const shouldScore = process.argv.includes('--score');
    if (shouldScore) {
      await scoreIPOs();
    }

    console.log('[完成] IPO列表爬取完成');
  } catch (error) {
    console.error('[错误]', error);
    process.exit(1);
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  main();
}

module.exports = { crawlIPOList, scoreIPOs };
